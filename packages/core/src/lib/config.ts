import { z } from 'zod';

export const LAYOUTS = [
  'docs',
  'notebook',
  'spacious',
  'flux',
  'glass',
  'home',
] as const;

export type LayoutName = (typeof LAYOUTS)[number];

const hexColor = z
  .string()
  .regex(
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
    'must be a hex color like #3b82f6',
  );

const linkSchema = z.strictObject({
  title: z.string().min(1),
  href: z.string().min(1),
});

export interface NavGroup {
  group: string;
  pages: NavItem[];
}

/** A sidebar entry: a page id (file path without extension), an external link, or a nested group. */
export type NavItem = string | { title: string; href: string } | NavGroup;

const groupSchema: z.ZodType<NavGroup> = z.lazy(() =>
  z.strictObject({
    group: z.string().min(1),
    pages: z.array(navItemSchema),
  }),
);

const navItemSchema: z.ZodType<NavItem> = z.lazy(() =>
  z.union([z.string().min(1), linkSchema, groupSchema]),
);

const tabSchema = z.union([
  z.strictObject({
    tab: z.string().min(1),
    groups: z.array(groupSchema),
  }),
  z.strictObject({
    tab: z.string().min(1),
    href: z.string().min(1),
  }),
]);

const logoSchema = z.union([
  z.string().min(1),
  z.strictObject({
    light: z.string().min(1),
    dark: z.string().min(1),
    href: z.string().min(1).optional(),
  }),
]);

/** A value that ends up inside a CSS declaration, so it must not be able to close it or the style tag. */
const cssValue = z
  .string()
  .min(1)
  .regex(/^[^<>{};\\]+$/, 'must not contain < > { } ; or \\');

const themeSchema = z.strictObject({
  /** Brand color; the palette is derived from it. */
  primary: hexColor.optional(),
  mode: z.enum(['light', 'dark', 'system']).default('system'),
  layout: z.enum(LAYOUTS).default('docs'),
  fonts: z
    .strictObject({
      sans: cssValue.optional(),
      mono: cssValue.optional(),
    })
    .optional(),
  radius: cssValue.optional(),
  /** Path to a CSS file loaded after the theme, relative to the project root. */
  css: z.string().min(1).optional(),
});

const redirectSchema = z.strictObject({
  source: z.string().startsWith('/', 'must start with "/"'),
  destination: z
    .string()
    .refine(
      (v) => v.startsWith('/') || /^https?:\/\//.test(v),
      'must start with "/" or "http(s)://"',
    ),
  permanent: z.boolean().default(true),
});

const seoSchema = z.strictObject({
  /** Origin used for canonical URLs and the sitemap, e.g. `https://docs.acme.com`. */
  siteUrl: z.url().optional(),
  description: z.string().optional(),
  noindex: z.boolean().default(false),
});

const kudosSchema = z.strictObject({
  /** Show "Was this page helpful?" under each page. */
  enabled: z.boolean().default(false),
  /** Where votes and comments are sent. The route is created in your app; see the docs. */
  endpoint: z
    .string()
    .startsWith('/', 'must start with "/"')
    .default('/api/kudos'),
});

const actionsSchema = z.strictObject({
  /** "Copy page" (as Markdown) in the page header. Needs the markdown route. */
  copyPage: z.boolean().default(false),
  /** "Open in ChatGPT" and "Open in Claude" in the page menu. Needs `seo.siteUrl`. */
  assistants: z.boolean().default(false),
  /** Where the Markdown comes from. */
  endpoint: z
    .string()
    .startsWith('/', 'must start with "/"')
    .default('/api/markdown'),
  /**
   * Link to edit a page's source. `{file}` is the page's file inside `docs/`, `{path}` its URL path:
   * `https://github.com/acme/site/edit/main/docs/{file}`.
   */
  editUrl: z
    .string()
    .regex(
      /^https?:\/\/.*\{(file|path)\}/,
      'must be an http(s) URL containing {file} or {path}',
    )
    .optional(),
});

