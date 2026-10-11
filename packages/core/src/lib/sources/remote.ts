import {
  type HttpFetch,
  assertFetchable,
  getBytes,
  getJson,
  isPrivateHost,
} from './http.ts';
import {
  type ContentSource,
  type SourceFile,
  SourceError,
  isPageFile,
  isSafePath,
  mdxSafe,
  sortFiles,
} from './types.ts';

export interface RemoteOptions {
  name: string;
  /** A JSON list of `{ "path": "guide.mdx", "url": "https://…" }` (or `{ "files": [...] }`). */
  url: string;
  /** Bearer token for every request. */
  token?: string;
  /** Use pages as MDX exactly as served. Off: they are Markdown, and anything MDX would run is escaped. */
  mdx?: boolean;
  fetch?: HttpFetch;
  /** Most files read. Default 500. */
  limit?: number;
}

/** Pages listed by a URL: for docs kept in a repository, a CMS export or a build artifact. */
export function createRemoteSource(o: RemoteOptions): ContentSource {
  return {
    name: o.name,
    async read(signal) {
      assertFetchable(o.url, o.name);
      const headers = {
        accept: 'application/json',
        ...(o.token && { authorization: `Bearer ${o.token}` }),
      };
      const listing = await getJson<unknown>(o.url, o.name, {
        fetch: o.fetch,
        headers,
        signal,
      });
      const entries = Array.isArray(listing)
        ? listing
        : listing &&
            typeof listing === 'object' &&
            Array.isArray((listing as { files?: unknown }).files)
          ? (listing as { files: unknown[] }).files
          : undefined;
      if (!entries)
        throw new SourceError(
          `${o.name}: ${o.url} must answer a list of { path, url }.`,
        );
      const limit = o.limit ?? 500;
      if (entries.length > limit)
        throw new SourceError(
          `${o.name}: ${entries.length} files is more than the limit of ${limit}.`,
        );

      const files: SourceFile[] = [];
      for (const entry of entries) {
        const { path, url } = (entry ?? {}) as {
          path?: unknown;
          url?: unknown;
        };
        if (
          typeof path !== 'string' ||
          typeof url !== 'string' ||
          !isSafePath(path)
        )
          throw new SourceError(
            `${o.name}: an entry has a missing or unsafe path or url (${JSON.stringify(path)}).`,
          );
        const target = new URL(url, o.url);
        // The token goes to the listing's host only, never to a host the listing names.
        const sameHost = target.host === new URL(o.url).host;
        // A listing may point at other hosts, but not at the inside of a network: that is how a list makes a build machine
        // fetch from places only it can reach.
        if (!sameHost && isPrivateHost(target.hostname))
          throw new SourceError(
            `${o.name}: ${target.hostname} is a private address, which a list from ${new URL(o.url).host} may not point at.`,
          );
        const bytes = await getBytes(target.toString(), o.name, {
          fetch: o.fetch,
          signal,
          headers: sameHost ? headers : undefined,
          maxBytes: isPageFile(path) ? 1_000_000 : 10_000_000,
        });
        if (!isPageFile(path)) {
          files.push({ path, content: bytes });
          continue;
        }
        const text = new TextDecoder().decode(bytes);
        files.push({
          path: o.mdx ? path : path.replace(/\.mdx$/i, '.md'),
          content: o.mdx ? text : mdxSafe(text),
        });
      }
      return sortFiles(files);
    },
  };
}
