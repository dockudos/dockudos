'use client';

import {
  CLIENT_LIMITS,
  CLIENT_SCHEMA_VERSION,
  type Collection,
  type Environment,
  type EnvironmentVariable,
  type HistoryEntry,
  type Imported,
  type ExampleInput,
  type RequestOrigin,
  type ResponseExample,
  type SavedRequest,
  type StoredRequest,
  EXAMPLE_LIMITS,
  lastOrder,
  makeExample,
  newId,
  redactRequest,
  reorder,
  suggestedName,
  trimName,
  usedVariables,
} from '@dockudos/core';
import { useEffect, useSyncExternalStore } from 'react';
import {
  type ClientStorage,
  type StoredData,
  StorageError,
  cappedHistory,
  emptyStoredData,
  openClientStorage,
  withoutSecrets,
} from './client-db.ts';
import {
  type SecretValues,
  readEnvironments,
  readSecrets,
  withSecrets,
  writeEnvironments,
  writeSecrets,
} from './client-env.ts';

/**
 * Everything the API client holds, and the things a reader can do to it. The records live in IndexedDB
 * (`client-db.ts`); this module keeps them in memory while the page is open, tells React when they change, and keeps
 * the environment mirror that endpoint pages read (`client-env.ts`) in step.
 *
 * Every action changes what is on screen first and writes afterwards, so the UI never waits on the disk. A write that
 * the browser refuses (no room left) is put in `problem` and the reader is told; nothing is silently lost.
 */

export interface ClientState extends StoredData {
  /** The store has been read. */
  loaded: boolean;
  /** `memory` means nothing is kept after this page view. */
  where: 'loading' | 'indexeddb' | 'memory';
  /** Why storage is not being used, or why the last write did not happen. */
  notice?: string;
  activeEnvironmentId?: string;
  /** Keep the values of secret variables after the tab closes. Off by default. */
  rememberSecrets: boolean;
  /** Record requests that used a secret variable in the history. Off by default. */
  historyWithSecrets: boolean;
}

const PREFS_KEY = 'dockudos-api-client-prefs';

interface Prefs {
  rememberSecrets: boolean;
  historyWithSecrets: boolean;
}

const readPrefs = (): Prefs => {
  try {
    const text =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(PREFS_KEY);
    const raw = text ? (JSON.parse(text) as Partial<Prefs>) : {};
    return {
      rememberSecrets: raw.rememberSecrets === true,
      historyWithSecrets: raw.historyWithSecrets === true,
    };
  } catch {
    return { rememberSecrets: false, historyWithSecrets: false };
  }
};

const writePrefs = (prefs: Prefs): void => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // blocked: the choice holds for this page view
  }
};

let state: ClientState = {
  ...emptyStoredData(),
  loaded: false,
  where: 'loading',
  rememberSecrets: false,
  historyWithSecrets: false,
};

const listeners = new Set<() => void>();
let storage: ClientStorage | undefined;
let opening: Promise<ClientStorage> | undefined;

const notify = () => listeners.forEach((l) => l());

const set = (next: Partial<ClientState>): void => {
  state = { ...state, ...next };
  notify();
};

const store = async (): Promise<ClientStorage> => {
  opening ??= openClientStorage().then((opened) => {
    storage = opened;
    return opened;
  });
  return opening;
};

/**
 * Writes happen one after another, in the order the reader made them, and never hold up the screen. A refusal becomes
 * a notice the reader can read rather than a thrown error inside an event handler.
 */
let queued: Promise<void> = Promise.resolve();

