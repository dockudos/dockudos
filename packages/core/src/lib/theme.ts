import type { DocsConfig } from './config.ts';

type Theme = DocsConfig['theme'];

interface Oklch {
  l: number;
  c: number;
  h: number;
}

const WHITE_FG = 'oklch(1 0 0)';
const DARK_FG = 'oklch(0.145 0 0)';

/** `#rgb` or `#rrggbb` to OKLCH (Ottosson's OKLab, sRGB input). */
export function hexToOklch(hex: string): Oklch {
  const full =
    hex.length === 4 ? '#' + [...hex.slice(1)].map((c) => c + c).join('') : hex;
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const c = Math.hypot(A, B);
  const h = c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

const fmt = ({ l, c, h }: Oklch) =>
  `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** OKLCH to linear sRGB, clipped to the gamut (what a browser shows for an out-of-gamut color). */
function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return rgb.map((v) => clamp(v, 0, 1)) as [number, number, number];
}

const luminance = (color: Oklch) => {
  const [r, g, b] = oklchToLinear(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio between two colors (1 to 21). */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT_BG: Oklch = { l: 1, c: 0, h: 0 };
const DARK_BG: Oklch = { l: 0.145, c: 0, h: 0 };
const MIN_CONTRAST = 4.5;

/** Move lightness away from `bg` in small steps until `color` reaches the contrast needed for body text. */
function withContrast(color: Oklch, bg: Oklch, direction: 1 | -1): Oklch {
  const out = { ...color };
  while (
    contrastRatio(out, bg) < MIN_CONTRAST &&
    out.l > 0.02 &&
    out.l < 0.98
  ) {
    out.l += 0.01 * direction;
  }
  return out;
}

/**
 * CSS variable values derived from one brand color, for both color schemes.
 * The brand color is nudged just far enough to stay readable as text and as a
 * button background: darker in light mode, lighter in dark mode (WCAG AA, 4.5:1).
 */
export function generatePalette(primary: string): {
  light: Record<string, string>;
  dark: Record<string, string>;
} {
  const base = hexToOklch(primary);
  const light = withContrast(
    { ...base, l: clamp(base.l, 0.3, 0.62) },
    LIGHT_BG,
    -1,
  );
  const dark = withContrast(
    { ...base, l: clamp(base.l, 0.6, 0.85) },
    DARK_BG,
    1,
  );
  const tint = (l: number, c: number): Oklch => ({
    l,
    c: Math.min(base.c, c),
    h: base.h,
  });

  return {
    light: {
      '--primary': fmt(light),
      '--primary-foreground': WHITE_FG,
      '--accent': fmt(tint(0.96, 0.03)),
      '--accent-foreground': fmt(tint(0.3, 0.1)),
      '--ring': fmt({ ...light, l: clamp(light.l + 0.1, 0, 0.8) }),
    },
    dark: {
      '--primary': fmt(dark),
      '--primary-foreground': DARK_FG,
      '--accent': fmt(tint(0.27, 0.05)),
      '--accent-foreground': fmt(tint(0.92, 0.04)),
      '--ring': fmt({ ...dark, l: clamp(dark.l - 0.1, 0, 1) }),
    },
  };
}

const block = (selector: string, vars: Record<string, string>) =>
  Object.keys(vars).length
    ? `${selector}{${Object.entries(vars)
        .map(([k, v]) => `${k}:${v}`)
        .join(';')}}`
    : '';

/**
 * CSS for the user's theme settings, to inject after the base stylesheet.
 * Everything is a CSS variable, so a custom stylesheet can override any of it.
 */
export function themeCss(theme: Theme): string {
  const shared: Record<string, string> = {};
  if (theme.radius) shared['--radius'] = theme.radius;
  if (theme.fonts?.sans) shared['--font-sans'] = theme.fonts.sans;
  if (theme.fonts?.mono) shared['--font-mono'] = theme.fonts.mono;

  const palette = theme.primary
    ? generatePalette(theme.primary)
    : { light: {}, dark: {} };
  return [
    block(':root', { ...shared, ...palette.light }),
    block('.dark', palette.dark),
  ].join('');
}
