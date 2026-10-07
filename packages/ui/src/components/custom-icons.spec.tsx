import { render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { DocsProvider } from '../provider.tsx';
import { iconPack } from '../lib/icon-pack.ts';
import { Card } from './cards.tsx';
import { Icon, isImageAddress, resolveIcon } from './icon.tsx';
import {
  type IconComponent,
  IconsProvider,
  useIconRegistry,
} from './icons-context.tsx';

const svgIcon = {
  viewBox: '0 0 8 8',
  body: '<path d="M0 0h8v8z" fill="#336699"/>',
  attrs: { stroke: 'currentColor' },
};
const Logo: IconComponent = (props) => (
  <svg data-testid="logo-component" {...props}>
    <circle r="1" />
  </svg>
);

describe('Icon: your own SVG icons', () => {
  it('renders an icon from a pack by its prefixed name, at the size asked for', () => {
    const { container } = render(
      <IconsProvider icons={{ 'acme:logo': svgIcon }}>
        <Icon name="acme:logo" size={24} />
      </IconsProvider>,
    );
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('viewBox', '0 0 8 8');
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg.innerHTML).toBe('<path d="M0 0h8v8z" fill="#336699"></path>');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('is case-insensitive and can be labelled for screen readers', () => {
    render(
      <IconsProvider icons={{ 'acme:logo': svgIcon }}>
        <Icon name="ACME:Logo" label="Acme logo" />
      </IconsProvider>,
    );
    expect(screen.getByRole('img', { name: 'Acme logo' })).toBeInTheDocument();
  });

  it('works through DocsProvider, the way the apps set it up', () => {
    const { container } = render(
      <DocsProvider icons={{ 'acme:logo': svgIcon }}>
        <Icon name="acme:logo" />
      </DocsProvider>,
    );
    expect(container.querySelector('svg path')).toBeInTheDocument();
  });

  it('is used by other components that take an icon name', () => {
    const { container } = render(
      <IconsProvider icons={{ 'acme:logo': svgIcon }}>
        <Card title="Brand" icon="acme:logo" />
      </IconsProvider>,
    );
    expect(
      container.querySelector('svg[viewBox="0 0 8 8"]'),
    ).toBeInTheDocument();
  });
});

describe('Icon: your own React components', () => {
  it('renders a component by name, passing size and the usual SVG props', () => {
    render(
      <IconsProvider components={{ 'acme:mark': Logo }}>
        <Icon name="acme:mark" size={20} className="mine" />
      </IconsProvider>,
    );
    const el = screen.getByTestId('logo-component');
    expect(el).toHaveAttribute('width', '20');
    expect(el).toHaveClass('mine');
  });

  it('can replace a built-in icon, and a pack wins over the built-ins but loses to a component', () => {
    const registry = {
      data: { rocket: svgIcon },
      components: { rocket: Logo },
    };
    expect(resolveIcon('rocket', registry)?.kind).toBe('component');
    expect(
      resolveIcon('rocket', { data: { rocket: svgIcon }, components: {} })
        ?.kind,
    ).toBe('svg');
    expect(resolveIcon('rocket', { data: {}, components: {} })?.kind).toBe(
      'builtin',
    );
    expect(resolveIcon('nope', registry)).toBeUndefined();
  });

  it('providers nest: an inner one adds to the outer one', () => {
    function Names() {
      const { data, components } = useIconRegistry();
      return (
        <p data-testid="names">
          {[...Object.keys(data), ...Object.keys(components)].sort().join(',')}
        </p>
      );
    }
    render(
      <IconsProvider icons={{ 'a:one': svgIcon }}>
        <IconsProvider components={{ 'b:two': Logo }}>
          <Names />
        </IconsProvider>
      </IconsProvider>,
    );
    expect(screen.getByTestId('names')).toHaveTextContent('a:one,b:two');
  });
});

describe('Icon: image addresses', () => {
  it.each([
    '/logo.svg',
    'https://cdn.example.com/a.png',
    'http://x.test/a.svg',
  ])('%s is shown as an image', (src) => {
    expect(isImageAddress(src)).toBe(true);
    const { container } = render(<Icon name={src} size={18} />);
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('src', src);
    expect(img).toHaveAttribute('width', '18');
    expect(img).toHaveAttribute('alt', '');
  });

  it.each([
    'rocket',
    'acme:logo',
    '//evil.test/x.svg',
    'javascript:alert(1)',
    'data:image/svg+xml;base64,AAAA',
    './local.svg',
  ])('%s is not treated as an image address', (name) => {
    expect(isImageAddress(name)).toBe(false);
  });

  it('labels an image icon when asked', () => {
    render(<Icon name="/logo.svg" label="Logo" />);
    expect(screen.getByRole('img', { name: 'Logo' })).toBeInTheDocument();
  });
});

describe('Icon: unknown names', () => {
  it("suggests the pack's icons when the prefix is known", () => {
    expect(() =>
      render(
        <IconsProvider icons={{ 'acme:logo': svgIcon, 'acme:mark': svgIcon }}>
          <Icon name="acme:lgo" />
        </IconsProvider>,
      ),
    ).toThrow(/Did you mean acme:logo/);
  });

  it('says when the pack itself does not exist', () => {
    expect(() => render(<Icon name="nopack:logo" />)).toThrow(
      /no icon pack called "nopack"/,
    );
  });

  it('still suggests built-in icons for a plain typo', () => {
    expect(() => render(<Icon name="rocke" />)).toThrow(/rocket/);
  });
});

describe('iconPack', () => {
  const IconRocket = () => null;
  const IconCog2 = forwardRef(() => null);

  it('names components with the prefix and kebab-case, skipping what is not a component', () => {
    const pack = iconPack('tabler', {
      IconRocket,
      IconCog2,
      helper: () => null,
      VERSION: '1.0',
      Config: { size: 1 },
    });
    expect(Object.keys(pack).sort()).toEqual([
      'tabler:icon-cog-2',
      'tabler:icon-rocket',
    ]);
  });

  it('can strip a prefix from the export names', () => {
    expect(
      Object.keys(
        iconPack('tabler', { IconRocket, IconCog2 }, { strip: 'Icon' }),
      ).sort(),
    ).toEqual(['tabler:cog-2', 'tabler:rocket']);
  });
});
