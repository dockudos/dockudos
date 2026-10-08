import { useSyncExternalStore } from 'react';
import { type ApiSchema, type AuthValues, schemaFileName } from '@dockudos/core';

// -- credentials ------------------------------------------------------------

const AUTH_KEY = 'dockudos-api-auth';
let auth: AuthValues = {};
let loaded = false;
const listeners = new Set<() => void>();

function load(): void {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    auth = JSON.parse(sessionStorage.getItem(AUTH_KEY) ?? '{}') as AuthValues;
  } catch {
    auth = {};
  }
}

/**
 * Credentials typed into the playground, by security scheme. Kept in `sessionStorage`: they are shared by every
 * endpoint page of the tab and are gone when it closes. They are never sent anywhere but to the API being tried.
 */
export function useAuthValues(): [AuthValues, (name: string, value: AuthValues[string]) => void] {
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => {
      load();
      return auth;
    },
    () => EMPTY,
  );
  return [snapshot, setAuth];
}
const EMPTY: AuthValues = {};

function setAuth(name: string, value: AuthValues[string]): void {
  load();
  auth = { ...auth, [name]: value };
  try {
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  } catch {
    // blocked: the credentials stay in memory for this page view
  }
  listeners.forEach((l) => l());
}

// -- schemas loaded on demand ----------------------------------------------

const schemaCache = new Map<string, Promise<ApiSchema>>();
/** The schemas loaded so far, to look up synchronously while rendering. */
const known = new Map<string, ApiSchema>();

/** A schema that was already loaded. */
export const loadedSchema = (baseUrl: string, name: string): ApiSchema | undefined =>
  known.get(`${baseUrl}/${name}`);

/** Load a named schema from the files `dockudos generate` wrote. Each is fetched once. */
export function loadSchema(baseUrl: string, name: string): Promise<ApiSchema> {
  const url = `${baseUrl}/${schemaFileName(name)}.json`;
  let cached = schemaCache.get(url);
  if (!cached) {
    cached = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`${response.status} for ${url}`);
      const schema = (await response.json()) as ApiSchema;
      known.set(`${baseUrl}/${name}`, schema);
      return schema;
    });
    cached.catch(() => schemaCache.delete(url));
    schemaCache.set(url, cached);
  }
  return cached;
}
