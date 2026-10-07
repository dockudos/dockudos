import { SvgError, sanitizeSvg } from './svg.ts';

const svg = (inner: string, attrs = 'viewBox="0 0 24 24"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;

describe('sanitizeSvg: reading icons', () => {
  it('keeps shapes and drawing attributes, and the root presentation attributes', () => {
    const icon = sanitizeSvg(
      svg(
        '<path d="M1 1h4" stroke-linecap="round"/><circle cx="5" cy="5" r="2"/>',
        'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"',
      ),
    );
    expect(icon.viewBox).toBe('0 0 24 24');
    expect(icon.body).toBe(
      '<path d="M1 1h4" stroke-linecap="round"/><circle cx="5" cy="5" r="2"/>',
    );
    expect(icon.attrs).toEqual({
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
    });
  });

  it('reads a real-world file: xml header, doctype, comments, extra attributes, nested groups', () => {
    const icon = sanitizeSvg(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<!-- Generator: something -->
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="32px" height="32px" viewBox="0 0 32 32" enable-background="new 0 0 32 32">
  <g id="layer1" fill="#123456"><title>Logo</title><path d="M0 0h32v32z"/></g>
</svg>`);
    expect(icon.viewBox).toBe('0 0 32 32');
    expect(icon.body).toMatch(/<g id="dk[^"]+-layer1" fill="#123456">/);
    // Text such as <title> is dropped; give the icon a label where it is used.
    expect(icon.body).not.toContain('Logo');
    expect(icon.body).not.toMatch(/enable-background|xmlns|version/);
  });

  it('works out the viewBox from width and height when there is none', () => {
    expect(
      sanitizeSvg(svg('<path d="M0 0"/>', 'width="20" height="10"')).viewBox,
    ).toBe('0 0 20 10');
  });

  it('turns style declarations into attributes, keeping only drawing properties', () => {
    const icon = sanitizeSvg(
      svg(
        '<path d="M0 0" style="fill:red;stroke-width:3;position:fixed;background:url(http://x.test/a.png)"/>',
      ),
    );
    expect(icon.body).toBe('<path d="M0 0" fill="red" stroke-width="3"/>');
  });

  it('lets a style declaration win over the attribute of the same name', () => {
    expect(
      sanitizeSvg(svg('<path d="M0 0" fill="blue" style="fill:red"/>')).body,
    ).toBe('<path d="M0 0" fill="red"/>');
  });

  it('writes camel-case elements and attributes SVG needs', () => {
    const icon = sanitizeSvg(
      svg(
        '<defs><linearGradient id="g" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000"/></linearGradient></defs><path d="M0 0" fill="url(#g)"/>',
      ),
    );
    expect(icon.body).toContain('<linearGradient');
    expect(icon.body).toContain('gradientUnits="userSpaceOnUse"');
    expect(icon.body).toContain('</linearGradient>');
  });
});

describe('sanitizeSvg: nothing dangerous gets through', () => {
  const body = (inner: string) =>
    sanitizeSvg(svg(`${inner}<path d="M0 0"/>`)).body;

  it('removes scripts, foreign content and everything inside them', () => {
    const out = body(
      '<script>alert(1)</script><foreignObject><div onclick="x()">hi</div><script>bad()</script></foreignObject><style>*{display:none}</style><iframe src="x"></iframe>',
    );
    expect(out).toBe('<path d="M0 0"/>');
  });

  it('removes event handlers and unknown attributes', () => {
    const out = body(
      '<rect width="1" height="1" onload="alert(1)" onclick="x" class="page-class" data-x="1" tabindex="0"/>',
    );
    expect(out).toBe('<rect width="1" height="1"/><path d="M0 0"/>');
  });

  it.each([
    ['href="javascript:alert(1)"'],
    ['xlink:href="javascript:alert(1)"'],
    ['href="https://evil.test/x.svg#a"'],
    ['href="data:image/svg+xml;base64,AAAA"'],
  ])('drops an external or scripted reference (%s)', (attr) => {
    expect(body(`<use ${attr}/>`)).not.toMatch(/javascript|evil|data:/);
  });

  it('keeps local references, and gives ids a prefix so two icons cannot collide', () => {
    const a = sanitizeSvg(
      svg(
        '<defs><clipPath id="c"><rect width="1" height="1"/></clipPath></defs><path d="M0 0" clip-path="url(#c)"/>',
      ),
    );
    const b = sanitizeSvg(
      svg(
        '<defs><clipPath id="c"><rect width="2" height="2"/></clipPath></defs><path d="M0 0" clip-path="url(#c)"/>',
      ),
    );
    const idA = /id="(dk[^"]+)"/.exec(a.body)![1]!;
    const idB = /id="(dk[^"]+)"/.exec(b.body)![1]!;
    expect(idA).not.toBe(idB);
    expect(a.body).toContain(`clip-path="url(#${idA})"`);
  });

  it('refuses paint and other values that point outside the file', () => {
    const out = body(
      '<rect width="1" height="1" fill="url(https://evil.test/p)" stroke="url(javascript:1)" filter="url(#x)"/>',
    );
    expect(out).toBe('<rect width="1" height="1"/><path d="M0 0"/>');
  });

  it('survives hostile and broken markup without throwing anything but an SvgError', () => {
    for (const src of [
      '',
      '<svg',
      '<svg viewBox="0 0 1 1"></svg>',
      '<div></div>',
      '<svg viewBox="0 0 1 1"><path d="M0 0" onload=alert(1)></svg>',
      svg('<path d="M0 0" fill="red<script>"/>'),
    ]) {
      try {
        const icon = sanitizeSvg(src);
        expect(icon.body).not.toMatch(/<script|onload|javascript:/i);
      } catch (e) {
        expect(e).toBeInstanceOf(SvgError);
      }
    }
  });

  it('ignores a nested svg and anything after content that is not an icon', () => {
    expect(body('<svg><path d="M9 9"/></svg>')).toBe('<path d="M0 0"/>');
  });
});

describe('sanitizeSvg: errors say what is wrong', () => {
  it.each([
    ['', /no <svg>/],
    ['<div>hi</div>', /no <svg>/],
    [svg('<g></g>'), /no shapes/],
    ['<svg><path d="M0 0"/></svg>', /needs a viewBox/],
    [svg('<path d="M0 0"/>', 'viewBox="a b c d"'), /invalid viewBox/],
    [svg('<path d="M0 0"/>').padEnd(200_000, ' '), /larger than/],
  ])('rejects %#', (src, message) => {
    expect(() => sanitizeSvg(src as string)).toThrow(message);
  });
});

describe('sanitizeSvg: monochrome', () => {
  it('turns fixed colors into currentColor and leaves none and gradients alone', () => {
    const icon = sanitizeSvg(
      svg(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><path d="M0 0" fill="#336699" stroke="none"/><path d="M1 1" fill="url(#g)"/>',
        'viewBox="0 0 8 8" fill="#000"',
      ),
      { monochrome: true },
    );
    expect(icon.attrs['fill']).toBe('currentColor');
    expect(icon.body).toContain('fill="currentColor" stroke="none"');
    expect(icon.body).toMatch(/fill="url\(#dk[^)]+\)"/);
    expect(icon.body).toContain('stop-color="#f00"');
  });

  it('keeps colors when not asked', () => {
    expect(sanitizeSvg(svg('<path d="M0 0" fill="#336699"/>')).body).toContain(
      '#336699',
    );
  });
});
