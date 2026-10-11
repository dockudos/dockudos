import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * Keep the network part of an address and drop the host part: IPv4 to /24 (`203.0.113.77` -> `203.0.113.0`),
 * IPv6 to /48. The truncated value is used for one hash and never stored.
 */
export function truncateIp(ip: string | undefined): string {
  const raw = (ip ?? '').trim().replace(/^\[|\]$/g, '').split('%')[0]!;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw);
  const addr = mapped ? mapped[1]! : raw;
  const kind = isIP(addr);
  if (kind === 4) return `${addr.split('.').slice(0, 3).join('.')}.0`;
  if (kind === 6) {
    const groups = expandV6(addr);
    return `${groups.slice(0, 3).join(':')}::`;
  }
  return '0.0.0.0';
}

function expandV6(addr: string): string[] {
  const [head = '', tail = ''] = addr.split('::');
  const h = head ? head.split(':') : [];
  const t = addr.includes('::') && tail ? tail.split(':') : [];
  const fill = addr.includes('::') ? Array(Math.max(0, 8 - h.length - t.length)).fill('0') : [];
  return [...h, ...fill, ...t].map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''));
}

/**
 * A visitor id that counts a person once per day without a cookie and without being a tracking identifier:
 * HMAC of (site, truncated IP, user agent, day) under a server secret. It changes every day, so a visitor cannot be
 * followed from one day to the next, and without the secret it cannot be reversed to an address.
 */
export function dailyVisitor(secret: string, siteId: string, ip: string | undefined, userAgent: string | undefined, day: string): string {
  return createHmac('sha256', secret)
    .update(`${day}\0${siteId}\0${truncateIp(ip)}\0${(userAgent ?? '').slice(0, 300)}`)
    .digest('hex')
    .slice(0, 24);
}

const AI_AGENTS: [RegExp, string][] = [
  [/GPTBot|ChatGPT-User|OAI-SearchBot/i, 'OpenAI'],
  [/ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|Claude-Web/i, 'Anthropic'],
  [/PerplexityBot|Perplexity-User/i, 'Perplexity'],
  [/Google-Extended|GoogleOther|Gemini/i, 'Google AI'],
  [/CCBot/i, 'Common Crawl'],
  [/Bytespider/i, 'ByteDance'],
  [/Meta-ExternalAgent|FacebookBot|meta-externalfetcher/i, 'Meta AI'],
  [/Amazonbot/i, 'Amazon'],
  [/Applebot-Extended/i, 'Apple AI'],
  [/cohere-ai|MistralAI-User|YouBot|DuckAssistBot/i, 'Other AI'],
  [/modelcontextprotocol|mcp-client|\bmcp\b/i, 'MCP client'],
];
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|headless|lighthouse|monitor|uptime|curl\/|wget|python-requests|go-http-client|okhttp|axios|node-fetch/i;

export interface TrafficClass { traffic: 'human' | 'ai' | 'bot'; agent?: string }

/** Tell people, AI tools and other bots apart by user agent. A hint from the docs site itself (MCP, llms.txt) wins. */
export function classifyTraffic(userAgent: string | undefined, hint?: string): TrafficClass {
  if (hint === 'ai') return { traffic: 'ai', agent: 'MCP client' };
  const ua = userAgent ?? '';
  for (const [re, agent] of AI_AGENTS) if (re.test(ua)) return { traffic: 'ai', agent };
  if (!ua || BOT.test(ua)) return { traffic: 'bot' };
  return { traffic: 'human' };
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LONG_NUMBER = /\d[\d\s().-]{7,}\d/g;
const SECRET_LIKE = /\b(?:[A-Za-z0-9_-]{24,}|(?:sk|pk|ghp|gho|xox[bap]|AKIA)[A-Za-z0-9_-]{10,})\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Remove what looks personal or secret from free text a visitor typed (a search, a question) before it is stored. */
export function scrubText(text: string, max = 200): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(UUID, '[id]')
    .replace(SECRET_LIKE, '[token]')
    .replace(LONG_NUMBER, '[number]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** A path with no query string, fragment or credentials; the part visitors' pages are identified by. */
export function cleanPath(input: string | undefined): string | undefined {
  if (!input) return undefined;
  let path = input;
  try {
    path = input.startsWith('http') ? new URL(input).pathname : input;
  } catch {
    return undefined;
  }
  path = path.split(/[?#]/)[0]!;
  if (!path.startsWith('/') || path.length > 300 || /[\0\s]/.test(path)) return undefined;
  return path.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
}

/** Only the host of a referrer: never the path or query, which can carry anything. */
export function referrerHost(referrer: string | undefined): string | undefined {
  if (!referrer) return undefined;
  try {
    return new URL(referrer).hostname.toLowerCase().slice(0, 100);
  } catch {
    return undefined;
  }
}
