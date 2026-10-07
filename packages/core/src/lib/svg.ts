/**
 * Turn an SVG file into something safe to put inside a page. SVG can carry scripts, event handlers,
 * external references and global `<style>` rules, so nothing is trusted: the file is read into a
 * small allow-list of shapes and presentation attributes and written back out.
 */

export interface SvgIcon {
  viewBox: string;
  /** The shapes, as markup that is safe inside `<svg>`. */
  body: string;
  /** Presentation attributes of the root element (`fill`, `stroke`, `stroke-width`, ...). */
  attrs: Record<string, string>;
}

export class SvgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SvgError';
  }
}

const ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'use',
  'title',
  'desc',
]);
// Camel-case names SVG needs, keyed by the lower-case form the allow-list uses.
const CASE: Record<string, string> = {
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  clippath: 'clipPath',
};

const ATTRIBUTES = new Set([
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'points',
  'transform',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'fill-opacity',
  'fill-rule',
  'clip-rule',
  'opacity',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientunits',
  'gradienttransform',
  'clip-path',
  'mask',
  'id',
  'href',
  'xlink:href',
  'viewbox',
  'fx',
  'fy',
  'maskunits',
  'maskcontentunits',
  'clippathunits',
  'vector-effect',
]);
const ATTR_CASE: Record<string, string> = {
  gradientunits: 'gradientUnits',
  gradienttransform: 'gradientTransform',
  maskunits: 'maskUnits',
  maskcontentunits: 'maskContentUnits',
  clippathunits: 'clipPathUnits',
  viewbox: 'viewBox',
};
const STYLE_PROPERTIES = new Set([
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'fill-opacity',
  'fill-rule',
  'clip-rule',
  'opacity',
  'stop-color',
  'stop-opacity',
]);
const PAINT = new Set(['fill', 'stroke', 'stop-color', 'clip-path', 'mask']);
const MAX_BYTES = 100 * 1024;
// eslint-disable-next-line no-control-regex
const CONTROL_OR_ANGLE = /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

