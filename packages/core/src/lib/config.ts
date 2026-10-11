import { z } from 'zod';

export const LAYOUTS = [
  'docs',
  'notebook',
  'spacious',
  'flux',
  'glass',
  'home',
  'landing',
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

const sourceName = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*$/,
    'must be lowercase letters, digits and dashes, like "petstore"',
  );

export interface NavGroup {
  group: string;
  /** Treat the group as a tutorial: its pages are numbered steps with progress. */
  tutorial?: boolean;
  pages: NavItem[];
}

/**
 * A sidebar entry: a page id (file path without extension), an external link, a nested group, or all the pages
 * generated from one source in docs.json (`{ "openapi": "petstore" }`, `{ "reference": "sdk" }`).
 */
export type NavItem =
  | string
  | { title: string; href: string }
  | { openapi: string }
  | { reference: string }
  | NavGroup;

const groupSchema: z.ZodType<NavGroup> = z.lazy(() =>
  z.strictObject({
    group: z.string().min(1),
    /** Treat the group as a tutorial: its pages are numbered steps, with a progress bar on each. */
    tutorial: z.boolean().optional(),
    pages: z.array(navItemSchema),
  }),
);

const navItemSchema: z.ZodType<NavItem> = z.lazy(() =>
  z.union([
    z.string().min(1),
    linkSchema,
    z.strictObject({ openapi: sourceName }),
    z.strictObject({ reference: sourceName }),
    groupSchema,
  ]),
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
  /** Give every page a social-card image (`og:image`). Needs `siteUrl`. */
  ogImages: z.boolean().default(true),
});