function write(run: (s: ClientStorage) => Promise<void>): Promise<void> {
  queued = queued.then(async () => {
    try {
      await run(await store());
    } catch (e) {
      set({
        notice:
          e instanceof StorageError
            ? e.message
            : `The browser would not save that: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  });
  return queued;
}

/** Resolves once every write made so far has been made. Useful in tests and before leaving a page. */
export const whenWritten = (): Promise<void> => queued;

/**
 * Records that are already in memory win: the reader may have saved something while the store was still opening, and
 * what they just did is newer than what was on disk.
 */
const merge = <T extends { id: string }>(onDisk: T[], inMemory: T[]): T[] => {
  const held = new Set(inMemory.map((item) => item.id));
  return [...inMemory, ...onDisk.filter((item) => !held.has(item.id))];
};

/** Read everything in. Called the first time a component asks for the client. */
export async function loadClient(): Promise<void> {
  if (state.loaded || opening) return;
  const opened = await store();
  const data = await opened.read();
  const prefs = readPrefs();
  const mirror = readEnvironments();
  const secrets = readSecrets();
  const environments = merge(
    data.environments.map((environment) => ({
      ...environment,
      variables: withSecrets(environment, secrets),
    })),
    state.environments,
  );
  state = {
    ...state,
    collections: merge(data.collections, state.collections),
    requests: merge(data.requests, state.requests),
    examples: merge(data.examples, state.examples),
    environments,
    history: cappedHistory(merge(data.history, state.history)),
    loaded: true,
    where: opened.kind,
    ...(opened.notice ? { notice: opened.notice } : {}),
    ...(mirror.activeId ? { activeEnvironmentId: mirror.activeId } : {}),
    ...prefs,
  };
  // Endpoint pages read the picker from the mirror, so it follows the store.
  writeEnvironments({
    ...(mirror.activeId ? { activeId: mirror.activeId } : {}),
    environments,
  });
  notify();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

const INITIAL: ClientState = {
  ...emptyStoredData(),
  loaded: false,
  where: 'loading',
  rememberSecrets: false,
  historyWithSecrets: false,
};

/** The client's records. Reading them opens the store the first time. */
export function useApiClient(): ClientState {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL,
  );
  useEffect(() => {
    void loadClient();
  }, []);
  return snapshot;
}

// -- collections ------------------------------------------------------------

export function addCollection(name: string): Collection {
  const collection: Collection = {
    id: newId(),
    name: trimName(name, 'Collection'),
    order: lastOrder(state.collections),
    createdAt: Date.now(),
    v: CLIENT_SCHEMA_VERSION,
  };
  if (state.collections.length >= CLIENT_LIMITS.collections) {
    set({ notice: `A reader may keep ${CLIENT_LIMITS.collections} collections.` });
    return collection;
  }
  set({ collections: [...state.collections, collection] });
  void write((s) => s.put('collections', [collection]));
  return collection;
}

export function renameCollection(id: string, name: string): void {
  const collections = state.collections.map((c) =>
    c.id === id
      ? { ...c, name: trimName(name, c.name) }
      : c,
  );
  set({ collections });
  const changed = collections.find((c) => c.id === id);
  if (changed) void write((s) => s.put('collections', [changed]));
}

export function deleteCollection(id: string): void {
  const gone = state.requests.filter((r) => r.collectionId === id).map((r) => r.id);
  set({
    collections: state.collections.filter((c) => c.id !== id),
    requests: state.requests.filter((r) => r.collectionId !== id),
  });
  void write(async (s) => {
    await s.remove('collections', [id]);
    await s.remove('requests', gone);
  });
}

export function moveCollection(id: string, to: number): void {
  const collections = reorder(state.collections, id, to);
  set({ collections });
  void write((s) => s.put('collections', collections));
}

// -- requests ---------------------------------------------------------------

export interface SaveInput {
  collectionId?: string;
  name?: string;
  request: StoredRequest;
  origin?: RequestOrigin;
  /** Credential values to take out before storing: what the playground's Authorization tab holds. */
  secrets?: string[];
  /** Header, query and cookie names of the operation's security schemes. */
  authFields?: string[];
}

/**
 * Keep a request. Credentials are taken out first (`redactRequest`): a value that matches a secret variable becomes
 * `{{name}}`, anything else is dropped and named, so the record carries no secret.
 */
export function saveRequest({
  collectionId,
  name,
  request,
  origin,
  secrets = [],
  authFields = [],
}: SaveInput): SavedRequest {
  const collection =
    state.collections.find((c) => c.id === collectionId) ??
    state.collections[0] ??
    addCollection('My requests');
  const variables = activeVariables();
  const { request: safe, redacted } = redactRequest(request, {
    secrets,
    variables,
    authFields,
  });
  const now = Date.now();
  const mine = state.requests.filter((r) => r.collectionId === collection.id);
  const saved: SavedRequest = {
    id: newId(),
    collectionId: collection.id,
    name: trimName(name ?? '', suggestedName(safe)),
    order: lastOrder(mine),
    createdAt: now,
    updatedAt: now,
    request: safe,
    ...(origin ? { origin } : {}),
    ...(redacted.length ? { redacted } : {}),
    v: CLIENT_SCHEMA_VERSION,
  };
  if (mine.length >= CLIENT_LIMITS.requestsPerCollection) {
    set({
      notice: `A collection may hold ${CLIENT_LIMITS.requestsPerCollection} requests.`,
    });
    return saved;
  }
  set({ requests: [...state.requests, saved] });
  void write((s) => s.put('requests', [saved]));
  return saved;
}

export function updateRequest(
  id: string,
  patch: Partial<Pick<SavedRequest, 'name' | 'request' | 'collectionId'>>,
): void {
  const requests = state.requests.map((r) =>
    r.id === id
      ? {
          ...r,
          ...patch,
          ...(patch.name
            ? { name: trimName(patch.name, r.name) }
            : {}),
          updatedAt: Date.now(),
        }
      : r,
  );
  set({ requests });
  const changed = requests.find((r) => r.id === id);
  if (changed) void write((s) => s.put('requests', [changed]));
}

export function deleteRequest(id: string): void {
  const examples = state.examples.filter((e) => e.requestId === id).map((e) => e.id);
  set({
    requests: state.requests.filter((r) => r.id !== id),
    examples: state.examples.filter((e) => e.requestId !== id),
  });
  void write(async (s) => {
    await s.remove('requests', [id]);
    await s.remove('examples', examples);
  });
}

export function moveRequest(id: string, to: number): void {
  const request = state.requests.find((r) => r.id === id);
  if (!request) return;
  const mine = state.requests.filter((r) => r.collectionId === request.collectionId);
  const others = state.requests.filter((r) => r.collectionId !== request.collectionId);
  const moved = reorder(mine, id, to);
  set({ requests: [...others, ...moved] });
  void write((s) => s.put('requests', moved));
}

// -- environments -----------------------------------------------------------

const mirror = (environments: Environment[], activeId = state.activeEnvironmentId) =>
  writeEnvironments({ ...(activeId ? { activeId } : {}), environments });

/** The variables of the chosen environment, secret values included. */
export const activeVariables = (): EnvironmentVariable[] => {
  const active = state.environments.find((e) => e.id === state.activeEnvironmentId);
  return active ? withSecrets(active) : [];
};

export function addEnvironment(name: string): Environment {
  const environment: Environment = {
    id: newId(),
    name: trimName(name, 'Environment'),
    order: lastOrder(state.environments),
    variables: [],
    v: CLIENT_SCHEMA_VERSION,
  };
  if (state.environments.length >= CLIENT_LIMITS.environments) {
    set({ notice: `A reader may keep ${CLIENT_LIMITS.environments} environments.` });
    return environment;
  }
  const environments = [...state.environments, environment];
  set({ environments, activeEnvironmentId: environment.id });
  mirror(environments, environment.id);
  void write((s) =>
    s.put('environments', [withoutSecrets(environment, state.rememberSecrets)]),
  );
  return environment;
}

export function renameEnvironment(id: string, name: string): void {
  putEnvironment(id, (e) => ({
    ...e,
    name: trimName(name, e.name),
  }));
}

/** Replace an environment's variables. Secret values go to the tab's own storage, not to the records. */
export function setVariables(id: string, variables: EnvironmentVariable[]): void {
  putEnvironment(id, (e) => ({
    ...e,
    variables: variables.slice(0, CLIENT_LIMITS.variablesPerEnvironment),
  }));
}

/**
 * One variable at a time, against the list as it is now. The editor used to write the whole list back, which let two
 * quick edits to the same row undo each other — and a lost `secret` flag would have put the value in the mirror.
 */
export function updateVariable(
  id: string,
  index: number,
  patch: Partial<EnvironmentVariable>,
): void {
  putEnvironment(id, (e) => ({
    ...e,
    variables: e.variables.map((v, i) => (i === index ? { ...v, ...patch } : v)),
  }));
}

export function addVariable(id: string): void {
  putEnvironment(id, (e) =>
    e.variables.length >= CLIENT_LIMITS.variablesPerEnvironment
      ? e
      : { ...e, variables: [...e.variables, { name: '', value: '' }] },
  );
}

export function removeVariable(id: string, index: number): void {
  putEnvironment(id, (e) => ({
    ...e,
    variables: e.variables.filter((_, i) => i !== index),
  }));
}

function putEnvironment(
  id: string,
  change: (environment: Environment) => Environment,
): void {
  const environments = state.environments.map((e) => (e.id === id ? change(e) : e));
  const changed = environments.find((e) => e.id === id);
  if (!changed) return;
  set({ environments });
  mirror(environments);
  const secrets: SecretValues = { ...readSecrets() };
  secrets[id] = Object.fromEntries(
    changed.variables.filter((v) => v.secret).map((v) => [v.name, v.value]),
  );
  writeSecrets(secrets);
  // A variable that is no longer secret keeps its value in the records from now on, not in the tab.
  void write((s) =>
    s.put('environments', [withoutSecrets(changed, state.rememberSecrets)]),
  );
}

export function deleteEnvironment(id: string): void {
  const environments = state.environments.filter((e) => e.id !== id);
  const activeId =
    state.activeEnvironmentId === id ? environments[0]?.id : state.activeEnvironmentId;
  set({ environments, activeEnvironmentId: activeId });
  mirror(environments, activeId);
  const secrets = { ...readSecrets() };
  delete secrets[id];
  writeSecrets(secrets);
  void write((s) => s.remove('environments', [id]));
}

export function chooseEnvironment(id: string | undefined): void {
  set({ activeEnvironmentId: id });
  mirror(state.environments, id);
}

/** Keep secret values after the tab closes, or stop keeping them (which erases the ones already stored). */
export function setRememberSecrets(remember: boolean): void {
  set({ rememberSecrets: remember });
  writePrefs({ rememberSecrets: remember, historyWithSecrets: state.historyWithSecrets });
  const environments = state.environments.map((e) => withoutSecrets(e, remember));
  void write((s) => s.put('environments', environments));
}

export function setHistoryWithSecrets(on: boolean): void {
  set({ historyWithSecrets: on });
  writePrefs({ rememberSecrets: state.rememberSecrets, historyWithSecrets: on });
}

// -- history ----------------------------------------------------------------

export interface RecordInput {
  /** The request as it was written, variables not resolved, so no secret is kept. */
  request: StoredRequest;
  status?: number;
  ms?: number;
  error?: string;
  requestId?: string;
}

/**
 * Note a sent request. A request that used a secret variable, or carried a credential of its own, is not recorded
 * unless the reader turned that on.
 */
export function recordSent({
  request,
  status,
  ms,
  error,
  requestId,
}: RecordInput): HistoryEntry | undefined {
  const secretNames = activeVariables()
    .filter((v) => v.secret)
    .map((v) => v.name);
  const texts = [request.url, ...request.headers.flat(), request.body?.text ?? ''];
  const usedSecret = texts.some((text) =>
    usedVariables(text).some((name) => secretNames.includes(name)),
  );
  if (usedSecret && !state.historyWithSecrets) return undefined;
  const entry: HistoryEntry = {
    id: newId(),
    at: Date.now(),
    method: request.method,
    url: request.url,
    ...(status !== undefined ? { status } : {}),
    ...(ms !== undefined ? { ms: Math.round(ms) } : {}),
    ...(error ? { error } : {}),
    ...(requestId ? { requestId } : {}),
  };
  const history = cappedHistory([entry, ...state.history]);
  const dropped = state.history.filter((h) => !history.includes(h)).map((h) => h.id);
  set({ history });
  void write(async (s) => {
    await s.put('history', [entry]);
    if (dropped.length) await s.remove('history', dropped);
  });
  return entry;
}

export function clearHistory(): void {
  set({ history: [] });
  void write((s) => s.clear('history'));
}

// -- importing --------------------------------------------------------------

/** Add what an import read. Names that are already taken get `(2)` after them. */
export function addImported(imported: Imported): void {
  const taken = new Set(state.collections.map((c) => c.name));
  const collections = imported.collections.map((collection, i) => {
    let name = collection.name;
    for (let n = 2; taken.has(name); n += 1) name = `${collection.name} (${n})`;
    taken.add(name);
    return { ...collection, name, order: lastOrder(state.collections) + i };
  });
  const environments = imported.environments.map((environment, i) => ({
    ...environment,
    order: lastOrder(state.environments) + i,
  }));
  set({
    collections: [...state.collections, ...collections],
    requests: [...state.requests, ...imported.requests],
    environments: [...state.environments, ...environments],
  });
  void write(async (s) => {
    await s.put('collections', collections);
    await s.put('requests', imported.requests);
    await s.put(
      'environments',
      environments.map((e) => withoutSecrets(e, state.rememberSecrets)),
    );
  });
  mirror([...state.environments]);
}

// -- responses the reader kept ---------------------------------------------

/**
 * Keep a response next to its request, to compare a later one against or to paste into the docs. The oldest goes when
 * there are more than `EXAMPLE_LIMITS.perRequest` of them for one request.
 */
export function keepExample(input: ExampleInput): ResponseExample {
  const example = makeExample(input);
  const mine = state.examples
    .filter((e) => e.requestId === example.requestId)
    .sort((a, b) => b.at - a.at);
  const dropped = mine.slice(EXAMPLE_LIMITS.perRequest - 1).map((e) => e.id);
  set({
    examples: [
      example,
      ...state.examples.filter((e) => !dropped.includes(e.id)),
    ],
  });
  void write(async (s) => {
    await s.put('examples', [example]);
    if (dropped.length) await s.remove('examples', dropped);
  });
  return example;
}

export function deleteExample(id: string): void {
  set({ examples: state.examples.filter((e) => e.id !== id) });
  void write((s) => s.remove('examples', [id]));
}

/** Forget the notice after the reader has read it. */
export const clearNotice = (): void => set({ notice: undefined });

/** Everything, as it is now. For tests and for exporting. */
export const clientSnapshot = (): ClientState => state;

/** Start again from nothing. Only for tests. */
export function resetClientStore(): void {
  storage?.close();
  storage = undefined;
  opening = undefined;
  queued = Promise.resolve();
  state = { ...INITIAL, ...emptyStoredData() };
  notify();
}
