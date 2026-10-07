import { breadcrumb, extractToc, prevNext } from './helpers.ts';
import { buildNavigation } from './navigation.ts';
import { buildPageTree } from './page-tree.ts';

const tree = buildPageTree([
  { file: 'index.mdx', title: 'Home' },
  { file: 'a.mdx', title: 'A' },
  { file: 'b.mdx', title: 'B' },
  { file: 'c.mdx', title: 'C' },
]);
const nav = buildNavigation(
  {
    navigation: [
      {
        tab: 'One',
        groups: [
          { group: 'G1', pages: ['index', { group: 'Inner', pages: ['a'] }] },
        ],
      },
      { tab: 'Two', groups: [{ group: 'G2', pages: ['b', 'c'] }] },
    ],
  },
  tree,
);

describe('breadcrumb', () => {
  it('walks tab, groups and page', () => {
    expect(breadcrumb(nav, '/a')).toEqual([
      { title: 'One' },
      { title: 'G1' },
      { title: 'Inner' },
      { title: 'A', href: '/a' },
    ]);
  });

  it('is empty for a page outside the navigation', () => {
    expect(breadcrumb(nav, '/nope')).toEqual([]);
  });
});

describe('prevNext', () => {
  it('links neighbours within a tab', () => {
    expect(prevNext(nav, '/').next?.path).toBe('/a');
    expect(prevNext(nav, '/a').prev?.path).toBe('/');
  });

  it('stops at the edges of a tab', () => {
    expect(prevNext(nav, '/').prev).toBeUndefined();
    expect(prevNext(nav, '/a').next).toBeUndefined();
    expect(prevNext(nav, '/b').prev).toBeUndefined();
  });

  it('is empty for unknown pages', () => {
    expect(prevNext(nav, '/zzz')).toEqual({});
  });
});

describe('extractToc', () => {
  const src = [
    '---',
    'title: T',
    '---',
    '# Title',
    '## Getting started',
    '### Install `pnpm`',
    '```md',
    '## not a heading',
    '```',
    '## Getting started',
    '#### [Link](https://x.y) and **bold** snake_case',
    '##### too deep',
  ].join('\n');

  it('returns h2-h4 with github-slugger ids', () => {
    expect(extractToc(src)).toEqual([
      { id: 'getting-started', text: 'Getting started', depth: 2 },
      { id: 'install-pnpm', text: 'Install pnpm', depth: 3 },
      { id: 'getting-started-1', text: 'Getting started', depth: 2 },
      {
        id: 'link-and-bold-snake_case',
        text: 'Link and bold snake_case',
        depth: 4,
      },
    ]);
  });

  it('honours depth options and counts h1 for duplicate numbering', () => {
    expect(extractToc('# A\n## A', { minDepth: 1 }).map((e) => e.id)).toEqual([
      'a',
      'a-1',
    ]);
  });

  it('ignores headings inside a fence indented under JSX', () => {
    const src = '<Step>\n    ```md\n    ## fake\n    ```\n</Step>\n## real';
    expect(extractToc(src).map((e) => e.id)).toEqual(['real']);
  });

  it('returns nothing for a page without headings', () => {
    expect(extractToc('just text')).toEqual([]);
  });
});