const escapeAttr = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const unescape = (v: string) =>
  v
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** A value that is a number, a color or keyword, or a reference to something in the same file. */
function safeValue(
  name: string,
  raw: string,
  ids: Map<string, string>,
): string | undefined {
  const value = unescape(raw).trim();
  if (value.length > 2000 || CONTROL_OR_ANGLE.test(value)) return undefined;
  if (name === 'href' || name === 'xlink:href') {
    const local = /^#([\w.:-]+)$/.exec(value)?.[1];
    return local ? `#${ids.get(local) ?? local}` : undefined;
  }
  const url = /^url\(\s*['"]?#([\w.:-]+)['"]?\s*\)$/.exec(value);
  if (url) return `url(#${ids.get(url[1] as string) ?? url[1]})`;
  if (/url\(|javascript:|data:|expression\(|@import|&#|\\/i.test(value))
    return undefined;
  if (PAINT.has(name) && name !== 'clip-path' && name !== 'mask') return value;
  if (name === 'clip-path' || name === 'mask')
    return value === 'none' ? value : undefined;
  return value;
}

/** `style="fill:red;stroke-width:2"` as attributes, keeping only the properties that are drawing, not page styling. */
function styleToAttributes(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of unescape(style).split(';')) {
    const colon = part.indexOf(':');
    if (colon < 1) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    if (STYLE_PROPERTIES.has(prop)) out[prop] = part.slice(colon + 1).trim();
  }
  return out;
}

/** A short hash, to keep ids from different icons apart when they sit in one page. */
function tag(source: string): string {
  let h = 5381;
  for (let i = 0; i < source.length; i++)
    h = ((h << 5) + h + source.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export interface SvgOptions {
  /** Turn every fixed color into `currentColor`, so the icon follows the text color and the theme. */
  monochrome?: boolean;
}

/** Read, clean and normalize an SVG. Throws an `SvgError` that says what is wrong with the file. */
export function sanitizeSvg(
  source: string,
  { monochrome = false }: SvgOptions = {},
): SvgIcon {
  if (source.length > MAX_BYTES)
    throw new SvgError(`larger than ${MAX_BYTES / 1024} kB`);
  const text = source
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<!DOCTYPE[^>]*(?:\[[\s\S]*?\])?>/gi, '');

  // Ids may be referenced before they are defined, so find them all first.
  const prefix = `dk${tag(text)}-`;
  const ids = new Map<string, string>();
  for (const m of text.matchAll(/\sid\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const id = (m[1] ?? m[2]) as string;
    if (/^[\w.:-]+$/.test(id)) ids.set(id, `${prefix}${id}`);
  }

  const out: string[] = [];
  const stack: string[] = [];
  let skipDepth = 0;
  let root:
    | {
        viewBox?: string;
        width?: string;
        height?: string;
        attrs: Record<string, string>;
      }
    | undefined;
  let seenRoot = false;

  for (const m of text.matchAll(
    /<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g,
  )) {
    const closing = m[1] === '/';
    const name = (m[2] as string).toLowerCase();
    const selfClosing = m[4] === '/';

    if (skipDepth > 0) {
      if (!closing && !selfClosing) skipDepth++;
      else if (closing) skipDepth--;
      continue;
    }
    if (!ELEMENTS.has(name)) {
      // Dropping an element drops everything inside it: a <script> or <foreignObject> brings its own content.
      if (!closing && !selfClosing) skipDepth = 1;
      continue;
    }

    if (closing) {
      if (stack.pop() === name && name !== 'svg')
        out.push(`</${CASE[name] ?? name}>`);
      continue;
    }

    const rawAttrs: Record<string, string> = {};
    for (const a of (m[3] as string).matchAll(
      /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
    )) {
      rawAttrs[(a[1] as string).toLowerCase()] = (a[2] ?? a[3]) as string;
    }
    // A style declaration beats the attribute of the same name, as in a browser.
    const merged = {
      ...rawAttrs,
      ...styleToAttributes(rawAttrs['style'] ?? ''),
    };
    delete merged['style'];

    const clean: Record<string, string> = {};
    for (const [key, raw] of Object.entries(merged)) {
      if (!ATTRIBUTES.has(key) || key.startsWith('on')) continue;
      if (key === 'viewbox') continue;
      const value =
        key === 'id' ? (ids.get(raw) ?? undefined) : safeValue(key, raw, ids);
      if (value === undefined) continue;
      clean[ATTR_CASE[key] ?? key] =
        monochrome &&
        (key === 'fill' || key === 'stroke') &&
        value !== 'none' &&
        !value.startsWith('url(')
          ? 'currentColor'
          : value;
    }

    if (name === 'svg') {
      if (!seenRoot) {
        seenRoot = true;
        const { width, height, id: _id, ...attrs } = clean;
        root = { viewBox: rawAttrs['viewbox']?.trim(), width, height, attrs };
        if (!selfClosing) stack.push('svg');
      } else if (!selfClosing) {
        skipDepth = 1; // a nested <svg> is not an icon shape
      }
      continue;
    }
    if (!seenRoot) throw new SvgError('does not start with an <svg> element');

    const attrText = Object.entries(clean)
      .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
      .join('');
    out.push(`<${CASE[name] ?? name}${attrText}${selfClosing ? '/>' : '>'}`);
    if (!selfClosing) stack.push(name);
  }

  if (!root) throw new SvgError('has no <svg> element');
  let viewBox = root.viewBox;
  if (viewBox && !/^-?[\d.]+(?:[\s,]+-?[\d.]+){3}$/.test(viewBox))
    throw new SvgError(`has an invalid viewBox "${viewBox}"`);
  if (!viewBox) {
    const w = parseFloat(root.width ?? '');
    const h = parseFloat(root.height ?? '');
    if (!(w > 0 && h > 0))
      throw new SvgError('needs a viewBox, or a width and a height');
    viewBox = `0 0 ${w} ${h}`;
  }
  const body = out.join('');
  if (!/<(path|circle|ellipse|rect|line|polyline|polygon|use)\b/.test(body))
    throw new SvgError('has no shapes to draw');
  // Monochrome also applies to the root's own fill and stroke.
  const attrs = { ...root.attrs };
  if (monochrome) {
    for (const key of ['fill', 'stroke'] as const) {
      const v = attrs[key];
      if (v && v !== 'none' && !v.startsWith('url('))
        attrs[key] = 'currentColor';
    }
  }
  return {
    viewBox: viewBox.trim().replace(/,/g, ' ').replace(/\s+/g, ' '),
    body,
    attrs,
  };
}