const kudosSchema = z.strictObject({
  /** Show "Was this page helpful?" under each page. */
  enabled: z.boolean().default(false),
  /** Where votes and comments are sent. The route is created in your app; see the docs. */
  endpoint: z
    .string()
    .startsWith('/', 'must start with "/"')
    .default('/api/kudos'),
  /**
   * Also send each vote and comment to your own backend: a POST of `{ id, at, path, vote?, comment? }` as JSON.
   * No address, cookie or user id is included unless you add `includeUser`.
   */
  webhook: z
    .strictObject({
      url: z.url(),
      /** Environment variable with a secret, sent as `Authorization: Bearer ...`. */
      secretEnv: z
        .string()
        .regex(/^[A-Z_][A-Z0-9_]*$/)
        .optional(),
      /** Add the signed-in user's id (never their email or name) to what is sent. Off by default. */
      includeUser: z.boolean().default(false),
    })
    .optional(),
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

const searchSchema = z
  .strictObject({
    /**
     * Where searches are answered. `builtin`: the index is downloaded once and searched in the browser.
     * `server`: each search asks `endpoint`, handled by your app (fine for very large sites). `custom`:
     * each search asks a service of yours at `endpoint`, which must answer `{ "hits": [...] }`.
     */
    backend: z.enum(['builtin', 'server', 'custom']).default('builtin'),
    /**
     * The search route. Default `/api/search`; the built-in index is served at `<endpoint>/index`.
     * Required for `custom`, where it can be any URL.
     */
    endpoint: z
      .string()
      .regex(/^(\/|https?:\/\/)/, 'must start with "/" or "http(s)://"')
      .optional(),
    /** Most results the palette shows. */
    limit: z.number().int().min(1).max(50).default(10),
  })
  .refine((v) => v.backend !== 'custom' || v.endpoint, {
    message: 'is required when backend is "custom"',
    path: ['endpoint'],
  });

const httpUrl = z
  .string()
  .regex(
    /^https?:\/\/\S+$/,
    'must be an http(s) URL, like https://api.example.com/v1',
  );

const aiSchema = z
  .strictObject({
    /** Turn on the assistant ("Ask the docs") and AI navigation. Keyword search and `llms.txt` never need it. */
    enabled: z.boolean().default(false),
    /**
     * The language model: `openai` (also any server with an OpenAI-compatible API, with `baseUrl`),
     * `anthropic`, or `custom` for an adapter you pass in code. The key is read from the environment variable
     * DOCKUDOS_LLM_API_KEY, never from this file.
     */
    provider: z.enum(['openai', 'anthropic', 'custom']).optional(),
    /** The model's name, as the provider calls it. */
    model: z.string().min(1).optional(),
    /** The route that answers questions. Default `/api/ask`. */
    endpoint: z
      .string()
      .startsWith('/', 'must start with "/"')
      .default('/api/ask'),
    /** The route that finds the page for a request. Default `/api/navigate`. */
    navigateEndpoint: z
      .string()
      .startsWith('/', 'must start with "/"')
      .default('/api/navigate'),
    /**
     * Other sites, besides this one, that may call the assistant from a browser or frame it with the embeddable
     * widget: origins such as `https://app.acme.com`. Nothing else is let in from another origin.
     */
    allowedOrigins: z
      .array(
        z
          .string()
          .regex(
            /^https?:\/\/[^/\s?#]+$/,
            'must be an origin like https://app.example.com (no path)',
          ),
      )
      .default([]),
    /** Offer "Take me there" in the palette: type what you want, and be taken to the right section. */
    navigation: z.boolean().default(true),
    /** Address of the provider's API, for compatible servers. Not a secret. */
    baseUrl: httpUrl.optional(),
    /** Meaning-based search on top of keywords. Needs DOCKUDOS_EMBEDDINGS_API_KEY (or DOCKUDOS_LLM_API_KEY for OpenAI). */
    embeddings: z
      .strictObject({
        provider: z.enum(['openai']).default('openai'),
        model: z.string().min(1),
        baseUrl: httpUrl.optional(),
        /** Vector length to request, for models that can shorten theirs. */
        dimensions: z.number().int().min(8).max(8192).optional(),
      })
      .optional(),
    limits: z
      .strictObject({
        /** Longest question accepted, in characters. */
        maxQuestionLength: z.number().int().min(20).max(4000).default(500),
        /** Most tokens an answer may use. */
        maxOutputTokens: z.number().int().min(50).max(8000).default(800),
        /** Questions one visitor (by address) may ask per minute. */
        ratePerMinute: z.number().int().min(1).max(600).default(10),
        /** Earlier turns sent along with a question. */
        maxHistoryTurns: z.number().int().min(0).max(20).default(6),
        /** Size of the documentation excerpts given to the model, in tokens (about 4 characters each). */
        contextTokens: z.number().int().min(200).max(32000).default(3000),
      })
      .default(() => ({
        maxQuestionLength: 500,
        maxOutputTokens: 800,
        ratePerMinute: 10,
        maxHistoryTurns: 6,
        contextTokens: 3000,
      })),
  })
  .refine((v) => !v.enabled || v.provider, {
    message: 'is required when ai.enabled is true',
    path: ['provider'],
  })
  .refine((v) => !v.enabled || v.provider === 'custom' || v.model, {
    message: 'is required when ai.enabled is true',
    path: ['model'],
  });

/** A folder below the docs folder where generated pages are written. */
const mountPath = z
  .string()
  .regex(
    /^[A-Za-z0-9][\w-]*(?:\/[A-Za-z0-9][\w-]*)*$/,
    'must be a folder path like "api-reference", without a leading or trailing "/"',
  );

const apiSourceSchema = z.strictObject({
  /** Name to refer to the source by, for example in `navigation`: `{ "openapi": "petstore" }`. */
  name: sourceName,
  /** A file in the project (`specs/petstore.yaml`) or an http(s) URL. OpenAPI 3.0 or 3.1, AsyncAPI 2 or 3, GraphQL SDL or introspection JSON. */
  spec: z.string().min(1),
  /** Where the pages are mounted below the docs folder. Default: the source's name. */
  path: mountPath.optional(),
  /** What the spec is. Detected from the file when left out. */
  type: z.enum(['openapi', 'asyncapi', 'graphql']).optional(),
  /** How OpenAPI endpoints are grouped in the sidebar. */
  groupBy: z.enum(['tag', 'path']).default('tag'),
  /** Title of the overview page. Default: the title in the spec. */
  title: z.string().min(1).optional(),
});

const playgroundSchema = z.strictObject({
  /** Show "Try it" on endpoint pages. */
  enabled: z.boolean().default(true),
  /**
   * Send requests through your site instead of straight from the browser, for APIs without CORS.
   * Off by default: requests go from the browser to the API and the secrets typed in never reach your server.
   * With it on, the secrets pass through your server, which only forwards to the hosts of the spec's servers
   * and of `allowedHosts`.
   */
  proxy: z.boolean().default(false),
  /** Hosts the proxy may call besides the spec's servers, like `api.example.com`. */
  allowedHosts: z.array(z.string().min(1)).default([]),
});

const referenceSourceSchema = z.strictObject({
  name: sourceName,
  /** `typescript`: `.ts` or `.d.ts` files. `python`: the JSON written by `griffe dump`. */
  type: z.enum(['typescript', 'python']),
  /** Files in the project: TypeScript entry points, or the Griffe JSON file. */
  input: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  path: mountPath.optional(),
  title: z.string().min(1).optional(),
});

const uniqueBy = <T extends { name: string; path?: string }>(
  items: T[],
  ctx: z.RefinementCtx,
  where: string[],
) => {
  const names = new Set<string>();
  const paths = new Set<string>();
  items.forEach((item, i) => {
    if (names.has(item.name)) {
      ctx.addIssue({
        code: 'custom',
        message: `the name "${item.name}" is used twice`,
        path: [...where, i, 'name'],
      });
    }
    names.add(item.name);
    const mount = item.path ?? item.name;
    if (paths.has(mount)) {
      ctx.addIssue({
        code: 'custom',
        message: `the path "${mount}" is used twice`,
        path: [...where, i, 'path'],
      });
    }
    paths.add(mount);
  });
};

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
   * `login` (a signed-in user, see `auth`), `basic` (HTTP Basic, credentials from an environment variable),
   * `token` (a bearer token from an environment variable), `custom` (your own `verify` function in the proxy),
   * or `deny` (answer 404).
   */
  require: z.enum(['login', 'basic', 'token', 'custom', 'deny']),
  /** `login` only: the user needs one of these roles. Leave out to let any signed-in user in. */
  roles: z.array(z.string().min(1)).min(1).optional(),
  /** `login` only: the user needs to be in one of these groups. With `roles`, either is enough. */
  groups: z.array(z.string().min(1)).min(1).optional(),
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

const versionName = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    'must be letters, digits, dots, dashes or underscores, like "v2" or "2.1"',
  );

const versionsSchema = z
  .strictObject({
    /** The version served at the site root, without a prefix: the latest one. */
    default: versionName,
    /**
     * Every version. Each one's pages live in `docs/<dir>/` (`dir` defaults to the name); the default version is
     * served at `/`, the others at `/<name>/`.
     */
    list: z
      .array(
        z.strictObject({
          name: versionName,
          /** What the version switcher shows. Default: the name. */
          label: z.string().min(1).optional(),
          /** Folder below `docs/`. Default: the name. */
          dir: z
            .string()
            .regex(/^[A-Za-z0-9][\w.-]*$/, 'must be a single folder name')
            .optional(),
          /** The sidebar of this version, when it differs from `navigation`. Pages it lists but the version lacks are skipped. */
          navigation: z.array(tabSchema).optional(),
          /** `deprecated` shows a warning; `unreleased` shows a "preview" notice. */
          status: z
            .enum(['stable', 'deprecated', 'unreleased'])
            .default('stable'),
        }),
      )
      .min(1),
  })
  .superRefine((v, ctx) => {
    const names = new Set<string>();
    v.list.forEach((item, i) => {
      if (names.has(item.name))
        ctx.addIssue({
          code: 'custom',
          message: `the version "${item.name}" is listed twice`,
          path: ['list', i, 'name'],
        });
      names.add(item.name);
    });
    if (!names.has(v.default))
      ctx.addIssue({
        code: 'custom',
        message: `"${v.default}" is not in the list of versions`,
        path: ['default'],
      });
  });

const localeCode = z
  .string()
  .regex(
    /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/,
    'must be a language tag like "en", "fr" or "pt-BR"',
  );

const i18nSchema = z
  .strictObject({
    /** The language of the pages without a translation, served at the site root. */
    default: localeCode,
    /** Every language, the default included. A string, or `{ code, label, rtl }`. */
    locales: z
      .array(
        z.union([
          localeCode,
          z.strictObject({
            code: localeCode,
            /** What the language switcher shows. Default: the language's own name. */
            label: z.string().min(1).optional(),
            /** Right-to-left. Detected for Arabic, Hebrew, Persian and Urdu when left out. */
            rtl: z.boolean().optional(),
          }),
        ]),
      )
      .min(1),
    /** Send first-time visitors to their browser's language (remembered in a cookie). */
    detect: z.boolean().default(false),
    /** Your own wording for interface text, by language: `{ "fr": { "search": "Rechercher" } }`. */
    messages: z
      .record(localeCode, z.record(z.string(), z.string()))
      .default({}),
  })
  .superRefine((v, ctx) => {
    const codes = v.locales.map((l) => (typeof l === 'string' ? l : l.code));
    if (new Set(codes).size !== codes.length)
      ctx.addIssue({
        code: 'custom',
        message: 'a language is listed twice',
        path: ['locales'],
      });
    if (!codes.includes(v.default))
      ctx.addIssue({
        code: 'custom',
        message: `"${v.default}" is not in the list of locales`,
        path: ['default'],
      });
  });

const authSchema = z.strictObject({
  /** Only OpenID Connect today: Auth0, Okta, Entra ID, Keycloak, Google and the like. */
  provider: z.literal('oidc').default('oidc'),
  /** The provider's issuer URL, where `/.well-known/openid-configuration` lives. */
  issuer: z
    .url()
    .refine(
      (v) =>
        v.startsWith('https://') ||
        /^http:\/\/(localhost|127\.0\.0\.1)/.test(v),
      {
        message: 'must be https (http only for localhost)',
      },
    ),
  clientId: z.string().min(1),
  /** The environment variable holding the client secret. Leave out for a public client (PKCE only). */
  clientSecretEnv: z
    .string()
    .regex(/^[A-Z_][A-Z0-9_]*$/, 'must be an environment variable name')
    .optional(),
  scopes: z.array(z.string().min(1)).default(['openid', 'profile', 'email']),
  /** The claim in the ID token with the user's roles. Dots reach into objects: `realm_access.roles`. */
  rolesClaim: z.string().min(1).default('roles'),
  groupsClaim: z.string().min(1).default('groups'),
  /** How long a sign-in lasts. */
  sessionHours: z
    .number()
    .min(0.1)
    .max(24 * 90)
    .default(12),
});

const changelogSchema = z.strictObject({
  /** The page whose `<Update>` entries make the changelog and its feed, like `/changelog`. */
  path: z.string().startsWith('/', 'must start with "/"').default('/changelog'),
});

const feedsSchema = z.strictObject({
  /** `/changelog.xml`, from the entries on the changelog page. */
  changelog: z.boolean().default(false),
  /** `/rss.xml`, from pages with a `date` in their frontmatter (posts, announcements). */
  posts: z.boolean().default(false),
  /** Most items in a feed. */
  limit: z.number().int().min(1).max(500).default(50),
});

const sourceSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('remote'),
    name: sourceName,
    /** A JSON list of pages: `[{ "path": "guide.mdx", "url": "https://..." }]`, or a GitHub repository. */
    url: z.url(),
    /** Folder below `docs/` the pages are written to. */
    into: mountPath,
    /** Environment variable with a bearer token for the request. */
    tokenEnv: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]*$/)
      .optional(),
    /**
     * Use the pages as MDX exactly as served. Off by default: they are read as Markdown and anything MDX would run
     * (`{…}`, imports, raw HTML) is escaped. Turn it on only for a source you control.
     */
    mdx: z.boolean().default(false),
  }),
  z.strictObject({
    type: z.literal('obsidian'),
    name: sourceName,
    /** The vault folder, relative to the project. */
    dir: z.string().min(1),
    into: mountPath,
  }),
  z.strictObject({
    type: z.literal('html'),
    name: sourceName,
    /** A folder of `.html` files, relative to the project. */
    dir: z.string().min(1),
    into: mountPath,
  }),
  z.strictObject({
    type: z.literal('notion'),
    name: sourceName,
    /** The Notion page or database whose child pages are imported. */
    rootId: z.string().min(1),
    into: mountPath,
    tokenEnv: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]*$/)
      .default('NOTION_TOKEN'),
  }),
  z.strictObject({
    type: z.literal('sanity'),
    name: sourceName,
    projectId: z.string().min(1),
    dataset: z.string().min(1).default('production'),
    /** GROQ query returning `{ _id, title, slug, body }` documents (Markdown in `body`). */
    query: z.string().min(1),
    into: mountPath,
    tokenEnv: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]*$/)
      .optional(),
  }),
]);

