/**
 * `{{variable}}` substitution for the API client. An environment holds the variables; the URL, the headers and the body
 * of a request may use them.
 *
 * - `{{ name }}` is the same as `{{name}}`: the spaces are part of the syntax, not of the name.
 * - A value may use other variables (`{{url}}` = `{{scheme}}://{{host}}`). A reference back to itself is left as it is
 *   written and reported, instead of looping.
 * - A name with no variable behind it is left as it is written and reported, so the reader can see what is missing
 *   rather than send a request to `https://{{baseUrl}}/pets`.
 * - A backslash escapes a reference: `\{{not a variable}}` sends the braces themselves.
 */

import type { StoredRequest } from './client.ts';

/** How deep a variable may refer to other variables before the nesting is called a loop. */
const MAX_DEPTH = 10;

const REFERENCE = /(\\?)\{\{\s*([^{}\s][^{}]*?)\s*\}\}/g;

export interface Substitution {
  text: string;
  /** Names used in the text that the environment has no value for, in the order they appear. */
  missing: string[];
  /** Names that refer to themselves, directly or through other variables. */
  cyclic: string[];
}

export interface SubstituteOptions {
  /** Names to leave as written. Code samples pass the secret ones, so a sample never shows a credential. */
  keep?: readonly string[];
}

/** The variable names a text uses, each one once, escaped references not counted. */
export function usedVariables(text: string): string[] {
  const names: string[] = [];
  for (const [, escape, name] of text.matchAll(REFERENCE)) {
    if (escape) continue;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** `text` with every `{{name}}` replaced by its value. */
export function substitute(
  text: string,
  variables: Record<string, string>,
  { keep = [] }: SubstituteOptions = {},
): Substitution {
  const missing: string[] = [];
  const cyclic: string[] = [];
  const note = (list: string[], name: string) => {
    if (!list.includes(name)) list.push(name);
  };

  const resolve = (input: string, seen: readonly string[]): string =>
    input.replace(REFERENCE, (all, escape: string, name: string) => {
      if (escape) return all.slice(1);
      if (keep.includes(name)) return all;
      if (seen.includes(name)) {
        note(cyclic, name);
        return all;
      }
      const value = variables[name];
      if (value === undefined) {
        note(missing, name);
        return all;
      }
      if (seen.length >= MAX_DEPTH) {
        note(cyclic, name);
        return all;
      }
      return resolve(value, [...seen, name]);
    });

  return { text: resolve(text, []), missing, cyclic };
}

export interface RequestSubstitution {
  request: StoredRequest;
  missing: string[];
  cyclic: string[];
}

/** The request with its URL, header names and values, and body resolved against the environment. */
export function applyVariables(
  request: StoredRequest,
  variables: Record<string, string>,
  options: SubstituteOptions = {},
): RequestSubstitution {
  const missing: string[] = [];
  const cyclic: string[] = [];
  const run = (text: string): string => {
    const result = substitute(text, variables, options);
    for (const name of result.missing) {
      if (!missing.includes(name)) missing.push(name);
    }
    for (const name of result.cyclic) {
      if (!cyclic.includes(name)) cyclic.push(name);
    }
    return result.text;
  };
  return {
    request: {
      method: request.method,
      url: run(request.url),
      headers: request.headers.map(
        ([name, value]) => [run(name), run(value)] as [string, string],
      ),
      body: request.body && {
        contentType: request.body.contentType,
        text: run(request.body.text),
      },
    },
    missing,
    cyclic,
  };
}

/** The values of an environment as a plain record. A later variable of the same name wins, as in the list. */
export const variableValues = (
  variables: readonly { name: string; value: string }[],
): Record<string, string> =>
  Object.fromEntries(variables.map((v) => [v.name, v.value]));
