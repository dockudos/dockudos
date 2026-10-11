import { type DocsConfig } from './config.ts';
import {
  buildNavigation,
  tutorialOf,
  flattenSidebar,
  NavigationError,
  type SidebarItem,
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

describe('tutorialOf', () => {
  const nav = buildNavigation(
    config([
      {
        tab: 'T',
        groups: [
          { group: 'Basics', pages: ['index'] },
          {
            group: 'Build it',
            tutorial: true,
            pages: ['start', 'guides/auth', 'api/users'],
          },
        ],
      },
    ]),
    tree,
  );

  it('numbers the steps of a tutorial group', () => {
    const at = tutorialOf(nav, '/guides/auth');
    expect(at?.title).toBe('Build it');
    expect(at?.step).toBe(2);
    expect(at?.steps.map((p) => p.path)).toEqual([
      '/start',
      '/guides/auth',
      '/api/users',
    ]);
  });

  it('is undefined for a page outside a tutorial', () => {
    expect(tutorialOf(nav, '/')).toBeUndefined();
  });
});

type GroupItem = Extract<SidebarItem, { type: 'group' }>;

describe('API sources in navigation', () => {
  const api = (
    file: string,
    title: string,
    meta: { group?: string; order?: number; kind?: string },
    hidden = false,
  ) => ({
    file,
    title,
    hidden,
    api: { source: 'pets', kind: 'operation', ...meta },
  });
  const apiTree = buildPageTree([
    { file: 'index.mdx', title: 'Home' },
    api('pets/index.mdx', 'Overview', { kind: 'overview', order: 0 }),
    api('pets/b.mdx', 'Get B', { group: 'Beta', order: 3 }),
    api('pets/a.mdx', 'List A', { group: 'Alpha', order: 1 }),
    api('pets/a2.mdx', 'Make A', { group: 'Alpha', order: 2 }),
    api('pets/gone.mdx', 'Hidden', { group: 'Alpha', order: 9 }, true),
    api('pets/unordered.mdx', 'Unordered', { group: 'Alpha' }),
  ]);

  it('expands a source into its overview and one group per tag, in spec order', () => {
    const nav = buildNavigation(
      config([
        {
          tab: 'API',
          groups: [{ group: 'Pets', pages: [{ openapi: 'pets' }] }],
        },
      ]),
      apiTree,
    );
    const items = (nav.tabs[0]!.sidebar[0] as GroupItem).items;
    expect(
      items.map((i) => (i.type === 'page' ? i.page.title : i.type)),
    ).toEqual(['Overview', 'group', 'group']);
    const groups = items.filter((i) => i.type === 'group');
    expect(groups.map((g) => g.type === 'group' && g.title)).toEqual([
      'Alpha',
      'Beta',
    ]);
    // The unordered page sorts first (order 0); the hidden one is left out.
    expect(
      groups[0]!.type === 'group' &&
        groups[0]!.items.map((i) => i.type === 'page' && i.page.title),
    ).toEqual(['Unordered', 'List A', 'Make A']);
    expect(nav.unlisted.map((p) => p.path)).toEqual(['/']);
  });

  it('expands a code reference the same way', () => {
    const nav = buildNavigation(
      config([
        {
          tab: 'API',
          groups: [{ group: 'Pets', pages: [{ reference: 'pets' }] }],
        },
      ]),
      apiTree,
    );
    expect((nav.tabs[0]!.sidebar[0] as GroupItem).items.length).toBe(3);
  });

  it('says which source produced nothing', () => {
    expect(() =>
      buildNavigation(
        config([
          {
            tab: 'API',
            groups: [{ group: 'X', pages: [{ openapi: 'missing' }] }],
          },
        ]),
        apiTree,
      ),
    ).toThrow(/no pages were generated for "missing"/);
  });
});

describe('tutorialOf: nested groups', () => {
  it('finds a tutorial group inside another group, and gives up on a page in none', () => {
    const nav = buildNavigation(
      config([
        {
          tab: 'T',
          groups: [
            {
              group: 'Outer',
              pages: [
                'index',
                {
                  group: 'Inner',
                  tutorial: true,
                  pages: ['start', 'guides/auth'],
                },
              ],
            },
          ],
        },
      ]),
      tree,
    );
    expect(tutorialOf(nav, '/guides/auth')).toMatchObject({
      title: 'Inner',
      step: 2,
    });
    expect(tutorialOf(nav, '/')).toBeUndefined();
    expect(tutorialOf(nav, '/not-there')).toBeUndefined();
  });
});
