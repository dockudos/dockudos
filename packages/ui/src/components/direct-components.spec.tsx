import { render, screen } from '@testing-library/react';
import { AskScopeSetter } from '../layout/ask-scope.tsx';
import { askScopeFields, setAskScope } from '../lib/scope.ts';
import { DocsProvider } from '../provider.tsx';
import { DockudosLogo } from './logo.tsx';
import { Kbd, KeyCap } from './kbd.tsx';
import { isExternal, SmartLink } from './smart-link.tsx';
import { Tree, TreeFile, TreeFolder } from './tree.tsx';

describe('isExternal', () => {
  it.each([
    ['https://example.com', true],
    ['http://example.com/x', true],
    ['mailto:a@b.c', true],
    ['tel:+123', true],
    ['//cdn.example.com/x.js', true],
    ['HTTPS://EXAMPLE.COM', true],
    ['/guide', false],
    ['guide/page', false],
    ['#section', false],
    ['?q=1', false],
    ['./relative', false],
    ['', false],
  ])('%j -> %s', (href, expected) => {
    expect(isExternal(href)).toBe(expected);
  });
});

describe('SmartLink', () => {
  it('opens another site in a new tab, safely, and says so to screen readers', () => {
    render(<SmartLink href="https://example.com/x" className="c">Docs</SmartLink>);
    const a = screen.getByRole('link', { name: /Docs/ });
    expect(a).toHaveAttribute('href', 'https://example.com/x');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noreferrer noopener');
    expect(a).toHaveClass('c');
    expect(a).toHaveTextContent('Docs (opens in a new tab)');
  });

  it('uses the host router for a page of this site, with no new tab', () => {
    const seen: string[] = [];
    render(
      <DocsProvider
        Link={({ href, children, ...rest }) => {
          seen.push(String(href));
          return (
            <a href={href} data-router="yes" {...rest}>
              {children}
            </a>
          );
        }}
      >
        <SmartLink href="/guide" className="c">Guide</SmartLink>
      </DocsProvider>,
    );
    const a = screen.getByRole('link', { name: 'Guide' });
    expect(seen).toContain('/guide');
    expect(a).toHaveAttribute('data-router', 'yes');
    expect(a).not.toHaveAttribute('target');
    expect(a).toHaveClass('c');
    expect(a).not.toHaveTextContent('new tab');
  });

  it('works without a provider, as a plain link', () => {
    render(<SmartLink href="/plain">Plain</SmartLink>);
    expect(screen.getByRole('link', { name: 'Plain' })).toHaveAttribute('href', '/plain');
  });
});

describe('Kbd and KeyCap', () => {
  it('draws one cap for one key', () => {
    const { container } = render(<Kbd>Esc</Kbd>);
    expect(container.querySelectorAll('kbd')).toHaveLength(1);
  });

  it('splits Ctrl+K into two caps joined by a plus that screen readers skip', () => {
    const { container } = render(<Kbd>Ctrl + K</Kbd>);
    const caps = [...container.querySelectorAll('kbd')].map((k) => k.textContent);
    expect(caps).toEqual(['Ctrl', 'K']);
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('+');
  });

  it('keeps an element child as one cap', () => {
    const { container } = render(<Kbd><b>Cmd</b></Kbd>);
    expect(container.querySelectorAll('kbd')).toHaveLength(1);
    expect(container.querySelector('kbd b')).toHaveTextContent('Cmd');
  });

  it('KeyCap is a kbd with the shared look', () => {
    const { container } = render(<KeyCap>A</KeyCap>);
    expect(container.querySelector('kbd')).toHaveClass('dk-key');
  });
});

describe('Tree', () => {
  it('is a labelled tree of folders and files, folders closed unless told otherwise', () => {
    render(
      <Tree>
        <TreeFolder name="src" defaultOpen>
          <TreeFile name="index.ts" />
          <TreeFolder name="lib">
            <TreeFile name="a.ts" />
          </TreeFolder>
        </TreeFolder>
      </Tree>,
    );
    expect(screen.getByRole('tree', { name: 'File tree' })).toBeInTheDocument();
    const items = screen.getAllByRole('treeitem');
    expect(items).toHaveLength(4);
    const src = items.find((i) => i.textContent?.startsWith('src'))!;
    const lib = items.find((i) => i.textContent?.startsWith('lib'))!;
    expect(src).toHaveAttribute('aria-expanded', 'true');
    expect(src.querySelector('details')).toHaveProperty('open', true);
    expect(lib).toHaveAttribute('aria-expanded', 'false');
    expect(lib.querySelector('details')).toHaveProperty('open', false);
    expect(screen.getByText('index.ts')).toBeInTheDocument();
  });

  it('shows a custom file icon instead of the default', () => {
    const { container } = render(<TreeFile name="x.md" icon={<i data-testid="mine" />} />);
    expect(screen.getByTestId('mine')).toBeInTheDocument();
    expect(container.querySelector('li > svg')).toBeNull();
  });

  it('shows one custom folder icon, or a different one when open', () => {
    const { rerender } = render(<TreeFolder name="a" icon={<i data-testid="shut" />} />);
    expect(screen.getByTestId('shut')).toBeInTheDocument();
    expect(screen.queryByTestId('opened')).toBeNull();
    rerender(
      <TreeFolder name="a" icon={<i data-testid="shut" />} openIcon={<i data-testid="opened" />} />,
    );
    expect(screen.getByTestId('shut')).toBeInTheDocument();
    expect(screen.getByTestId('opened')).toBeInTheDocument();
  });
});

describe('DockudosLogo', () => {
  it('is decorative, uses the text color and passes props through', () => {
    const { container } = render(<DockudosLogo className="h-6" data-x="1" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveClass('h-6');
    expect(svg).toHaveAttribute('data-x', '1');
    expect(svg.querySelector('path[fill="currentColor"]')).not.toBeNull();
    expect(svg.querySelector('path[fill="#12C752"]')).not.toBeNull();
  });
});

describe('AskScopeSetter', () => {
  afterEach(() => setAskScope({}));

  it('tells the assistant the reader\'s language and version, and renders nothing', () => {
    const { container } = render(<AskScopeSetter locale="fr" version="v2" />);
    expect(container).toBeEmptyDOMElement();
    expect(askScopeFields()).toEqual({ locale: 'fr', version: 'v2' });
  });

  it('sends only the parts that are set, and follows the page when it changes', () => {
    const { rerender } = render(<AskScopeSetter version="v1" />);
    expect(askScopeFields()).toEqual({ version: 'v1' });
    rerender(<AskScopeSetter locale="de" />);
    expect(askScopeFields()).toEqual({ locale: 'de' });
    rerender(<AskScopeSetter />);
    expect(askScopeFields()).toEqual({});
  });
});
