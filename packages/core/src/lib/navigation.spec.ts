import { type DocsConfig } from './config.ts';
import {
  buildNavigation,
  flattenSidebar,
  NavigationError,
} from './navigation.ts';
import { buildPageTree } from './page-tree.ts';

const tree = buildPageTree([
  { file: 'index.mdx', title: 'Home' },
  { file: 'start.mdx', title: 'Start' },
  { file: 'guides/index.mdx', title: 'Guides' },
  { file: 'guides/auth.mdx', title: 'Auth' },
  { file: 'guides/secret.mdx', title: 'Secret', hidden: true },
  { file: 'api/users.mdx', title: 'Users' },
]);
const config = (navigation: DocsConfig['navigation']) => ({ navigation });

describe('buildNavigation: from config', () => {
  it('resolves page ids, folder ids and nested groups', () => {
    const nav = buildNavigation(
      config([
        {
          tab: 'Docs',
          groups: [
            {
              group: 'Basics',
              pages: [
                'index',
                'guides',
                { group: 'More', pages: ['guides/auth'] },
                { title: 'GitHub', href: 'https://github.com' },
              ],
            },
          ],
        },
        { tab: 'Blog', href: 'https://blog.example.com' },
      ]),
      tree,
    );
    expect(nav.tabs.map((t) => t.title)).toEqual(['Docs', 'Blog']);
    expect(nav.tabs[1]).toMatchObject({
      href: 'https://blog.example.com',
      sidebar: [],
    });
    expect(flattenSidebar(nav.tabs[0]!.sidebar).map((p) => p.path)).toEqual([
      '/',
      '/guides',
      '/guides/auth',
    ]);
  });

  it('lists visible pages missing from the navigation, not hidden ones', () => {
    const nav = buildNavigation(
      config([{ tab: 'T', groups: [{ group: 'G', pages: ['index'] }] }]),
      tree,
    );
    expect(nav.unlisted.map((p) => p.path)).toEqual([
      '/start',
      '/api/users',
      '/guides',
      '/guides/auth',
    ]);
  });

  it('reports every page id that does not exist', () => {
    const run = () =>
      buildNavigation(
        config([
          {
            tab: 'T',
            groups: [{ group: 'G', pages: ['nope', 'index', 'also/missing'] }],
          },
        ]),
        tree,
      );
    expect(run).toThrow(NavigationError);
    expect(run).toThrow(/T > G: page "nope"[\s\S]*"also\/missing"/);
  });

  it('allows a hidden page to be listed explicitly', () => {
    const nav = buildNavigation(
      config([
        { tab: 'T', groups: [{ group: 'G', pages: ['guides/secret'] }] },
      ]),
      tree,
    );
    expect(flattenSidebar(nav.tabs[0]!.sidebar).map((p) => p.path)).toEqual([
      '/guides/secret',
    ]);
  });
});

describe('buildNavigation: from folders', () => {
  const nav = buildNavigation(config([]), tree);

  it('makes one tab with folders as groups, hidden pages excluded', () => {
    expect(nav.tabs).toHaveLength(1);
    const titles = (items: ReturnType<typeof flattenSidebar>) =>
      items.map((p) => p.path);
    expect(titles(flattenSidebar(nav.tabs[0]!.sidebar))).toEqual([
      '/',
      '/start',
      '/api/users',
      '/guides',
      '/guides/auth',
    ]);
  });

  it('titles groups from the folder name and has nothing unlisted', () => {
    const groups = nav.tabs[0]!.sidebar.filter((i) => i.type === 'group');
    expect(groups.map((g) => g.title)).toEqual(['Api', 'Guides']);
    expect(nav.unlisted).toEqual([]);
  });
});
