import { z } from 'zod';

/** The services one process can run. The Compose file starts the same image once per service. */
export const SERVICES = [
  'web',
  'hooks',
  'analytics',
  'auth',
  'editor',
  'worker',
  'agent',
  'site',
] as const;
export type ServiceName = (typeof SERVICES)[number];

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .default('false')
  .transform((v) => v === 'true' || v === '1');
const optional = z
  .string()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

const envSchema = z.object({
  DOCKUDOS_DATABASE_URL: z.string().min(1, 'is required'),
  DOCKUDOS_PUBLIC_URL: z.url(),
  DOCKUDOS_SESSION_SECRET: z
    .string()
    .min(32, 'must be at least 32 characters (try `openssl rand -hex 32`)'),
  /** Most database connections this process opens. Keep (processes x this) under Postgres `max_connections`. */
  DOCKUDOS_DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  DOCKUDOS_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DOCKUDOS_LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error', 'silent'])
    .default('info'),
  DOCKUDOS_SERVICES: z.string().default(SERVICES.join(',')),
  DOCKUDOS_WORKER_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(1)
    .max(64)
    .default(2),
  DOCKUDOS_DATA_DIR: z.string().default('/var/lib/dockudos'),

  // Object storage: S3-compatible when an endpoint is set, a directory otherwise.
  DOCKUDOS_S3_ENDPOINT: optional,
  DOCKUDOS_S3_REGION: z.string().default('us-east-1'),
  DOCKUDOS_S3_BUCKET: z.string().default('dockudos'),
  DOCKUDOS_S3_ACCESS_KEY: optional,
  DOCKUDOS_S3_SECRET_KEY: optional,

  // Sign-in. Without an issuer, only API keys work.
  DOCKUDOS_OIDC_ISSUER: optional,
  DOCKUDOS_OIDC_CLIENT_ID: optional,
  DOCKUDOS_OIDC_CLIENT_SECRET: optional,
  DOCKUDOS_OIDC_ROLES_CLAIM: z.string().default('roles'),
  DOCKUDOS_OIDC_GROUPS_CLAIM: z.string().default('groups'),
  /** The first user to sign in with this email becomes the owner of the instance. */
  DOCKUDOS_ADMIN_EMAIL: optional,

  // Git providers.
  DOCKUDOS_GITHUB_TOKEN: optional,
  DOCKUDOS_GITHUB_API_URL: z.string().default('https://api.github.com'),
  DOCKUDOS_GITLAB_TOKEN: optional,
  DOCKUDOS_GITLAB_API_URL: z.string().default('https://gitlab.com/api/v4'),

  // The docs agent's model (bring your own key; the key itself is DOCKUDOS_LLM_API_KEY).
  DOCKUDOS_LLM_PROVIDER: z.enum(['openai', 'anthropic']).optional(),
  DOCKUDOS_LLM_MODEL: optional,
  DOCKUDOS_LLM_BASE_URL: optional,

  /** Where the platform answers and what it shares. */
  DOCKUDOS_METRICS_TOKEN: optional,
  /** Domain for the private-docs cookie, so docs on a sibling subdomain see the sign-in. */
  DOCKUDOS_COOKIE_DOMAIN: optional,
  /** The `DOCKUDOS_AUTH_SECRET` of the docs sites, to sign them in when a person signs in to the platform. */
  DOCKUDOS_DOCS_AUTH_SECRET: optional,
  /** Believe `X-Forwarded-For` for the client address. Only behind a proxy you control that sets it. */
  DOCKUDOS_TRUST_PROXY: bool,
  /** Built sites are served at `<slug>.<this domain>`. Must not be the platform's own host. */
  DOCKUDOS_SITES_DOMAIN: optional,

  // Analytics privacy.
  DOCKUDOS_ANALYTICS_LOG_CONVERSATIONS: bool,
  DOCKUDOS_ANALYTICS_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  DOCKUDOS_CONVERSATION_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .default(30),

  // Agent. The LLM key itself is read by @dockudos/core (DOCKUDOS_LLM_API_KEY).
  DOCKUDOS_AGENT_ENABLED: bool,
  /** Hosts the platform may fetch from besides the configured Git providers. Everything else is refused. */
  DOCKUDOS_FETCH_ALLOW_HOSTS: z.string().default(''),
  /** Allow private and loopback addresses in outbound fetches. For local development only. */
  DOCKUDOS_FETCH_ALLOW_PRIVATE: bool,
});

