import { FenceTracker } from './fence.ts';

const OPEN =
  /^(\s*)<Visibility\s+for=(?:"(humans|agents)"|\{"(humans|agents)"\}|\{'(humans|agents)'\})\s*>\s*$/;
const CLOSE = /^\s*<\/Visibility>\s*$/;

/**
 * Resolve `<Visibility for="humans|agents">` blocks for one audience, in Markdown source.
 * The blocks must have their tags on lines of their own. The audience's blocks lose their tags
 * and keep their content; the other audience's blocks are removed. Fenced code is left alone.
 */
export function resolveVisibility(
  source: string,
  audience: 'humans' | 'agents',
): string {
  const fence = new FenceTracker();
  const out: string[] = [];
  const stack: boolean[] = [];
  for (const line of source.split('\n')) {
    if (!fence.inCode(line)) {
      const open = OPEN.exec(line);
      if (open) {
        stack.push((open[2] ?? open[3] ?? open[4]) === audience);
        continue;
      }
      if (stack.length && CLOSE.test(line)) {
        stack.pop();
        continue;
      }
    }
    if (stack.every(Boolean)) out.push(line);
  }
  return out.join('\n');
}