const iconPackSchema = z.union([
  z.string().min(1),
  z.strictObject({
    /** Folder of `.svg` files, relative to the project root. */
    dir: z.string().min(1),
    /** Make every fixed color follow the text color, so the icons suit light and dark mode. */
    monochrome: z.boolean().default(false),
  }),
]);

/**
 * Shape of `docs.json`. Strict: unknown keys are rejected so typos fail the
 * build instead of being silently ignored. Later phases add keys.
 */
export const docsConfigSchema = z
  .strictObject({
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
    /** Several versions of the docs, each in its own folder. */
    versions: versionsSchema.optional(),
    /** Several languages, each in its own folder. */
    i18n: i18nSchema.optional(),
    /** Sign-in for `access` rules with `require: "login"`. The secret is `DOCKUDOS_AUTH_SECRET`. */
    auth: authSchema.optional(),
    changelog: changelogSchema.default(() => changelogSchema.parse({})),
    feeds: feedsSchema.default(() => feedsSchema.parse({})),
    /** Content fetched or converted from elsewhere by `dockudos sync`: remote files, Obsidian, HTML, Notion, Sanity. */
    sources: z.array(sourceSchema).default([]),
    kudos: kudosSchema.default(() => kudosSchema.parse({})),
    actions: actionsSchema.default(() => actionsSchema.parse({})),
    /** Search: where it runs and how many results it shows. */
    search: searchSchema.default(() => searchSchema.parse({})),
    /** The assistant, AI navigation and meaning-based search. Off by default; keys come from the environment. */
    ai: aiSchema.default(() => aiSchema.parse({})),
    /** Keyboard shortcuts: search, previous and next page, theme, and the help dialog. */
    shortcuts: z.boolean().default(true),
    /** Protect routes. The first rule that matches a path decides. Secrets live in environment variables, never here. */
    /** Your own icons. */
    icons: z
      .strictObject({
        /**
         * Folders of SVG files, by the name you use in front of the icon: `{ "acme": "icons/acme" }` makes
         * `icons/acme/logo.svg` available as `acme:logo`.
         */
        packs: z
          .record(
            z
              .string()
              .regex(
                /^[a-z][a-z0-9-]*$/,
                'must be lowercase letters, digits and dashes, like "acme"',
              ),
            iconPackSchema,
          )
          .default({}),
      })
      .default(() => ({ packs: {} })),
    access: z
      .strictObject({ rules: z.array(accessRuleSchema).default([]) })
      .default(() => ({ rules: [] })),
    /** API reference pages generated from OpenAPI, AsyncAPI and GraphQL specs, and the playground. */
    openapi: z
      .strictObject({
        sources: z.array(apiSourceSchema).default([]),
        playground: playgroundSchema.default(() => playgroundSchema.parse({})),
      })
      .superRefine((v, ctx) => uniqueBy(v.sources, ctx, ['sources']))
      .default(() => ({
        sources: [],
        playground: playgroundSchema.parse({}),
      })),
    /** Reference pages generated from TypeScript definitions and Python packages. */
    reference: z
      .strictObject({ sources: z.array(referenceSourceSchema).default([]) })
      .superRefine((v, ctx) => uniqueBy(v.sources, ctx, ['sources']))
      .default(() => ({ sources: [] })),
  })
  .superRefine((config, ctx) => {
    const codes = new Set(
      (config.i18n?.locales ?? []).map((l) =>
        typeof l === 'string' ? l : l.code,
      ),
    );
    config.versions?.list.forEach((v, i) => {
      if (codes.has(v.name))
        ctx.addIssue({
          code: 'custom',
          message: `"${v.name}" is also a language code; URLs could not tell them apart`,
          path: ['versions', 'list', i, 'name'],
        });
    });
    config.access.rules.forEach((rule, i) => {
      if (rule.require === 'login' && !config.auth)
        ctx.addIssue({
          code: 'custom',
          message:
            'needs the "auth" block of docs.json to say how people sign in',
          path: ['access', 'rules', i, 'require'],
        });
      if ((rule.roles || rule.groups) && rule.require !== 'login')
        ctx.addIssue({
          code: 'custom',
          message: '"roles" and "groups" only work with require: "login"',
          path: ['access', 'rules', i, rule.roles ? 'roles' : 'groups'],
        });
    });
    const names = new Set<string>();
    config.sources.forEach((s, i) => {
      if (names.has(s.name))
        ctx.addIssue({
          code: 'custom',
          message: `the name "${s.name}" is used twice`,
          path: ['sources', i, 'name'],
        });
      names.add(s.name);
    });
  });

export type ApiSourceConfig = z.output<typeof apiSourceSchema>;
export type ReferenceSourceConfig = z.output<typeof referenceSourceSchema>;

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
    const secret = issue.keys.some((k) => /key|secret|token|password/i.test(k));
    const hint =
      secret && issue.path[0] === 'ai'
        ? '. Secrets never go in docs.json: set the DOCKUDOS_LLM_API_KEY environment variable'
        : '';
    return [`unknown key ${extra.join(', ')}${hint}`];
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
