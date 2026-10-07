import { buildContentIndex } from './content-index.ts';
import {
  type Fetcher,
  createEndpointBackend,
  createKeywordBackend,
  createSearchClient,
  fetchIndex,
} from './search-backend.ts';
import type { SearchBackend, SearchHit } from './keyword-search.ts';

const { index } = buildContentIndex([
  { path: '/a', title: 'Alpha', body: '## Setup\n\nInstall the thing.' },
]);

const hit: SearchHit = {
  id: '1',
  path: '/a',
  title: 'Alpha',
  headingPath: [],
  anchor: '',
  url: '/a',
  snippet: { text: 'x', ranges: [] },
  score: 1,
};

describe('createKeywordBackend', () => {
  it('loads the index on first use, once', async () => {
    const load = vi.fn(async () => index);
    const backend = createKeywordBackend(load);
    expect(load).not.toHaveBeenCalled();
    const [first, second] = await Promise.all([
      backend.search('install'),
      backend.search('setup'),
    ]);
    expect(first[0]?.url).toBe('/a#setup');
    expect(second[0]?.url).toBe('/a#setup');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('retries after a failed load', async () => {
    const load = vi
      .fn<() => Promise<typeof index>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(index);
    const backend = createKeywordBackend(load);
    await expect(backend.search('install')).rejects.toThrow('offline');
    expect(await backend.search('install')).toHaveLength(1);
  });
});

describe('fetchIndex', () => {
  it('fetches and returns the index; reports failures', async () => {
    const ok: Fetcher = async () => ({
      ok: true,
      status: 200,
      json: async () => index,
    });
    expect(await fetchIndex('/api/search/index', ok)()).toEqual(index);
    const bad: Fetcher = async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    await expect(fetchIndex('/x', bad)()).rejects.toThrow('503');
  });
});

describe('createEndpointBackend', () => {
  it('sends the query and returns valid hits', async () => {
    const seen: string[] = [];
    const fetcher: Fetcher = async (url) => {
      seen.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ hits: [hit, { nonsense: true }] }),
      };
    };
    const backend = createEndpointBackend('/api/search', { fetcher });
    expect(await backend.search('a b', { limit: 5 })).toEqual([hit]);
    expect(seen).toEqual(['/api/search?q=a+b&limit=5']);
  });

  it('rejects errors and malformed answers', async () => {
    const fail: Fetcher = async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    await expect(
      createEndpointBackend('/s', { fetcher: fail }).search('x'),
    ).rejects.toThrow('500');
    const odd: Fetcher = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    });
    await expect(
      createEndpointBackend('/s?x=1', { fetcher: odd }).search('x'),
    ).rejects.toThrow('hits');
  });
});

describe('createSearchClient', () => {
  const make = () => {
    const search = vi.fn(async () => [hit]);
    const backend: SearchBackend = { id: 't', search };
    return { search, client: createSearchClient(backend, { cacheSize: 2 }) };
  };

  it('answers blank queries without calling the backend', async () => {
    const { client, search } = make();
    expect(await client.search('   ')).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it('trims, caches and shares requests in flight', async () => {
    const { client, search } = make();
    await Promise.all([client.search(' a  b '), client.search('a b')]);
    await client.search('a b');
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('a b', {});
  });

  it('forgets the oldest query beyond the cache size', async () => {
    const { client, search } = make();
    await client.search('one');
    await client.search('two');
    await client.search('three');
    await client.search('one');
    expect(search).toHaveBeenCalledTimes(4);
  });

  it('does not cache failures or filtered queries', async () => {
    const search = vi
      .fn<SearchBackend['search']>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([hit]);
    const client = createSearchClient({ id: 't', search });
    await expect(client.search('x')).rejects.toThrow('boom');
    await client.search('x');
    await client.search('x', { filter: () => true });
    await client.search('x', { filter: () => true });
    expect(search).toHaveBeenCalledTimes(4);
  });
});
