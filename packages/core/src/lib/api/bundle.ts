import { parse as parseYaml } from 'yaml';
import { ApiSpecError } from './types.ts';

type Json = Record<string, unknown>;

/** Parse a spec as JSON, or as YAML when it is not JSON (YAML reads JSON too, but its errors are worse). */
export function parseSpecText(text: string, source: string): unknown {
  const trimmed = text.trimStart();
  try {
    return trimmed.startsWith('{') || trimmed.startsWith('[')
      ? (JSON.parse(text) as unknown)
      : (parseYaml(text, { maxAliasCount: 100 }) as unknown);
  } catch (e) {
    throw new ApiSpecError(source, `cannot be parsed: ${(e as Error).message}`);
  }
}

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const decodePointer = (pointer: string): string[] =>
  pointer
    .replace(/^#/, '')
    .split('/')
    .slice(1)
    .map((s) =>
      decodeURIComponent(s).replaceAll('~1', '/').replaceAll('~0', '~'),
    );

export const encodePointerSegment = (s: string): string =>
  s.replaceAll('~', '~0').replaceAll('/', '~1');

/** The value a JSON pointer (`#/components/schemas/Pet`) points to, or `undefined`. */
export function readPointer(doc: unknown, pointer: string): unknown {
  let node = doc;
  for (const key of decodePointer(pointer)) {
    if (Array.isArray(node)) node = node[Number(key)];
    else if (isObject(node)) node = node[key];
    else return undefined;
  }
  return node;
}

/** Reads the text of a document by absolute location (a path or a URL). */
export type SpecReader = (location: string) => Promise<string>;

export interface BundleOptions {
  /** Where the root document came from; relative `$ref`s are resolved against it. */
  location: string;
  read: SpecReader;
  /** Resolve a relative reference against the location it appears in. */
  resolveLocation: (from: string, ref: string) => string;
}

/** Where external pieces that are not schemas are collected. */
const EXTERNAL = 'x-dockudos-external';

/**
 * Replace every reference to another file or URL with a reference inside the document: the referenced piece is copied
 * in (schemas into `components.schemas`, anything else under `x-dockudos-external`) and what it references in turn is
 * copied too. Each target is copied once, so circular references across files end. The result has only `#/...` refs.
 * Returns the root document with all of this applied (a copy; the input is not changed).
 */
export async function bundleExternalRefs(
  input: unknown,
  { location, read, resolveLocation }: BundleOptions,
): Promise<unknown> {
  if (!isObject(input)) return input;
  const root = structuredClone(input);
  const documents = new Map<string, Promise<unknown>>();
  // target (location + pointer) -> internal pointer it was copied to
  const copied = new Map<string, string>();
  const used = new Set<string>(
    Object.keys(
      ((root.components as Json | undefined)?.schemas as Json | undefined) ??
        {},
    ),
  );
  let pending: Promise<void>[] = [];

  const load = (loc: string): Promise<unknown> => {
    let doc = documents.get(loc);
    if (!doc) {
      doc = read(loc).then((text) => parseSpecText(text, loc));
      documents.set(loc, doc);
    }
    return doc;
  };

  const uniqueName = (wanted: string): string => {
    const base = wanted.replace(/[^A-Za-z0-9_.-]+/g, '_') || 'Schema';
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}${i}`;
    used.add(name);
    return name;
  };

  const place = (target: string, loc: string, pointer: string): string => {
    const key = `${loc}#${pointer}`;
    const existing = copied.get(key);
    if (existing) return existing;
    const segments = decodePointer(pointer);
    const isSchema =
      segments.length === 0 ||
      (segments[0] === 'components' && segments[1] === 'schemas') ||
      segments[0] === 'definitions' ||
      segments[0] === '$defs';
    const wanted =
      segments.at(-1) ??
      loc
        .split('/')
        .at(-1)
        ?.replace(/\.\w+$/, '') ??
      'Schema';
    let internal: string;
    if (isSchema) {
      const name = uniqueName(wanted);
      internal = `#/components/schemas/${encodePointerSegment(name)}`;
    } else {
      internal = `#/${EXTERNAL}/${encodePointerSegment(uniqueName(wanted))}`;
    }
    copied.set(key, internal);
    pending.push(
      (async () => {
        const doc = await load(loc);
        const value = readPointer(doc, pointer || '#');
        if (value === undefined) {
          throw new ApiSpecError(
            target,
            `reference "${target}" points to something that does not exist (in ${loc})`,
          );
        }
        const piece = structuredClone(value);
        const names = internal.split('/').slice(1).map(decodeSeg);
        let holder = root as Json;
        for (const n of names.slice(0, -1)) {
          holder = (holder[n] ??= {}) as Json;
        }
        holder[names.at(-1) as string] = piece;
        rewrite(piece, loc, doc);
      })(),
    );
    return internal;
  };

  // `loc` is the document `node` was read from; `#/...` refs inside it are relative to that document.
  function rewrite(node: unknown, loc: string, doc: unknown): void {
    if (Array.isArray(node)) {
      for (const n of node) rewrite(n, loc, doc);
      return;
    }
    if (!isObject(node)) return;
    const ref = node.$ref;
    if (typeof ref === 'string') {
      const hash = ref.indexOf('#');
      const file = hash === -1 ? ref : ref.slice(0, hash);
      const pointer = hash === -1 ? '' : ref.slice(hash);
      if (file) {
        node.$ref = place(ref, resolveLocation(loc, file), pointer);
      } else if (loc !== location) {
        // An internal ref of another document: copy its target too.
        node.$ref = place(ref, loc, pointer);
      }
    }
    for (const [k, v] of Object.entries(node)) {
      if (k !== '$ref') rewrite(v, loc, doc);
    }
  }

  rewrite(root, location, root);
  // Copying a piece can find more pieces, so wait until a round adds nothing.
  while (pending.length) {
    const round = pending;
    pending = [];
    await Promise.all(round);
  }
  return root;
}

const decodeSeg = (s: string) => s.replaceAll('~1', '/').replaceAll('~0', '~');
