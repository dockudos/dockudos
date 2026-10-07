import { parseConfig } from './config.ts';
import {
  contrastRatio,
  generatePalette,
  hexToOklch,
  themeCss,
} from './theme.ts';

const theme = (t: object) => parseConfig({ name: 'A', theme: t }).theme;

describe('hexToOklch', () => {
  it('maps white, black and grey', () => {
    expect(hexToOklch('#ffffff').l).toBeCloseTo(1, 2);
    expect(hexToOklch('#000000').l).toBeCloseTo(0, 2);
    expect(hexToOklch('#777').c).toBeLessThan(0.001);
  });

  it('matches known OKLCH values for pure colors', () => {
    const red = hexToOklch('#ff0000');
    expect(red.l).toBeCloseTo(0.628, 2);
    expect(red.c).toBeCloseTo(0.258, 2);
    expect(red.h).toBeCloseTo(29.2, 0);
    expect(hexToOklch('#0000ff').h).toBeCloseTo(264.1, 0);
  });

  it('expands three-digit hex', () => {
    expect(hexToOklch('#f00')).toEqual(hexToOklch('#ff0000'));
  });
});

describe('generatePalette', () => {
  it('keeps the hue and produces both schemes', () => {
    const { light, dark } = generatePalette('#3b82f6');
    expect(light['--primary']).toMatch(/^oklch\(0\.\d+ 0\.\d+ 2[5-6]\d\.\d\)$/);
    expect(dark['--primary-foreground']).toBe('oklch(0.145 0 0)');
    expect(light['--primary-foreground']).toBe('oklch(1 0 0)');
  });

  it('darkens a pale brand color in light mode and lifts a dark one in dark mode', () => {
    const lightL = (hex: string) =>
      parseFloat(
        /oklch\(([\d.]+)/.exec(
          generatePalette(hex).light['--primary'] as string,
        )![1]!,
      );
    const darkL = (hex: string) =>
      parseFloat(
        /oklch\(([\d.]+)/.exec(
          generatePalette(hex).dark['--primary'] as string,
        )![1]!,
      );
    expect(lightL('#ffff99')).toBeLessThanOrEqual(0.62);
    expect(darkL('#1a1a66')).toBeGreaterThanOrEqual(0.6);
  });
});

const parse = (value: string) => {
  const [l, c, h] = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/
    .exec(value)!
    .slice(1)
    .map(Number) as [number, number, number];
  return { l, c, h };
};

describe('palette accessibility', () => {
  const brands = [
    '#3b82f6',
    '#ef4444',
    '#22c55e',
    '#eab308',
    '#ffff00',
    '#06b6d4',
    '#a855f7',
    '#f97316',
    '#111111',
    '#ffffff',
    '#1a1a66',
    '#ff00ff',
  ];

  it.each(brands)(
    'keeps %s readable as text in both schemes (WCAG AA 4.5:1)',
    (brand) => {
      const { light, dark } = generatePalette(brand);
      const white = { l: 1, c: 0, h: 0 };
      const near = { l: 0.145, c: 0, h: 0 };
      expect(
        contrastRatio(parse(light['--primary'] as string), white),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(parse(dark['--primary'] as string), near),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(brands)('keeps button text on %s readable', (brand) => {
    const { light, dark } = generatePalette(brand);
    expect(
      contrastRatio(
        parse(light['--primary'] as string),
        parse(light['--primary-foreground'] as string),
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(
        parse(dark['--primary'] as string),
        parse(dark['--primary-foreground'] as string),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('contrastRatio matches the WCAG extremes', () => {
    expect(
      contrastRatio({ l: 1, c: 0, h: 0 }, { l: 0, c: 0, h: 0 }),
    ).toBeCloseTo(21, 0);
    expect(contrastRatio({ l: 0.5, c: 0, h: 0 }, { l: 0.5, c: 0, h: 0 })).toBe(
      1,
    );
  });
});

describe('themeCss', () => {
  it('is empty for the default theme', () => {
    expect(themeCss(theme({}))).toBe('');
  });

  it('emits palette, radius and fonts as CSS variables', () => {
    const css = themeCss(
      theme({
        primary: '#3b82f6',
        radius: '0.25rem',
        fonts: { sans: 'Inter, sans-serif', mono: 'Fira Code' },
      }),
    );
    expect(css).toMatch(
      /^:root\{--radius:0\.25rem;--font-sans:Inter, sans-serif;--font-mono:Fira Code;--primary:oklch/,
    );
    expect(css).toContain('.dark{--primary:oklch');
  });

  it('works for fonts alone', () => {
    expect(themeCss(theme({ fonts: { sans: 'Inter' } }))).toBe(
      ':root{--font-sans:Inter}',
    );
  });
});
