import { parse } from 'yaml';
import {
  type SourceFile,
  frontmatter,
  isSafePath,
  mdxSafe,
  slugSegment,
  sortFiles,
} from './types.ts';

const ASSET = /\.(png|jpe?g|gif|svg|webp|avif)$/i;

interface Note {
  /** Path in the vault without extension: `Guides/Getting started`. */
  stem: string;
  text: string;
}

/** The path a note or folder gets in the docs: lowercase segments with dashes. */
export const notePath = (stem: string): string =>
  stem.split('/').map(slugSegment).join('/');

function splitFrontmatter(text: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { data: {}, body: text };
  try {
    const data = parse(m[1] ?? '') as unknown;
    return {
      data:
        data && typeof data === 'object' && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : {},
      body: text.slice(m[0].length),
    };
  } catch {
    return { data: {}, body: text.slice(m[0].length) };
  }
}

const str = (v: unknown) =>
  typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : undefined;

/** Relative link from a note to another path, both in the docs (`guides/a` to `guides/b`). */
function relativeLink(from: string, to: string): string {
  const a = from.split('/').slice(0, -1);
  const b = to.split('/');
  while (a.length && b.length > 1 && a[0] === b[0]) {
    a.shift();
    b.shift();
  }
  return [...a.map(() => '..'), ...b].join('/') || to;
}

/**
 * Convert the notes of an Obsidian vault into pages. `[[Note]]`, `[[Note|text]]` and `[[Note#Heading]]` become links
 * to the page the note becomes; `![[image.png]]` becomes an image (the image file is copied); callouts
 * (`> [!tip] Title`) become `:::tip[Title]`; `%%comments%%` are dropped and `==marks==` kept as text. Frontmatter
 * keeps `title`, `description`, `date` and `tags`. Names are matched without regard to case, as Obsidian does.
 */
export function convertVault(
  files: readonly { path: string; content: string | Uint8Array }[],
): SourceFile[] {
  const notes: Note[] = [];
  const assets = new Map<string, string>(); // lowercase file name -> path in the vault
  const bytes = new Map<string, string | Uint8Array>();
  for (const f of files) {
    if (!isSafePath(f.path)) continue;
    if (/\.md$/i.test(f.path) && typeof f.content === 'string')
      notes.push({ stem: f.path.replace(/\.md$/i, ''), text: f.content });
    else if (ASSET.test(f.path)) {
      assets.set(f.path.split('/').pop()!.toLowerCase(), f.path);
      bytes.set(f.path, f.content);
    }
  }
  notes.sort((a, b) => (a.stem < b.stem ? -1 : 1));
  // Two notes can slug to one path ("A b" and "a-b"): the second gets "-2", and links use the final names.
  const pathOf = new Map<string, string>();
  const taken = new Set<string>();
  for (const n of notes) {
    let path = notePath(n.stem);
    for (let i = 2; taken.has(path); i++) path = `${notePath(n.stem)}-${i}`;
    taken.add(path);
    pathOf.set(n.stem, path);
  }
  const byName = new Map<string, string>();
  for (const n of notes) {
    byName.set(n.stem.toLowerCase(), n.stem);
    const base = n.stem.split('/').pop()!.toLowerCase();
    if (!byName.has(base)) byName.set(base, n.stem);
  }

  const out: SourceFile[] = [];
  const copied = new Set<string>();
  const assetPath = (file: string) =>
    notePath(file.replace(/\.[^.]+$/, '')) +
    file.slice(file.lastIndexOf('.')).toLowerCase();
  for (const note of notes) {
    const here = pathOf.get(note.stem) as string;
    const { data, body } = splitFrontmatter(note.text);
    let text = body
      .replace(/%%[\s\S]*?%%/g, '')
      .replace(/==([^=\n]+)==/g, '$1')
      // Images first: `![[x.png|300]]` and `![[x.png]]`.
      .replace(/!\[\[([^\]|#]+?)(?:\|[^\]]*)?\]\]/g, (_m, name: string) => {
        const file = assets.get(name.trim().split('/').pop()!.toLowerCase());
        if (!file) return '';
        copied.add(file);
        return `![${name
          .trim()
          .split('/')
          .pop()!
          .replace(/\.[^.]+$/, '')
          .replace(/[\][]/g, '')}](${relativeLink(here, assetPath(file))})`;
      })
      .replace(
        /\[\[([^\]|#]+?)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/g,
        (_m, target: string, heading?: string, alias?: string) => {
          const stem = byName.get(target.trim().toLowerCase());
          const label = (alias ?? target).trim().replace(/[\][]/g, '');
          if (!stem) return label; // a link to a note that does not exist is just text
          const anchor = heading ? `#${slugSegment(heading)}` : '';
          return `[${label}](${relativeLink(here, pathOf.get(stem) as string)}${anchor})`;
        },
      )
      // Callouts: `> [!tip] Title` followed by quoted lines.
      .replace(/^((?:>[^\n]*\n?)+)/gm, (block) => {
        const lines = block
          .replace(/\n$/, '')
          .split('\n')
          .map((l) => l.replace(/^>\s?/, ''));
        const head = /^\[!(\w+)\][+-]?\s*(.*)$/.exec(lines[0] ?? '');
        if (!head) return block;
        const kind =
          (
            {
              note: 'note',
              info: 'info',
              tip: 'tip',
              hint: 'tip',
              warning: 'warning',
              caution: 'warning',
              danger: 'danger',
              error: 'danger',
              important: 'warning',
            } as Record<string, string>
          )[(head[1] as string).toLowerCase()] ?? 'note';
        const title = (head[2] ?? '').trim();
        return `:::${kind}${title ? `[${title.replace(/[\][]/g, '')}]` : ''}\n${lines.slice(1).join('\n')}\n:::\n`;
      });
    text = mdxSafe(text);
    const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
    const title = str(data['title']) ?? heading ?? note.stem.split('/').pop()!;
    const tags = Array.isArray(data['tags'])
      ? data['tags'].filter((t): t is string => typeof t === 'string')
      : [];
    out.push({
      path: `${here}.md`,
      content:
        frontmatter({
          title,
          description: str(data['description']),
          date: str(data['date']),
          tags,
        }) + text.trimStart(),
    });
  }
  for (const file of copied)
    out.push({
      path: assetPath(file),
      content: bytes.get(file) as string | Uint8Array,
    });
  return sortFiles(out);
}
