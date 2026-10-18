'use client';

import {
  type Environment,
  type EnvironmentVariable,
  readVariables,
  variableValues,
} from '@dockudos/core';
import { useSyncExternalStore } from 'react';

/**
 * The environment picker, and the values a `{{variable}}` stands for.
 *
 * This module is deliberately small and free of IndexedDB: endpoint pages need the picker and the substitution at send
 * time, and the rest of the client (collections, history, importing, the UI) loads only when the reader opens it.
 *
 * The environments themselves are kept by the client in IndexedDB; what is here is a mirror of them in `localStorage`,
 * which can be read while rendering and shared with other tabs. The mirror holds **no secret value**: those live in
 * `sessionStorage` for the tab, as the playground's credentials do, unless the reader asks for them to be remembered,
 * in which case the client writes them to its own store and they come back through the mirror.
 */

export const ENV_MIRROR_KEY = 'dockudos-api-client-env';
export const ENV_SECRETS_KEY = 'dockudos-api-client-secrets';

export interface EnvironmentMirror {
  /** The environment whose values are used, if any. */
  activeId?: string;
  environments: Environment[];
}

/** Secret values by environment id and variable name. */
export type SecretValues = Record<string, Record<string, string>>;

const EMPTY: EnvironmentMirror = { environments: [] };

const listeners = new Set<() => void>();
let cached: EnvironmentMirror | undefined;

const local = (): Storage | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;
const session = (): Storage | undefined =>
  typeof sessionStorage === 'undefined' ? undefined : sessionStorage;

function readJson<T>(storage: Storage | undefined, key: string, fallback: T): T {
  try {
    const text = storage?.getItem(key);
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** The environments and the chosen one, as this tab last saw them. */
export function readEnvironments(): EnvironmentMirror {
  if (cached) return cached;
  const raw = readJson<{ activeId?: unknown; environments?: unknown }>(
    local(),
    ENV_MIRROR_KEY,
    {},
  );
  const environments = Array.isArray(raw.environments)
    ? raw.environments
        .filter(
          (e): e is Record<string, unknown> =>
            typeof e === 'object' && e !== null && typeof (e as { id?: unknown }).id === 'string',
        )
        .map((e) => ({
          id: String(e.id),
          name: typeof e.name === 'string' ? e.name : 'Environment',
          order: typeof e.order === 'number' ? e.order : 0,
          variables: readVariables(e.variables),
          v: typeof e.v === 'number' ? e.v : 1,
        }))
    : [];
  cached = {
    ...(typeof raw.activeId === 'string' ? { activeId: raw.activeId } : {}),
    environments,
  };
  return cached;
}

/** Replace the mirror. The client calls this whenever an environment changes. */
export function writeEnvironments(mirror: EnvironmentMirror): void {
  cached = {
    ...(mirror.activeId ? { activeId: mirror.activeId } : {}),
    environments: mirror.environments,
  };
  try {
    local()?.setItem(
      ENV_MIRROR_KEY,
      JSON.stringify({
        ...(mirror.activeId ? { activeId: mirror.activeId } : {}),
        // Secret values are not written here: the tab holds them, or the client's own store does.
        environments: mirror.environments.map((e) => ({
          ...e,
          variables: e.variables.map((v) => (v.secret ? { ...v, value: '' } : v)),
        })),
      }),
    );
  } catch {
    // blocked: the picker still works for this page view
  }
  listeners.forEach((l) => l());
}

/** Pick the environment whose values are used. */
export const chooseEnvironment = (activeId: string | undefined): void =>
  writeEnvironments({ ...readEnvironments(), activeId });

/** Forget the mirror this module is holding; another tab's change is read again. */
export function refreshEnvironments(): void {
  cached = undefined;
  listeners.forEach((l) => l());
}

// -- secret values ----------------------------------------------------------

/** The secret values this tab is holding. */
export const readSecrets = (): SecretValues =>
  readJson<SecretValues>(session(), ENV_SECRETS_KEY, {});

/** Keep a secret for this tab. It is gone when the tab closes. */
export function writeSecrets(values: SecretValues): void {
  try {
    session()?.setItem(ENV_SECRETS_KEY, JSON.stringify(values));
  } catch {
    // blocked: the value stays in memory for this page view
  }
  // Only the secrets changed, so the environments this module is holding stay as they are.
  listeners.forEach((l) => l());
}

/** The variables of an environment with the secret values this tab holds put back in. */
export const withSecrets = (
  environment: Environment,
  secrets: SecretValues = readSecrets(),
): EnvironmentVariable[] =>
  environment.variables.map((v) =>
    v.secret && !v.value
      ? { ...v, value: secrets[environment.id]?.[v.name] ?? '' }
      : v,
  );

export interface ActiveEnvironment {
  environments: Environment[];
  active?: Environment;
  /** The values to substitute, secrets included. */
  values: Record<string, string>;
  /** Names of the secret variables, which code samples keep as `{{name}}` instead of showing. */
  secretNames: string[];
}

/** What a request needs to resolve its variables: the chosen environment, its values, and which are secret. */
export function activeEnvironment(
  mirror: EnvironmentMirror = readEnvironments(),
  secrets: SecretValues = readSecrets(),
): ActiveEnvironment {
  const environments = [...mirror.environments].sort((a, b) => a.order - b.order);
  const active = environments.find((e) => e.id === mirror.activeId);
  if (!active) return { environments, values: {}, secretNames: [] };
  const variables = withSecrets(active, secrets);
  return {
    environments,
    active,
    values: variableValues(variables),
    secretNames: variables.filter((v) => v.secret).map((v) => v.name),
  };
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === ENV_MIRROR_KEY) refreshEnvironments();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};

const EMPTY_ACTIVE: ActiveEnvironment = {
  environments: [],
  values: {},
  secretNames: [],
};

let snapshot: ActiveEnvironment | undefined;
const getSnapshot = (): ActiveEnvironment => {
  snapshot ??= activeEnvironment();
  return snapshot;
};
const invalidate = () => {
  snapshot = undefined;
};
listeners.add(invalidate);

/** The chosen environment and its values, kept in step with the client and with other tabs. */
export const useEnvironment = (): ActiveEnvironment =>
  useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_ACTIVE);

export { EMPTY as emptyMirror };