export interface PlatformConfig {
  databaseUrl: string;
  publicUrl: string;
  sessionSecret: string;
  port: number;
  dbPoolMax: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  services: ServiceName[];
  workerConcurrency: number;
  dataDir: string;
  s3?: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
  };
  oidc?: {
    issuer: string;
    clientId: string;
    clientSecret?: string;
    rolesClaim: string;
    groupsClaim: string;
  };
  adminEmail?: string;
  github: { token?: string; apiUrl: string };
  gitlab: { token?: string; apiUrl: string };
  analytics: {
    logConversations: boolean;
    retentionDays: number;
    conversationRetentionDays: number;
  };
  agentEnabled: boolean;
  llm?: {
    provider: 'openai' | 'anthropic';
    model: string;
    baseUrl?: string;
    apiKey: string;
  };
  metricsToken?: string;
  cookieDomain?: string;
  docsAuthSecret?: string;
  sitesDomain?: string;
  trustProxy: boolean;
  fetchAllowHosts: string[];
  fetchAllowPrivate: boolean;
  /** Every secret value in the configuration, for the logger to scrub. */
  secrets: string[];
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
    this.name = 'ConfigError';
  }
}

/** Read the platform configuration from environment variables. Throws one error listing every problem. */
export function loadConfig(
  env: Record<string, string | undefined>,
): PlatformConfig {
  const parsed = envSchema.safeParse(env);
  const problems: string[] = [];
  if (!parsed.success)
    for (const issue of parsed.error.issues)
      problems.push(`${String(issue.path[0] ?? '?')} ${issue.message}`);
  const e = parsed.success ? parsed.data : undefined;
  const get = (k: string) => (env[k] === '' ? undefined : env[k]);
  // Cross-field checks read the raw environment, so they are reported even when another variable is wrong.
  const services: ServiceName[] = [];
  for (const raw of (get('DOCKUDOS_SERVICES') ?? SERVICES.join(',')).split(
    ',',
  )) {
    const name = raw.trim();
    if (!name) continue;
    if ((SERVICES as readonly string[]).includes(name))
      services.push(name as ServiceName);
    else problems.push(`DOCKUDOS_SERVICES has an unknown service "${name}"`);
  }
  const s3 = [
    get('DOCKUDOS_S3_ENDPOINT'),
    get('DOCKUDOS_S3_ACCESS_KEY'),
    get('DOCKUDOS_S3_SECRET_KEY'),
  ];
  if (s3.some(Boolean) && !s3.every(Boolean))
    problems.push(
      'DOCKUDOS_S3_ENDPOINT, DOCKUDOS_S3_ACCESS_KEY and DOCKUDOS_S3_SECRET_KEY go together',
    );
  if (get('DOCKUDOS_OIDC_ISSUER') && !get('DOCKUDOS_OIDC_CLIENT_ID'))
    problems.push('DOCKUDOS_OIDC_ISSUER needs DOCKUDOS_OIDC_CLIENT_ID');
  const sitesDomain = get('DOCKUDOS_SITES_DOMAIN')?.toLowerCase();
  if (sitesDomain) {
    const host = (() => {
      try {
        return new URL(get('DOCKUDOS_PUBLIC_URL') ?? '').hostname;
      } catch {
        return '';
      }
    })();
    if (host && (host === sitesDomain || host.endsWith(`.${sitesDomain}`)))
      problems.push(
        'DOCKUDOS_SITES_DOMAIN must not be the own host of the platform or a parent of it: hosted documentation runs its own scripts and must stay on a different origin',
      );
  }
  if (problems.length || !e) throw new ConfigError(problems);

  const secrets = [
    e.DOCKUDOS_SESSION_SECRET,
    e.DOCKUDOS_S3_SECRET_KEY,
    e.DOCKUDOS_S3_ACCESS_KEY,
    e.DOCKUDOS_OIDC_CLIENT_SECRET,
    e.DOCKUDOS_GITHUB_TOKEN,
    e.DOCKUDOS_GITLAB_TOKEN,
    env['DOCKUDOS_LLM_API_KEY'],
    env['DOCKUDOS_EMBEDDINGS_API_KEY'],
    e.DOCKUDOS_METRICS_TOKEN,
    e.DOCKUDOS_DOCS_AUTH_SECRET,
    passwordOf(e.DOCKUDOS_DATABASE_URL),
  ].filter((v): v is string => typeof v === 'string' && v.length >= 6);

  return {
    databaseUrl: e.DOCKUDOS_DATABASE_URL,
    publicUrl: e.DOCKUDOS_PUBLIC_URL.replace(/\/+$/, ''),
    sessionSecret: e.DOCKUDOS_SESSION_SECRET,
    port: e.DOCKUDOS_PORT,
    dbPoolMax: e.DOCKUDOS_DB_POOL_MAX,
    logLevel: e.DOCKUDOS_LOG_LEVEL,
    services,
    workerConcurrency: e.DOCKUDOS_WORKER_CONCURRENCY,
    dataDir: e.DOCKUDOS_DATA_DIR,
    ...(e.DOCKUDOS_S3_ENDPOINT && {
      s3: {
        endpoint: e.DOCKUDOS_S3_ENDPOINT,
        region: e.DOCKUDOS_S3_REGION,
        bucket: e.DOCKUDOS_S3_BUCKET,
        accessKey: e.DOCKUDOS_S3_ACCESS_KEY as string,
        secretKey: e.DOCKUDOS_S3_SECRET_KEY as string,
      },
    }),
    ...(e.DOCKUDOS_OIDC_ISSUER && {
      oidc: {
        issuer: e.DOCKUDOS_OIDC_ISSUER,
        clientId: e.DOCKUDOS_OIDC_CLIENT_ID as string,
        ...(e.DOCKUDOS_OIDC_CLIENT_SECRET && {
          clientSecret: e.DOCKUDOS_OIDC_CLIENT_SECRET,
        }),
        rolesClaim: e.DOCKUDOS_OIDC_ROLES_CLAIM,
        groupsClaim: e.DOCKUDOS_OIDC_GROUPS_CLAIM,
      },
    }),
    ...(e.DOCKUDOS_ADMIN_EMAIL && {
      adminEmail: e.DOCKUDOS_ADMIN_EMAIL.toLowerCase(),
    }),
    github: {
      ...(e.DOCKUDOS_GITHUB_TOKEN && { token: e.DOCKUDOS_GITHUB_TOKEN }),
      apiUrl: e.DOCKUDOS_GITHUB_API_URL.replace(/\/+$/, ''),
    },
    gitlab: {
      ...(e.DOCKUDOS_GITLAB_TOKEN && { token: e.DOCKUDOS_GITLAB_TOKEN }),
      apiUrl: e.DOCKUDOS_GITLAB_API_URL.replace(/\/+$/, ''),
    },
    analytics: {
      logConversations: e.DOCKUDOS_ANALYTICS_LOG_CONVERSATIONS,
      retentionDays: e.DOCKUDOS_ANALYTICS_RETENTION_DAYS,
      conversationRetentionDays: e.DOCKUDOS_CONVERSATION_RETENTION_DAYS,
    },
    trustProxy: e.DOCKUDOS_TRUST_PROXY,
    agentEnabled: e.DOCKUDOS_AGENT_ENABLED,
    ...(e.DOCKUDOS_LLM_PROVIDER &&
      e.DOCKUDOS_LLM_MODEL &&
      env['DOCKUDOS_LLM_API_KEY'] && {
        llm: {
          provider: e.DOCKUDOS_LLM_PROVIDER,
          model: e.DOCKUDOS_LLM_MODEL,
          apiKey: env['DOCKUDOS_LLM_API_KEY'],
          ...(e.DOCKUDOS_LLM_BASE_URL && { baseUrl: e.DOCKUDOS_LLM_BASE_URL }),
        },
      }),
    ...(e.DOCKUDOS_METRICS_TOKEN && { metricsToken: e.DOCKUDOS_METRICS_TOKEN }),
    ...(e.DOCKUDOS_COOKIE_DOMAIN && { cookieDomain: e.DOCKUDOS_COOKIE_DOMAIN }),
    ...(e.DOCKUDOS_DOCS_AUTH_SECRET && {
      docsAuthSecret: e.DOCKUDOS_DOCS_AUTH_SECRET,
    }),
    ...(e.DOCKUDOS_SITES_DOMAIN && {
      sitesDomain: e.DOCKUDOS_SITES_DOMAIN.toLowerCase(),
    }),
    fetchAllowHosts: e.DOCKUDOS_FETCH_ALLOW_HOSTS.split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    fetchAllowPrivate: e.DOCKUDOS_FETCH_ALLOW_PRIVATE,
    secrets,
  };
}

function passwordOf(url: string): string | undefined {
  try {
    return new URL(url).password || undefined;
  } catch {
    return undefined;
  }
}
