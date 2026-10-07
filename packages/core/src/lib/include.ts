import { FenceTracker } from './fence.ts';
import { parseFrontmatter } from './frontmatter.ts';

export class IncludeError extends Error {
  readonly file: string;
  readonly line: number;

  constructor(message: string, file: string, line: number) {
    super(`${file}:${line}: ${message}`);
    this.name = 'IncludeError';
    this.file = file;
    this.line = line;
  }
}

export interface IncludeOptions {
  /** Path of `source` relative to the docs folder, with forward slashes. */
  file: string;
  /** Return the contents of a file given its docs-relative path, or throw if it does not exist. */
  read: (file: string) => string | Promise<string>;
}

const INCLUDE = /^[ \t]*<include>[ \t]*([^<>\n]+?)[ \t]*<\/include>[ \t]*$/;

/**
 * Replace `<include>./path.mdx</include>` lines with the file's contents
 * (frontmatter removed), recursively. Paths are relative to the including
 * file; a leading `/` is relative to the docs folder. Lines inside code
 * fences are left alone. Cycles and missing files throw an `IncludeError`
 * naming the file and line.
 */
export async function expandIncludes(
  source: string,
  options: IncludeOptions,
): Promise<string> {
  return expand(source, options, [options.file]);
}

async function expand(
  source: string,
  { file, read }: IncludeOptions,
  stack: string[],
): Promise<string> {
  const lines = source.split('\n');
  const out: string[] = [];
  const fence = new FenceTracker();

  for (const [i, line] of lines.entries()) {
    const target = fence.inCode(line)
      ? undefined
      : INCLUDE.exec(line.replace(/\r$/, ''))?.[1];
    if (!target) {
      out.push(line);
      continue;
    }

    const resolved = resolvePath(file, target);
    if (stack.includes(resolved)) {
      throw new IncludeError(
        `include cycle: ${[...stack, resolved].join(' -> ')}`,
        file,
        i + 1,
      );
    }
    let text: string;
    try {
      text = await read(resolved);
    } catch {
      throw new IncludeError(
        `included file not found: ${resolved}`,
        file,
        i + 1,
      );
    }
    const { body } = parseFrontmatter(text, resolved);
    const inner = await expand(body, { file: resolved, read }, [
      ...stack,
      resolved,
    ]);
    out.push(inner.replace(/\n$/, ''));
  }
  return out.join('\n');
}

/** Resolve `target` against the folder of `from`; both use forward slashes. */
function resolvePath(from: string, target: string): string {
  const base = target.startsWith('/') ? [] : from.split('/').slice(0, -1);
  const parts = [...base];
  for (const seg of target.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}
