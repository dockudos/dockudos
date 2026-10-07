import { discoverPages } from '@dockudos/core/node';
import { join } from 'node:path';

describe('example docs fixture', () => {
  it('has an index page and a nested guide', async () => {
    const tree = await discoverPages(join(import.meta.dirname, '../docs'));
    expect(tree.pages.map((p) => p.path)).toEqual(
      expect.arrayContaining(['/', '/guides/hello']),
    );
    // `_snippets/` holds includes, which are not pages.
    expect(tree.pages.some((p) => p.file.startsWith('_'))).toBe(false);
  });
});
