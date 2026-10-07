import type { DocsConfig } from './config.ts';

type Theme = DocsConfig['theme'];

interface Oklch {
  l: number;
  c: number;
  h: number;
}

const WHITE_FG = 'oklch(0.985 0 0)';
const DARK_FG = 'oklch(0.205 0 0)';

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

/**
 * CSS variable values derived from one brand color, for both color schemes.
 * Light mode keeps the brand color but never lighter than needed for white
 * text to stay readable; dark mode lifts it so it stands out on dark surfaces.
 */
export function generatePalette(primary: string): {
  light: Record<string, string>;
  dark: Record<string, string>;
} {
  const base = hexToOklch(primary);
  const light: Oklch = { ...base, l: clamp(base.l, 0.35, 0.62) };
  const dark: Oklch = { ...base, l: clamp(base.l, 0.68, 0.85) };
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
