import { renderToStaticMarkup } from 'react-dom/server';
import { DocsRoot } from './client.tsx';

const seen = vi.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined,
  pushed: [] as string[],
}));

vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: (href: string) => seen.pushed.push(href) }),
}));
vi.mock('next/link.js', () => ({ default: () => null }));
vi.mock('@dockudos/ui', () => ({
  DocsProvider: (props: Record<string, unknown> & { children: unknown }) => {
    seen.props = props;
    return props.children;
  },
}));

describe('DocsRoot', () => {
  it('gives the docs UI the Next router and link, and your icons and search backend', () => {
    const searchBackend = { search: async () => [] } as never;
    const html = renderToStaticMarkup(
      <DocsRoot icons={{}} iconComponents={{}} searchBackend={searchBackend}>
        <p>child</p>
      </DocsRoot>,
    );
    expect(html).toBe('<p>child</p>');
    const props = seen.props as {
      navigate: (href: string) => void;
      Link: unknown;
      searchBackend: unknown;
    };
    expect(props.searchBackend).toBe(searchBackend);
    expect(typeof props.Link).toBe('function');
    props.navigate('/guides');
    expect(seen.pushed).toEqual(['/guides']);
  });
});
