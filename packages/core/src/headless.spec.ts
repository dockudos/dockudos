import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// The core must stay usable without a UI framework: a custom frontend (or a script) should be able
// to import it in an environment that has neither React nor Next.js.
vi.mock('react', () => {
  throw new Error('@dockudos/core must not import react');
});
vi.mock('react-dom', () => {
  throw new Error('@dockudos/core must not import react-dom');
});
vi.mock('next', () => {
  throw new Error('@dockudos/core must not import next');
});

describe('headless core', () => {
  it('imports no UI framework anywhere in its source', async () => {
    const dir = join(import.meta.dirname);
    const files = (await readdir(dir, { recursive: true })).filter(
      (f) => /\.tsx?$/.test(f) && !/\.spec\.tsx?$/.test(f),
    );
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const source = await readFile(join(dir, file), 'utf8');
      expect(source, file).not.toMatch(
        /from\s+['"](react|react-dom|next)(\/[^'"]*)?['"]/,
      );
      expect(file, 'no JSX files in core').not.toMatch(/\.tsx$/);
    }
  });

  it('drives a non-React frontend: renders a site as plain text', async () => {
    const core = await import('./index.ts');
    const config = core.parseConfig({
      name: 'Plain',
      navigation: [
        {
          tab: 'Docs',
          groups: [{ group: 'Start', pages: ['index', 'guides/auth'] }],
        },
      ],
    });
    const tree = core.buildPageTree([
      { file: 'index.mdx', title: 'Welcome' },
      { file: 'guides/auth.mdx', title: 'Auth' },
    ]);
    const nav = core.buildNavigation(config, tree);

    // A tiny "frontend": sidebar, breadcrumb, pager and contents, as text.
    const sidebar = core
      .flattenSidebar(nav.tabs[0]!.sidebar)
      .map(
        (p) =>
          `${p.path === '/guides/auth' ? '*' : '-'} ${p.title} (${p.path})`,
      )
      .join('\n');
    const crumbs = core
      .breadcrumb(nav, '/guides/auth')
      .map((c) => c.title)
      .join(' > ');
    const { prev } = core.prevNext(nav, '/guides/auth');
    const toc = core
      .extractToc('## Keys\n### Rotate')
      .map((t) => `${'  '.repeat(t.depth - 2)}${t.text} #${t.id}`);

    expect(sidebar).toBe('- Welcome (/)\n* Auth (/guides/auth)');
    expect(crumbs).toBe('Docs > Start > Auth');
    expect(prev?.path).toBe('/');
    expect(toc).toEqual(['Keys #keys', '  Rotate #rotate']);
  });
});
