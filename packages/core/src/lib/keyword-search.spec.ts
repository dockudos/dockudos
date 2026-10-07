import { buildContentIndex } from './content-index.ts';
import {
  KeywordSearch,
  makeSnippet,
  stem,
  tokenize,
} from './keyword-search.ts';

const pages = [
  {
    path: '/guides/auth',
    title: 'Authentication',
    description: 'Sign requests with keys',
    body: `Every request needs a key.

## API keys

Create a key in the dashboard. Rotate a key every ninety days.

## Errors

A bad key returns ERR_INVALID_KEY with status 401. Error code E1042 means the key expired.
`,
  },
  {
    path: '/guides/proxy',
    title: 'Access proxy',
    body: `Protect pages with a proxy.

## createAccessProxy

Call createAccessProxy() in src/proxy.ts to apply the rules from docs.json.
`,
  },
  {
    path: '/guides/billing',
    title: 'Billing',
    body: `Manage your plan.

## Change the billing email

Open Settings, then Billing, and edit the email address that receives invoices.

## Invoices

Invoices are sent monthly. Authentication is not needed to download them.
`,
  },
];

const engine = new KeywordSearch(buildContentIndex(pages).index);
const top = (q: string, n = 1) =>
  engine.search(q, { limit: n }).map((h) => h.url);

describe('tokenize', () => {
  it('lowercases, splits identifiers and keeps the whole name', () => {
    expect(tokenize('createAccessProxy')).toEqual([
      'createaccessproxy',
      'creat',
      'access',
      'proxy',
    ]);
    expect(tokenize('ERR_INVALID_KEY')).toEqual([
      'err_invalid_key',
      'err',
      'invalid',
      'key',
    ]);
    expect(tokenize('E1042')).toEqual(['e1042']);
  });

  it('stems plurals and verb forms but leaves codes alone', () => {
    expect(stem('keys')).toBe('key');
    expect(stem('rotating')).toBe(stem('rotated'));
    expect(stem('rotate')).toBe(stem('rotated'));
    expect(stem('policies')).toBe('policy');
    expect(stem('status')).toBe('status');
    expect(stem('e1042')).toBe('e1042');
  });
});

describe('KeywordSearch', () => {
  it('finds an exact API name', () => {
    expect(top('createAccessProxy')).toEqual([
      '/guides/proxy#createaccessproxy',
    ]);
  });

  it('finds an API name by one of its parts', () => {
    expect(top('access proxy')[0]).toMatch(/^\/guides\/proxy/);
  });

  it('finds an error code, whole or in part', () => {
    expect(top('ERR_INVALID_KEY')).toEqual(['/guides/auth#errors']);
    expect(top('E1042')).toEqual(['/guides/auth#errors']);
  });

  it('forgives typos', () => {
    expect(top('authentcation')[0]).toMatch(/^\/guides\/auth/);
    expect(top('invioces')[0]).toBe('/guides/billing#invoices');
    expect(top('rotaet')).toEqual(['/guides/auth#api-keys']); // swapped letters
  });

  it('matches the word being typed as a prefix', () => {
    expect(top('billi')[0]).toMatch(/^\/guides\/billing/);
    expect(top('rota')).toEqual(['/guides/auth#api-keys']);
  });

  it('matches plural and verb forms', () => {
    expect(top('rotating keys')).toEqual(['/guides/auth#api-keys']);
  });

  it('ranks a heading match above a body match', () => {
    // "Authentication" is the title of one page and only a word in the billing body.
    const hits = engine.search('authentication');
    expect(hits[0]?.path).toBe('/guides/auth');
    const billing = hits.findIndex((h) => h.path === '/guides/billing');
    expect(billing).toBeGreaterThan(0);
  });

  it('prefers the section whose heading is the query', () => {
    expect(top('change the billing email')).toEqual([
      '/guides/billing#change-the-billing-email',
    ]);
    expect(top('Invoices')).toEqual(['/guides/billing#invoices']);
  });

  it('handles natural-language questions by dropping filler words', () => {
    expect(top('how do I rotate a key?')).toEqual(['/guides/auth#api-keys']);
  });

  it('returns nothing for nonsense, blank and filler-only queries', () => {
    expect(engine.search('zzzqqqxxx')).toEqual([]);
    expect(engine.search('   ')).toEqual([]);
    expect(engine.search('')).toEqual([]);
  });

  it('returns hits with a link, heading path and highlighted snippet', () => {
    const [hit] = engine.search('rotate');
    expect(hit).toMatchObject({
      path: '/guides/auth',
      title: 'Authentication',
      headingPath: ['API keys'],
      anchor: 'api-keys',
      url: '/guides/auth#api-keys',
    });
    const marked = hit?.snippet.ranges.map(([s, e]) =>
      hit.snippet.text.slice(s, e),
    );
    expect(marked).toEqual(['Rotate']);
  });

  it('links to the page itself for text before the first heading', () => {
    const [hit] = engine.search('manage plan', { limit: 1 });
    expect(hit?.anchor).toBe('');
    expect(hit?.url).toBe('/guides/billing');
  });

  it('honours limit, maxPerPage and filter', () => {
    expect(engine.search('key', { limit: 1 })).toHaveLength(1);
    const perPage = engine.search('key', { maxPerPage: 1 });
    expect(new Set(perPage.map((h) => h.path)).size).toBe(perPage.length);
    const filtered = engine.search('authentication', {
      filter: (_chunk, page) => page.path !== '/guides/auth',
    });
    expect(filtered.every((h) => h.path !== '/guides/auth')).toBe(true);
  });

  it('is deterministic', () => {
    expect(engine.search('key')).toEqual(engine.search('key'));
  });

  it('works on an empty index', () => {
    expect(new KeywordSearch({ pages: [], chunks: [] }).search('x')).toEqual(
      [],
    );
  });
});

describe('makeSnippet', () => {
  it('shortens long text around the first match with ellipses', () => {
    const text = `${'filler '.repeat(60)}needle ${'more '.repeat(60)}`;
    const s = makeSnippet(text, new Set(tokenize('needle')));
    expect(s.text.length).toBeLessThanOrEqual(165);
    expect(s.text.startsWith('…')).toBe(true);
    expect(s.text.endsWith('…')).toBe(true);
    expect(s.ranges.map(([a, b]) => s.text.slice(a, b))).toEqual(['needle']);
  });
});
