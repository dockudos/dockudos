import { discoverPages } from '@dockudos/core/node';
import { join } from 'node:path';

describe('example docs fixture', () => {
  it('has an index page and a nested guide', async () => {
    const tree = await discoverPages(join(import.meta.dirname, '../docs'));
    expect(tree.pages.map((p) => p.path)).toEqual(['/', '/guides/hello']);
  });
});
