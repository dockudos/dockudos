import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApiSourceConfig, DocsConfig } from '../config.ts';
import { bundleExternalRefs, parseSpecText } from './bundle.ts';
import { type GeneratedFile, generateOpenApi } from './generate-openapi.ts';
import { generateAsyncApi, normalizeAsyncApi } from './asyncapi.ts';
import { generateGraphql, readGraphqlSchema } from './graphql.ts';
import { normalizeOpenApi, openApiVersion } from './openapi.ts';
import { generateReferences } from './reference.ts';
import { ApiSpecError, type ApiModel } from './types.ts';

/** Written next to the generated pages; lists what was written so stale files can be removed and nothing else is. */
export const MANIFEST = '.dockudos/api/manifest.json';
/** Bump when the generated output changes, so cached results are not reused. */
const GENERATOR_VERSION = 4;

const isUrl = (s: string) => /^https?:\/\//i.test(s);

export interface ReadSpecOptions {
  /** `fetch`, for tests. */
  fetch?: typeof fetch;
  /** Give up on a download after this long. Default 30 s. */
  timeoutMs?: number;
}

/** Read a spec from a file in the project or from a URL. Failure names the location and the reason. */
export async function readSpecText(
  location: string,
  root: string,
  { fetch: doFetch = fetch, timeoutMs = 30_000 }: ReadSpecOptions = {},
): Promise<string> {
  if (isUrl(location)) {
    let response: Response;
    try {
      response = await doFetch(location, {
        headers: {
          accept:
            'application/json, application/yaml, text/yaml, text/plain, */*;q=0.1',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const reason =
        e instanceof Error && e.name === 'TimeoutError'
          ? `no answer after ${timeoutMs / 1000} s`
          : (((e as Error).cause as Error | undefined)?.message ??
            (e as Error).message);
      throw new ApiSpecError(location, `could not be fetched: ${reason}`);
    }
    if (!response.ok) {
      throw new ApiSpecError(
        location,
        `could not be fetched: the server answered ${response.status} ${response.statusText}`.trim(),
      );
    }
    return response.text();
  }
  const file = isAbsolute(location) ? location : resolve(root, location);
  try {
    return await readFile(file, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new ApiSpecError(
      location,
      code === 'ENOENT'
        ? `file not found (looked for ${file})`
        : `cannot be read: ${(e as Error).message}`,
    );
  }
}

/** Where a relative reference in a spec points to, for files and URLs alike. */
export function resolveSpecLocation(from: string, ref: string): string {
  if (isUrl(ref)) return ref;
  if (isUrl(from)) return new URL(ref, from).href;
  const fromFile = from.startsWith('file:') ? fileURLToPath(from) : from;
  return resolve(dirname(fromFile), decodeURI(ref));
}

export type SpecKind = 'openapi' | 'asyncapi' | 'graphql';

export interface LoadedSpec {
  kind: SpecKind;
  /** The text, for hashing and for formats that are not JSON or YAML. */
  text: string;
  /** Parsed JSON or YAML; undefined for GraphQL SDL. */
  doc?: unknown;
}

/** Work out what a spec is from its location and content. */
export function detectSpec(
  text: string,
  location: string,
  forced?: SpecKind,
): LoadedSpec {
  if (
    forced === 'graphql' ||
    /\.(graphql|gql|graphqls)(\?.*)?$/i.test(location)
  ) {
    // Introspection results are JSON; SDL is not.
    const t = text.trimStart();
    if (t.startsWith('{')) {
      return { kind: 'graphql', text, doc: parseSpecText(text, location) };
    }
    return { kind: 'graphql', text };
  }
  const doc = parseSpecText(text, location);
  const o = doc as Record<string, unknown> | null;
  const kind: SpecKind | undefined =
    forced ??
    (openApiVersion(doc)
      ? 'openapi'
      : o && typeof o === 'object' && 'asyncapi' in o
        ? 'asyncapi'
        : o && typeof o === 'object' && ('__schema' in o || 'data' in o)
          ? 'graphql'
          : undefined);
  if (!kind) {
    throw new ApiSpecError(
      location,
      'is not an OpenAPI, AsyncAPI or GraphQL document (set "type" on the source if it is one)',
    );
  }
  return { kind, text, doc };
}

/** Relative server URLs (`/api/v3`) are relative to where the spec was downloaded from. */
function absoluteServers(model: ApiModel, location: string): void {
  if (!isUrl(location)) return;
  const fix = (s: { url: string }) => {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s.url);
    if (!hasScheme && !s.url.includes('{')) {
      s.url = new URL(s.url, location).href.replace(/\/$/, '');
    }
  };
  model.servers.forEach(fix);
  for (const op of model.operations) op.servers?.forEach(fix);
  if (!model.servers.length)
    model.servers.push({ url: new URL('/', location).origin });
}

/** Load, bundle and normalise an OpenAPI source. */
export async function loadOpenApi(
  spec: LoadedSpec,
  location: string,
  root: string,
  options: ReadSpecOptions = {},
): Promise<ApiModel> {
  const absolute = isUrl(location)
    ? location
    : isAbsolute(location)
      ? location
      : resolve(root, location);
  const bundled = await bundleExternalRefs(spec.doc, {
    location: absolute,
    read: (loc) => readSpecText(loc, root, options),
    resolveLocation: resolveSpecLocation,
  });
  const model = normalizeOpenApi(bundled, location);
  absoluteServers(model, location);
  return model;
}

export interface GenerateApiOptions extends ReadSpecOptions {
  root: string;
  config: Pick<DocsConfig, 'openapi' | 'reference' | 'urlPrefix'>;
  /** Folder with the MDX files, relative to `root`. Default `docs`. */
  docsDir?: string;
  /** Report progress. */
  log?: (line: string) => void;
  /** Regenerate even if the spec did not change. */
  force?: boolean;
}

export interface SourceReport {
  name: string;
  kind: string;
  operations: number;
  pages: number;
  /** Did the output change on disk? */
  written: number;
  cached: boolean;
}

interface Manifest {
  version: number;
  sources: Record<string, { hash: string; files: string[] }>;
}

async function readManifest(root: string): Promise<Manifest> {
  try {
    const m = JSON.parse(
      await readFile(join(root, MANIFEST), 'utf8'),
    ) as Manifest;
    if (m.version === GENERATOR_VERSION && m.sources) return m;
  } catch {
    // none yet
  }
  return { version: GENERATOR_VERSION, sources: {} };
}

/** Write a file if its content changed; the dev server does not rebuild for a file that did not. */
async function writeIfChanged(
  root: string,
  file: GeneratedFile,
): Promise<boolean> {
  const target = join(root, file.file);
  try {
    if ((await readFile(target, 'utf8')) === file.content) return false;
  } catch {
    // does not exist
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, file.content);
  return true;
}

export type SourceGenerator = (
  spec: LoadedSpec,
  source: ApiSourceConfig,
  ctx: GenerateApiOptions & { location: string },
) => Promise<{
  files: GeneratedFile[];
  operations: number;
  pages: number;
  warnings?: string[];
}>;

const generators: Record<SpecKind, SourceGenerator> = {
  openapi: async (spec, source, ctx) => {
    const model = await loadOpenApi(spec, ctx.location, ctx.root, ctx);
    return generateOpenApi(model, {
      name: source.name,
      mount: source.path ?? source.name,
      groupBy: source.groupBy,
      playground: ctx.config.openapi.playground.enabled,
      samplesMode: ctx.config.openapi.samples.mode,
      proxy: ctx.config.openapi.playground.proxy,
      docsDir: ctx.docsDir,
      urlPrefix: ctx.config.urlPrefix,
      title: source.title,
    });
  },
  asyncapi: async (spec, source, ctx) => {
    const bundled = await bundleExternalRefs(spec.doc, {
      location: isUrl(ctx.location)
        ? ctx.location
        : resolve(ctx.root, ctx.location),
      read: (loc) => readSpecText(loc, ctx.root, ctx),
      resolveLocation: resolveSpecLocation,
    });
    return generateAsyncApi(normalizeAsyncApi(bundled, ctx.location), {
      name: source.name,
      mount: source.path ?? source.name,
      docsDir: ctx.docsDir,
      title: source.title,
    });
  },
  graphql: async (spec, source, ctx) =>
    generateGraphql(readGraphqlSchema(spec, ctx.location), {
      name: source.name,
      mount: source.path ?? source.name,
      docsDir: ctx.docsDir,
      title: source.title,
      urlPrefix: ctx.config.urlPrefix,
    }),
};

/** Let another module provide the generator for a kind of source (AsyncAPI, GraphQL). */
export function setSourceGenerator(
  kind: SpecKind,
  generator: SourceGenerator,
): void {
  generators[kind] = generator;
}

const hashOf = (...parts: string[]) =>
  createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 16);

/**
 * Generate the pages and data for every source in docs.json. A source whose spec did not change since the last run is
 * skipped. Files from an earlier run that are no longer produced are removed; files not written by this tool are never
 * touched. A spec that cannot be fetched or parsed stops the run with an `ApiSpecError`.
 */
export async function generateApiDocs(
  options: GenerateApiOptions,
): Promise<SourceReport[]> {
  const {
    root,
    config,
    docsDir = 'docs',
    log = () => undefined,
    force,
  } = options;
  const manifest = await readManifest(root);
  const next: Manifest = { version: GENERATOR_VERSION, sources: {} };
  const reports: SourceReport[] = [];

  const results = await Promise.all(
    config.openapi.sources.map(async (source) => {
      const location = source.spec;
      const text = await readSpecText(location, root, options);
      // Settings that change the output are part of the hash.
      const hash = hashOf(
        text,
        JSON.stringify({
          ...source,
          docsDir,
          p: config.openapi.playground,
          s: config.openapi.samples,
          u: config.urlPrefix,
        }),
      );
      const spec = detectSpec(text, location, source.type);
      return { source, spec, hash, location };
    }),
  );

  for (const { source, spec, hash, location } of results) {
    const previous = manifest.sources[source.name];
    if (
      !force &&
      previous?.hash === hash &&
      (await allExist(root, previous.files))
    ) {
      next.sources[source.name] = previous;
      reports.push({
        name: source.name,
        kind: spec.kind,
        operations: 0,
        pages: 0,
        written: 0,
        cached: true,
      });
      log(`${source.name}: unchanged`);
      continue;
    }
    const out = await generators[spec.kind](spec, source, {
      ...options,
      docsDir,
      location,
    });
    for (const w of out.warnings ?? []) log(`${source.name}: warning: ${w}`);
    const written = await writeAll(root, out.files);
    next.sources[source.name] = { hash, files: out.files.map((f) => f.file) };
    reports.push({
      name: source.name,
      kind: spec.kind,
      operations: out.operations,
      pages: out.pages,
      written,
      cached: false,
    });
    log(`${source.name}: ${out.pages} pages from ${out.operations} operations`);
  }

  for (const out of await generateReferences({
    root,
    docsDir,
    sources: config.reference.sources,
  })) {
    const previous = manifest.sources[out.name];
    if (
      !force &&
      previous?.hash === out.hash &&
      (await allExist(root, previous.files))
    ) {
      next.sources[out.name] = previous;
      reports.push({
        name: out.name,
        kind: out.kind,
        operations: 0,
        pages: 0,
        written: 0,
        cached: true,
      });
      continue;
    }
    const written = await writeAll(root, out.files);
    next.sources[out.name] = {
      hash: out.hash,
      files: out.files.map((f) => f.file),
    };
    reports.push({
      name: out.name,
      kind: out.kind,
      operations: out.operations,
      pages: out.pages,
      written,
      cached: false,
    });
    log(`${out.name}: ${out.pages} pages`);
  }

  // Remove what an earlier run wrote and this one does not.
  const keep = new Set(Object.values(next.sources).flatMap((s) => s.files));
  for (const old of Object.values(manifest.sources).flatMap((s) => s.files)) {
    if (!keep.has(old) && isInside(root, old)) {
      await rm(join(root, old), { force: true });
    }
  }
  await mkdir(dirname(join(root, MANIFEST)), { recursive: true });
  await writeFile(join(root, MANIFEST), JSON.stringify(next));
  return reports;
}

const isInside = (root: string, file: string) => {
  const abs = resolve(root, file);
  return (
    abs.startsWith(resolve(root) + '/') || abs.startsWith(resolve(root) + '\\')
  );
};

async function allExist(root: string, files: string[]): Promise<boolean> {
  // The index page and a sample of the others: enough to notice a deleted folder without reading 2,000 entries.
  const probe = [files[0], files[files.length >> 1], files.at(-1)].filter(
    Boolean,
  ) as string[];
  const checks = await Promise.all(
    probe.map((f) =>
      readFile(join(root, f)).then(
        () => true,
        () => false,
      ),
    ),
  );
  return checks.every(Boolean);
}

async function writeAll(root: string, files: GeneratedFile[]): Promise<number> {
  let written = 0;
  // Bounded concurrency: 2,000 operations are 2,000 small files plus the schemas.
  const queue = [...files];
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      for (let f = queue.pop(); f; f = queue.pop()) {
        if (!isInside(root, f.file))
          throw new Error(`refusing to write outside the project: ${f.file}`);
        if (await writeIfChanged(root, f)) written++;
      }
    }),
  );
  return written;
}
