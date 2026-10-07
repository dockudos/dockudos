import { parseKudosLog, summarizeKudos } from '@dockudos/core';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Env, CliError } from './io.ts';

const DEFAULT_FILE = '.dockudos/kudos.jsonl';

/** `dockudos kudos`: read the feedback log and print votes and comments per page. */
export async function kudos(env: Env, args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      file: { type: 'string', default: DEFAULT_FILE },
      path: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
  });
  const file = resolve(env.cwd, values.file ?? DEFAULT_FILE);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new CliError(
      `No feedback log at ${file}. Votes are written there once \`kudos.enabled\` is set in docs.json and the /api/kudos route exists; use --file for another location.`,
    );
  }

  const { entries, skipped } = parseKudosLog(text);
  const summary = summarizeKudos(entries, skipped);
  const pages = values.path
    ? summary.pages.filter((p) => p.path === values.path)
    : summary.pages;

  if (values.json) {
    env.out(JSON.stringify({ ...summary, pages }, null, 2) + '\n');
    return 0;
  }
  if (pages.length === 0) {
    env.out(
      values.path ? `No feedback for ${values.path}.\n` : 'No feedback yet.\n',
    );
    return 0;
  }

  const width = Math.max(...pages.map((p) => p.path.length));
  const lines = [
    `${summary.up} helpful, ${summary.down} not helpful, on ${summary.pages.length} pages.`,
    '',
  ];
  for (const p of pages) {
    lines.push(
      `${p.path.padEnd(width)}  ${String(p.up).padStart(3)} up  ${String(p.down).padStart(3)} down`,
    );
    for (const c of p.comments) {
      const mark = c.vote === 'up' ? '+' : c.vote === 'down' ? '-' : '?';
      lines.push(`  ${mark} ${c.text.replace(/\s+/g, ' ')}`);
    }
  }
  if (summary.skipped)
    lines.push(
      '',
      `${summary.skipped} unreadable line${summary.skipped === 1 ? '' : 's'} in the log were skipped.`,
    );
  env.out(lines.join('\n') + '\n');
  return 0;
}
