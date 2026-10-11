import {
  type Navigation,
  buildNavigation,
  buildPageTree,
  parseConfig,
} from '@dockudos/core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocsLayout } from './docs-layout.tsx';

const tree = buildPageTree([
  { file: 'index.mdx', title: 'Home' },
  { file: 'learn/one.mdx', title: 'Step one', sidebarTitle: 'One' },
  { file: 'learn/two.mdx', title: 'Step two' },
]);
const config = parseConfig({
  name: 'Acme',
  seo: { siteUrl: 'https://acme.test/' },
  actions: {
    copyPage: true,
    assistants: true,
    editUrl: 'https://github.com/acme/docs/edit/main/{file}',
  },
  navigation: [
    {
      tab: 'Docs',
      groups: [
        { group: 'Start', pages: ['index'] },
        { group: 'Learn', tutorial: true, pages: ['learn/one', 'learn/two'] },
      ],
    },
  ],
});
const nav: Navigation = buildNavigation(config, tree);
const page = (path: string) => tree.pages.find((p) => p.path === path)!;

describe('DocsLayout, tutorials and actions', () => {
  it('shows the tutorial header with step titles, and says when the last step is done', () => {
    render(
      <DocsLayout config={config} nav={nav} page={page('/learn/two')} toc={[]}>
        body
      </DocsLayout>,
    );
    const steps = within(
      screen.getByRole('navigation', { name: 'Learn, tutorial steps' }),
    );
    expect(screen.getByText(/Step 2 of 2/)).toBeInTheDocument();
    expect(steps.getByRole('link', { name: /One/ })).toBeInTheDocument();
    expect(steps.getByRole('link', { name: /Step two/ })).toBeInTheDocument();
    expect(screen.getByText('You have finished Learn.')).toBeInTheDocument();
  });

  it('does not say the tutorial is finished on an earlier step', () => {
    render(
      <DocsLayout config={config} nav={nav} page={page('/learn/one')} toc={[]}>
        body
      </DocsLayout>,
    );
    expect(screen.queryByText(/You have finished/)).toBeNull();
  });

  it('offers page actions, with an assistant prompt that names the live page', async () => {
    const user = userEvent.setup();
    render(
      <DocsLayout config={config} nav={nav} page={page('/learn/one')} toc={[]}>
        body
      </DocsLayout>,
    );
    expect(
      screen.getByRole('button', { name: 'Copy page' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Edit/ })).toHaveAttribute(
      'href',
      'https://github.com/acme/docs/edit/main/learn/one.mdx',
    );
    await user.click(
      screen.getByRole('button', { name: /More actions for Step one/ }),
    );
    const claude = await screen.findByRole('menuitem', {
      name: /Open in Claude/,
    });
    expect(claude).toHaveAttribute(
      'href',
      expect.stringContaining(
        encodeURIComponent('https://acme.test/learn/one'),
      ),
    );
  });

  it('copies the page as Markdown from the menu', async () => {
    const user = userEvent.setup();
    const copied = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('# Page')),
    );
    render(
      <DocsLayout config={config} nav={nav} page={page('/learn/one')} toc={[]}>
        body
      </DocsLayout>,
    );
    await user.click(
      screen.getByRole('button', { name: /More actions for Step one/ }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: /Copy as Markdown/ }),
    );
    await waitFor(() => expect(copied).toHaveBeenCalledWith('# Page'));
    vi.unstubAllGlobals();
    copied.mockRestore();
  });

  it('has no sidebar for a site with no sections, and no actions when none are on', () => {
    const bare = parseConfig({
      name: 'Bare',
      actions: { copyPage: false, assistants: false },
    });
    const empty = { tabs: [], unlisted: [] } as unknown as Navigation;
    const { container } = render(
      <DocsLayout config={bare} nav={empty} page={page('/')} toc={[]}>
        body
      </DocsLayout>,
    );
    expect(container.querySelector('.dk-sidebar')?.children).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Copy page/i })).toBeNull();
  });

  it('offers only editing when copying and assistants are off', () => {
    const editOnly = parseConfig({
      name: 'Acme',
      seo: { siteUrl: 'https://acme.test' },
      actions: {
        copyPage: false,
        assistants: false,
        editUrl: 'https://github.com/acme/{file}',
      },
      navigation: config.navigation as never,
    });
    render(
      <DocsLayout
        config={editOnly}
        nav={nav}
        page={page('/learn/one')}
        toc={[]}
      >
        body
      </DocsLayout>,
    );
    expect(screen.getByRole('link', { name: /Edit/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy page' })).toBeNull();
  });
});