const accessRuleSchema = z.strictObject({
  /**
   * Which URL paths the rule covers: `/print` (that page), `/team/*` (one level), `/team/**` (the
   * folder and everything below it). Include any prefix you set in `urlPrefix`.
   */
  paths: z
    .array(
      z
        .string()
        .regex(
          /^\/(?:[^*\s]*(?:\*\*)?)?$|^\/(?:[^*\s/]+|\*)(?:\/(?:[^*\s/]+|\*))*(?:\/\*\*)?$/,
          'must start with "/" and use * for one segment or ** only at the end',
        ),
    )
    .min(1),
  /**
   * How a visitor proves they may see it:
   * `basic` (HTTP Basic, credentials from an environment variable), `token` (a bearer token from an
   * environment variable), `custom` (your own `verify` function in the proxy), or `deny` (answer 404).
   */
  require: z.enum(['basic', 'token', 'custom', 'deny']),
  /** The environment variable holding the secret. Defaults: DOCKUDOS_BASIC_AUTH, DOCKUDOS_TOKEN. */
  secretEnv: z
    .string()
    .regex(
      /^[A-Z_][A-Z0-9_]*$/,
      'must be an environment variable name like DOCS_PASSWORD',
    )
    .optional(),
  /** Name shown in the browser's sign-in box (`basic`). */
  realm: z.string().min(1).max(100).optional(),
});

/**
 * Shape of `docs.json`. Strict: unknown keys are rejected so typos fail the
 * build instead of being silently ignored. Later phases add keys.
 */
export const docsConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  /**
   * Where the docs are mounted in the site, for apps that have other routes
   * (`/docs`). Match it with the folder of the catch-all route. Default: the site root.
   */
  urlPrefix: z
    .string()
    .regex(
      /^\/[^/]+(?:\/[^/]+)*$/,
      'must start with "/" and not end with "/", like "/docs"',
    )
    .optional(),
  name: z.string().min(1),
  logo: logoSchema.optional(),
  favicon: z.string().min(1).optional(),
  theme: themeSchema.default(() => themeSchema.parse({})),
  navigation: z.array(tabSchema).default([]),
  redirects: z.array(redirectSchema).default([]),
  seo: seoSchema.default(() => seoSchema.parse({})),
  kudos: kudosSchema.default(() => kudosSchema.parse({})),
  actions: actionsSchema.default(() => actionsSchema.parse({})),
  /** Keyboard shortcuts: search, previous and next page, theme, and the help dialog. */
  shortcuts: z.boolean().default(true),
  /** Protect routes. The first rule that matches a path decides. Secrets live in environment variables, never here. */
  access: z
    .strictObject({ rules: z.array(accessRuleSchema).default([]) })
    .default(() => ({ rules: [] })),
});

/** JSON Schema for `docs.json`, for editor autocomplete. */
export function docsConfigJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(docsConfigSchema, { io: 'input' }) as Record<
    string,
    unknown
  >;
}

export type DocsConfig = z.output<typeof docsConfigSchema>;

export class DocsConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[], source?: string) {
    const where = source ? ` in ${source}` : '';
    super(
      `Invalid docs config${where}:\n${issues.map((i) => `  - ${i}`).join('\n')}`,
    );
    this.name = 'DocsConfigError';
    this.issues = issues;
  }
}

/** Validate an unknown value as a docs config, throwing a readable error naming each bad key. */
export function parseConfig(input: unknown, source?: string): DocsConfig {
  const result = docsConfigSchema.safeParse(input);
  if (result.success) return result.data;
  throw new DocsConfigError(result.error.issues.flatMap(describe), source);
}

type Issue = z.core.$ZodIssue;

function describe(issue: Issue): string[] {
  if (issue.code === 'unrecognized_keys') {
    const extra = issue.keys.map((k) => formatPath([...issue.path, k]));
    return [`unknown key ${extra.join(', ')}`];
  }
  if (issue.code === 'invalid_union') {
    // Report the branch that got furthest, not a generic "Invalid input".
    const branches = issue.errors.filter((b) => b.length > 0);
    const best = branches.sort((a, b) => depth(b) - depth(a))[0];
    if (best)
      return best.flatMap((i) =>
        describe({ ...i, path: [...issue.path, ...i.path] }),
      );
  }
  return [`${formatPath(issue.path) || '(root)'}: ${issue.message}`];
}

function depth(issues: readonly Issue[]): number {
  return Math.max(...issues.map((i) => i.path.length));
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, part) => {
    if (typeof part === 'number') return `${acc}[${part}]`;
    return acc ? `${acc}.${String(part)}` : String(part);
  }, '');
}
