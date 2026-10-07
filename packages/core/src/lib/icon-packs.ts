import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { DocsConfig } from './config.ts';
import { type SvgIcon, sanitizeSvg } from './svg.ts';

export class IconPackError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(
      `Invalid icons in docs.json:\n${issues.map((i) => `  - ${i}`).join('\n')}`,
    );
    this.name = 'IconPackError';
    this.issues = issues;
  }
}

/** `social/Git Hub.svg` becomes `social-git-hub`. */
export const iconNameFromFile = (file: string): string =>
  file
    .replace(/\.svg$/i, '')
    .split(sep === '\\' ? /[\\/]/ : '/')
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Read the icon packs of `docs.json`: every `.svg` in a pack's folder (nested folders included), cleaned
 * of anything that is not drawing, as `{ "acme:logo": { viewBox, body, attrs } }`. Throws one error that
 * lists every file that cannot be used and why.
 */
export async function loadIconPacks(
  root: string,
  config: Pick<DocsConfig, 'icons'>,
): Promise<Record<string, SvgIcon>> {
  const icons: Record<string, SvgIcon> = {};
  const issues: string[] = [];

  for (const [prefix, pack] of Object.entries(config.icons.packs).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const spec =
      typeof pack === 'string' ? { dir: pack, monochrome: false } : pack;
    const dir = resolve(root, spec.dir);
    if (relative(root, dir).startsWith('..')) {
      issues.push(`icons.packs.${prefix}: ${spec.dir} is outside the project`);
      continue;
    }
    let entries;
    try {
      entries = await readdir(dir, { recursive: true, withFileTypes: true });
    } catch {
      issues.push(`icons.packs.${prefix}: folder not found: ${spec.dir}`);
      continue;
    }
    const files = entries
      .filter((e) => e.isFile() && /\.svg$/i.test(e.name))
      .map((e) => relative(dir, join(e.parentPath, e.name)))
      .sort();
    if (files.length === 0)
      issues.push(`icons.packs.${prefix}: no .svg files in ${spec.dir}`);

    const seen = new Map<string, string>();
    for (const file of files) {
      const name = iconNameFromFile(file);
      const display = `${spec.dir}/${file.split(sep).join('/')}`;
      if (!name) {
        issues.push(
          `${display}: the file name has no usable letters or digits`,
        );
        continue;
      }
      const earlier = seen.get(name);
      if (earlier) {
        issues.push(
          `${display}: becomes "${prefix}:${name}", the same as ${earlier}`,
        );
        continue;
      }
      seen.set(name, display);
      try {
        icons[`${prefix}:${name}`] = sanitizeSvg(
          await readFile(join(dir, file), 'utf8'),
          { monochrome: spec.monochrome },
        );
      } catch (e) {
        issues.push(`${display}: ${(e as Error).message}`);
      }
    }
  }
  if (issues.length) throw new IconPackError(issues);
  return icons;
}
