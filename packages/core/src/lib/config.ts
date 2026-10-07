import { z } from 'zod';

const groupSchema = z.strictObject({
  group: z.string().min(1),
  pages: z.array(z.string().min(1)),
});

const tabSchema = z.strictObject({
  tab: z.string().min(1),
  groups: z.array(groupSchema),
});

/**
 * Shape of `docs.json`. Strict: unknown keys are rejected so typos fail the
 * build instead of being silently ignored. Later phases add keys.
 */
export const docsConfigSchema = z.strictObject({
  name: z.string().min(1),
  navigation: z.array(tabSchema).default([]),
});

export type DocsConfig = z.output<typeof docsConfigSchema>;

export class DocsConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[], source?: string) {
    const where = source ? ` in ${source}` : '';
    super(
      `Invalid docs config${where}:\n${issues.map((i) => `  - ${i}`).join('\n')}`,
    );
    this.name = 'DocsConfigError';
    this.issues = issues;
  }
}

/** Validate an unknown value as a docs config, throwing a readable error naming each bad key. */
export function parseConfig(input: unknown, source?: string): DocsConfig {
  const result = docsConfigSchema.safeParse(input);
  if (result.success) return result.data;
  throw new DocsConfigError(
    result.error.issues.map((issue) => {
      if (issue.code === 'unrecognized_keys') {
        const extra = issue.keys.map((k) => formatPath([...issue.path, k]));
        return `unknown key ${extra.join(', ')}`;
      }
      return `${formatPath(issue.path) || '(root)'}: ${issue.message}`;
    }),
    source,
  );
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, part) => {
    if (typeof part === 'number') return `${acc}[${part}]`;
    return acc ? `${acc}.${String(part)}` : String(part);
  }, '');
}
