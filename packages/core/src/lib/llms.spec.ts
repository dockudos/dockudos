import { parseConfig } from './config.ts';
import {
  buildLlmsFullTxt,
  buildLlmsTxt,
  markdownTwinPath,
  publicPages,
  resolveTwinTarget,
} from './llms.ts';
import { buildNavigation } from './navigation.ts';
import { buildPageTree } from './page-tree.ts';

const tree = buildPageTree([
  { file: 'index.mdx', title: 'Home', description: 'Welcome\nhome' },
  { file: 'guides/auth.mdx', title: 'Authentication', description: 'Sign in' },
  { file: 'guides/billing.mdx', title: 'Billing' },
  { file: 'guides/secret.mdx', title: 'Unlisted hidden', hidden: true },
  { file: 'extra.mdx', title: 'Extra' },
  { file: 'private/plan.mdx', title: 'Private plan' },
]);

const config = parseConfig({
  name: 'Acme Docs',
  seo: { siteUrl: 'https://docs.acme.com', description: 'The  Acme docs.' },
  access: { rules: [{ paths: ['/private/**'], require: 'deny' }] },
  navigation: [
    {
      tab: 'Guides',
      groups: [
        {
          group: 'Start',
          pages: [
            'index',
            { group: 'Nested', pages: ['guides/auth'] },
            'guides/secret',
          ],
        },
        { group: 'Money', pages: ['guides/billing', 'private/plan'] },
      ],
    },
  ],
});
const nav = buildNavigation(config, tree);

describe('markdownTwinPath', () => {
  it('adds .md, and names the home page index.md', () => {
    expect(markdownTwinPath('/guides/auth')).toBe('/guides/auth.md');
    expect(markdownTwinPath('/')).toBe('/index.md');
    expect(markdownTwinPath('/docs')).toBe('/docs.md');
  });
});

describe('resolveTwinTarget', () => {
  const pages = [{ path: '/' }, { path: '/guides' }, { path: '/guides/auth' }];
  it('finds pages, and the home page as /index', () => {
    expect(resolveTwinTarget(pages, '/guides/auth')).toBe('/guides/auth');
    expect(resolveTwinTarget(pages, 'guides/auth')).toBe('/guides/auth');
    expect(resolveTwinTarget(pages, '/index')).toBe('/');
    expect(resolveTwinTarget(pages, '/nope')).toBeUndefined();
    expect(resolveTwinTarget(pages, '/guides/index')).toBeUndefined();
  });
});

describe('publicPages', () => {
  it('lists pages in reading order, without hidden or protected ones', () => {
    expect(
      publicPages(config, nav).map((p) => [p.page.path, p.section]),
    ).toEqual([
      ['/', 'Start'],
      ['/guides/auth', 'Start'],
      ['/guides/billing', 'Money'],
      ['/extra', undefined],
    ]);
  });
});

describe('buildLlmsTxt', () => {
  it('follows the llms.txt format', () => {
    expect(buildLlmsTxt(config, nav)).toBe(
      [
        '# Acme Docs',
        '',
        '> The Acme docs.',
        '',
        '## Start',
        '',
        '- [Home](https://docs.acme.com/index.md): Welcome home',
        '- [Authentication](https://docs.acme.com/guides/auth.md): Sign in',
        '',
        '## Money',
        '',
        '- [Billing](https://docs.acme.com/guides/billing.md)',
        '',
        '## Optional',
        '',
        '- [Extra](https://docs.acme.com/extra.md)',
        '',
      ].join('\n'),
    );
  });

  it('uses site-relative links without a siteUrl and omits the summary when there is none', () => {
    const plain = parseConfig({ name: 'Acme' });
    const out = buildLlmsTxt(plain, buildNavigation(plain, tree));
    expect(out).toContain('- [Authentication](/guides/auth.md): Sign in');
    expect(out.split('\n')[1]).toBe('');
    expect(out).not.toContain('>');
  });

  it('never mentions hidden or protected pages', () => {
    const out = buildLlmsTxt(config, nav);
    expect(out).not.toMatch(/Unlisted hidden|Private plan|secret|private/);
  });
});

describe('buildLlmsFullTxt', () => {
  it('joins the Markdown of every public page with its source address', async () => {
    const out = await buildLlmsFullTxt(
      config,
      nav,
      (page) => `# ${page.title}\n\nBody of ${page.path}\n`,
    );
    expect(out).toContain('# Acme Docs\n\n> The Acme docs.');
    expect(out).toContain(
      '# Authentication\n\nSource: https://docs.acme.com/guides/auth\n\nBody of /guides/auth',
    );
    expect(out.split('\n\n---\n\n')).toHaveLength(5);
    expect(out).not.toMatch(/Unlisted hidden|Private plan/);
    expect(out.endsWith('\n')).toBe(true);
  });
});
