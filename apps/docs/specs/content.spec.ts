import {
  buildNavigation,
  docsConfigJsonSchema,
  frontmatterSchema,
  resolveRedirects,
} from '@dockudos/core';
import { checkLinks, discoverPages, loadConfig } from '@dockudos/core/node';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const docsDir = join(root, 'docs');
const read = (file: string) => readFile(join(docsDir, file), 'utf8');

/** Property names at every depth of a JSON Schema. */
function propertyNames(
  schema: unknown,
  found = new Set<string>(),
): Set<string> {
  if (schema && typeof schema === 'object') {
    const { properties, ...rest } = schema as {
      properties?: Record<string, unknown>;
    };
    for (const [name, value] of Object.entries(properties ?? {})) {
      found.add(name);
      propertyNames(value, found);
    }
    for (const value of Object.values(rest)) propertyNames(value, found);
  }
  return found;
}

describe('the dockudos documentation', () => {
  it('has a valid docs.json whose navigation lists every page that exists', async () => {
    const config = await loadConfig(root);
    const tree = await discoverPages(docsDir);
    const nav = buildNavigation(config, tree);
    expect(nav.unlisted.map((p) => p.file)).toEqual([]);
    expect(() =>
      resolveRedirects(
        config.redirects,
        tree.pages.map((p) => p.path),
      ),
    ).not.toThrow();
  });

  it('has no broken links, anchors or images', async () => {
    const tree = await discoverPages(docsDir);
    const problems = await checkLinks({
      docsDir,
      publicDir: join(root, 'public'),
      tree,
    });
    expect(
      problems.map((p) => `${p.file}:${p.line} ${p.href}: ${p.message}`),
    ).toEqual([]);
  });

  it('gives every page a description', async () => {
    const tree = await discoverPages(docsDir);
    expect(tree.pages.filter((p) => !p.description).map((p) => p.file)).toEqual(
      [],
    );
  });

  it('documents every docs.json key', async () => {
    const page = await read('reference/docs-json.mdx');
    // `$schema` is documented; the rest by name. Union-branch internals (tab, group, ...) are included.
    const missing = [...propertyNames(docsConfigJsonSchema())].filter(
      (name) => !page.includes(name),
    );
    expect(missing).toEqual([]);
  });

  it('documents every frontmatter key', async () => {
    const page = await read('reference/frontmatter.mdx');
    const keys = Object.keys(frontmatterSchema.shape);
    expect(keys.filter((key) => !page.includes(key))).toEqual([]);
  });

  it('documents every CLI command', async () => {
    const page = await read('reference/cli.mdx');
    for (const command of ['init', 'dev', 'build', 'broken-links'])
      expect(page).toContain(`## ${command}`);
  });
});
