/** Where the social-card image of a page is: `/og/guides/auth.png`; the home page is `/og/index.png`. */
export function ogImagePath(pagePath: string): string {
  return `/og${pagePath === '/' ? '/index' : pagePath}.png`;
}

/** The page an `/og/….png` address is for, or `undefined` when it is not one. */
export function pathFromOgImage(pathname: string): string | undefined {
  const match = /^\/og(\/.*)\.png$/.exec(pathname);
  if (!match) return undefined;
  const path = match[1] as string;
  return path === '/index' ? '/' : path.replace(/\/index$/, '') || '/';
}

export interface OgCard {
  siteName: string;
  title: string;
  description?: string;
  /** A short label in the corner, such as the version. */
  badge?: string;
  /** Brand color, `#rrggbb` or `#rgb`. */
  primary?: string;
}

export const OG_SIZE = { width: 1200, height: 630 } as const;

/** Black or white, whichever reads better on this color (WCAG relative luminance). */
export function readableOn(hex: string): '#000000' | '#ffffff' {
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!h) return '#ffffff';
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast with white is 1.05 / (L + 0.05); with black it is (L + 0.05) / 0.05.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05
    ? '#ffffff'
    : '#000000';
}

const clip = (text: string, max: number) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

interface El {
  type: string;
  props: {
    style?: Record<string, string | number>;
    children?: El | string | (El | string | false | undefined)[];
  };
}

/**
 * The card as a tree of elements that `satori` / `next/og` draws. Plain objects, so no React is needed to make one
 * (the CLI draws them too). Text is clipped, so a long title cannot overflow the image.
 */
export function ogElement(card: OgCard): El {
  const background = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(card.primary ?? '')
    ? (card.primary as string)
    : '#111827';
  const color = readableOn(background);
  const title = clip(card.title, 90);
  const description = card.description
    ? clip(card.description, 150)
    : undefined;
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        padding: 72,
        background,
        color,
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 32,
              fontWeight: 700,
            },
            children: [
              { type: 'div', props: { children: clip(card.siteName, 40) } },
              card.badge && {
                type: 'div',
                props: {
                  style: { opacity: 0.8 },
                  children: clip(card.badge, 20),
                },
              },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column' },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: title.length > 50 ? 60 : 76,
                    fontWeight: 800,
                    lineHeight: 1.1,
                  },
                  children: title,
                },
              },
              description && {
                type: 'div',
                props: {
                  style: {
                    fontSize: 32,
                    marginTop: 24,
                    opacity: 0.85,
                    lineHeight: 1.3,
                  },
                  children: description,
                },
              },
            ],
          },
        },
      ],
    },
  };
}
