import {
  type Navigation,
  type VariantUi,
  buildNavigation,
  buildPageTree,
  messagesFor,
  parseConfig,
} from '@dockudos/core';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Changelog } from '../components/changelog.tsx';
import { Section } from '../components/section.tsx';
import {
  Story,
  normalizeControl,
  registerStoryComponents,
  storyCode,
} from '../components/story.tsx';
import { Update } from '../components/update.tsx';
import { MessagesProvider, useMessages } from '../messages-context.tsx';
import { DocsProvider } from '../provider.tsx';
import { DocsLayout } from './docs-layout.tsx';
import {
  FallbackNotice,
  LanguageSwitcher,
  VersionBanner,
  VersionSwitcher,
} from './variant-controls.tsx';

const locales: VariantUi['locales'] = [
  {
    code: 'en',
    label: 'English',
    path: '/guides/a',
    exact: true,
    active: false,
  },
  {
    code: 'fr',
    label: 'Français',
    path: '/fr/guides/a',
    exact: true,
    active: true,
  },
  { code: 'ar', label: 'العربية', path: '/ar', exact: false, active: false },
];
const versions: VariantUi['versions'] = [
  {
    name: 'v2',
    label: '2.x',
    path: '/guides/a',
    exact: true,
    active: true,
    status: 'stable',
  },
  {
    name: 'v1',
    label: '1.x',
    path: '/v1',
    exact: false,
    active: false,
    status: 'deprecated',
  },
];

describe('switchers', () => {
  it('goes to the chosen language and remembers the choice in a cookie', async () => {
    const navigate = vi.fn();
    render(
      <DocsProvider navigate={navigate}>
        <LanguageSwitcher locales={locales} />
      </DocsProvider>,
    );
    const select = screen.getByRole('combobox', { name: 'Language' });
    expect(select).toHaveValue('fr');
    await userEvent.selectOptions(select, 'ar');
    expect(navigate).toHaveBeenCalledWith('/ar');
    expect(document.cookie).toContain('dockudos-locale=ar');
  });

  it('survives cookies being blocked', async () => {
    const navigate = vi.fn();
    const spy = vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(
      <DocsProvider navigate={navigate}>
        <LanguageSwitcher locales={locales} />
      </DocsProvider>,
    );
    await userEvent.selectOptions(screen.getByRole('combobox'), 'en');
    expect(navigate).toHaveBeenCalledWith('/guides/a');
    spy.mockRestore();
  });

  it('goes to the chosen version', async () => {
    const navigate = vi.fn();
    render(
      <DocsProvider navigate={navigate}>
        <VersionSwitcher versions={versions} />
      </DocsProvider>,
    );
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Version' }),
      'v1',
    );
    expect(navigate).toHaveBeenCalledWith('/v1');
  });

  it('shows nothing when there is nothing to choose, and ignores a value it does not know', () => {
    const { container } = render(
      <>
        <LanguageSwitcher locales={locales.slice(0, 1)} />
        <VersionSwitcher versions={[]} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
    const navigate = vi.fn();
    render(
      <DocsProvider navigate={navigate}>
        <VersionSwitcher versions={versions} />
      </DocsProvider>,
    );
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'nope' } });
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('notices', () => {
  it('links an old version to the same page in the latest', () => {
    render(
      <VersionBanner
        banner={{
          kind: 'outdated',
          version: 'v1',
          label: '1.x',
          latest: { path: '/guides/a', exact: true },
        }}
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent(
      'version 1.x, which is not the latest',
    );
    expect(
      screen.getByRole('link', {
        name: 'Go to this page in the latest version',
      }),
    ).toHaveAttribute('href', '/guides/a');
  });

  it('says deprecated and unreleased, and links to the latest home when the page has no equivalent', () => {
    const { rerender } = render(
      <VersionBanner
        banner={{
          kind: 'deprecated',
          version: 'v1',
          label: '1.x',
          latest: { path: '/', exact: false },
        }}
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent(
      'Version 1.x is deprecated',
    );
    expect(
      screen.getByRole('link', { name: 'Go to the latest version' }),
    ).toBeInTheDocument();
    rerender(
      <VersionBanner
        banner={{
          kind: 'unreleased',
          version: 'next',
          label: 'next',
          latest: { path: '/', exact: false },
        }}
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent(
      'preview of version next',
    );
  });

  it('explains an untranslated page, in the page language when it has the words', () => {
    render(
      <MessagesProvider messages={messagesFor('fr')}>
        <FallbackNotice
          fallback={{ language: 'Français', original: 'English' }}
        />
      </MessagesProvider>,
    );
    expect(screen.getByRole('note')).toHaveTextContent(
      'Cette page n’est pas encore disponible en Français. Elle est affichée en English.',
    );
  });
});

describe('messages', () => {
  function Probe() {
    const t = useMessages();
    return <p>{t('versionOutdated', { version: '9' })}</p>;
  }
  it('is English without a provider, and uses the provider otherwise', () => {
    const { unmount } = render(<Probe />);
    expect(
      screen.getByText(/version 9, which is not the latest/),
    ).toBeInTheDocument();
    unmount();
    render(
      <MessagesProvider messages={{ ...messagesFor('de') }}>
        <Probe />
      </MessagesProvider>,
    );
    expect(
      screen.getByText(/Version 9, die nicht die neueste ist/),
    ).toBeInTheDocument();
  });
});

describe('DocsLayout with versions and languages', () => {
  const tree = buildPageTree([
    { file: 'index.mdx', title: 'Accueil' },
    { file: 'a.mdx', title: 'A' },
  ]);
  const config = parseConfig({ name: 'Acme' });
  const nav: Navigation = buildNavigation(config, tree);
  const variant: VariantUi = {
    lang: 'ar',
    dir: 'rtl',
    locales: locales.map((l) => ({ ...l, active: l.code === 'ar' })),
    versions,
    banner: {
      kind: 'outdated',
      version: 'v1',
      label: '1.x',
      latest: { path: '/', exact: false },
    },
    fallback: { language: 'العربية', original: 'English' },
  };

  it('sets language and direction, shows switchers and notices, and uses translated words', () => {
    const { container } = render(
      <DocsLayout
        config={config}
        nav={nav}
        page={tree.pages[1]!}
        toc={[{ id: 'x', text: 'X', depth: 2 }]}
        variant={variant}
        lastModified={new Date('2026-03-31')}
      >
        body
      </DocsLayout>,
    );
    const shell = container.querySelector('.dk-shell');
    expect(shell).toHaveAttribute('lang', 'ar');
    expect(shell).toHaveAttribute('dir', 'rtl');
    expect(
      screen.getByRole('link', { name: 'تخطَّ إلى المحتوى' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'في هذه الصفحة' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'اللغة' })).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'الإصدار' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('note')).toHaveLength(2);
    expect(screen.getByText(/آخر تحديث/)).toBeInTheDocument();
  });

  it('stays as it was without a variant', () => {
    const { container } = render(
      <DocsLayout config={config} nav={nav} page={tree.pages[1]!} toc={[]}>
        body
      </DocsLayout>,
    );
    expect(container.querySelector('.dk-shell')).not.toHaveAttribute('lang');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Skip to content' }),
    ).toBeInTheDocument();
  });

  it('takes the words from the site when it passes them', () => {
    render(
      <DocsLayout
        config={config}
        nav={nav}
        page={tree.pages[1]!}
        toc={[]}
        messages={{ ...messagesFor('en'), skipToContent: 'Jump' }}
      >
        body
      </DocsLayout>,
    );
    expect(screen.getByRole('link', { name: 'Jump' })).toBeInTheDocument();
  });
});

describe('Update and Changelog', () => {
  const entries = (
    <>
      <Update label="1.4.0" date="2026-03-31" tags={['Added', 'Breaking']}>
        one
      </Update>
      <Update label="1.3.0" date="2026-02-01" tags={['Fixed']} id="custom">
        two
      </Update>
      <Update label="1.2.0">three</Update>
    </>
  );

  it('gives each entry an id for links and the feed', () => {
    const { container } = render(entries);
    expect(container.querySelector('#custom')).toBeInTheDocument();
    expect(
      container.querySelector('article#\\31 -4-0, article[id="1-4-0"]'),
    ).toBeInTheDocument();
  });

  it('filters by tag, and shows everything again when the tag is pressed twice', async () => {
    const { container } = render(<Changelog>{entries}</Changelog>);
    const added = await screen.findByRole('button', { name: 'Added' });
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Added',
      'Breaking',
      'Fixed',
    ]);
    const hidden = () =>
      [...container.querySelectorAll<HTMLElement>('.dk-update')].map(
        (e) => e.hidden,
      );
    expect(hidden()).toEqual([false, false, false]);
    await userEvent.click(added);
    expect(added).toHaveAttribute('aria-pressed', 'true');
    expect(hidden()).toEqual([false, true, true]);
    await userEvent.click(screen.getByRole('button', { name: 'Fixed' }));
    expect(hidden()).toEqual([true, false, true]);
    await userEvent.click(screen.getByRole('button', { name: 'Fixed' }));
    expect(hidden()).toEqual([false, false, false]);
  });

  it('has no filter row when no entry has tags', () => {
    render(
      <Changelog>
        <Update label="1.0.0">first</Update>
      </Changelog>,
    );
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('writes itself as Markdown', () => {
    expect(Changelog.toMarkdown({} as never, 'inner', {} as never)).toContain('inner');
  });
});

describe('Story', () => {
  it('normalizes shorthand controls', () => {
    expect(normalizeControl('a', true)).toEqual({
      type: 'boolean',
      value: true,
      label: 'a',
    });
    expect(normalizeControl('a', 'hi')).toEqual({
      type: 'text',
      value: 'hi',
      label: 'a',
    });
    expect(normalizeControl('a', 3)).toEqual({
      type: 'number',
      value: 3,
      label: 'a',
    });
    expect(normalizeControl('a', ['x', 'y'])).toMatchObject({
      type: 'select',
      value: 'x',
    });
    expect(normalizeControl('a', { type: 'boolean' })).toMatchObject({
      value: false,
    });
    expect(normalizeControl('a', { type: 'text', label: 'L' })).toMatchObject({
      value: '',
      label: 'L',
    });
    expect(normalizeControl('a', { type: 'number', min: 1 })).toMatchObject({
      value: 0,
      min: 1,
    });
    expect(
      normalizeControl('a', {
        type: 'select',
        options: ['p', 'q'],
        default: 'q',
      }),
    ).toMatchObject({ value: 'q' });
    expect(
      normalizeControl('a', { type: 'select', options: [] }),
    ).toMatchObject({ value: '' });
  });

  it('writes the JSX for what is shown, leaving out defaults', () => {
    expect(
      storyCode(
        'Badge',
        { color: 'blue', big: true, n: 2, off: false },
        { color: 'gray', big: false, n: 2, off: false },
      ),
    ).toBe('<Badge color="blue" big />');
    expect(storyCode('X', { n: 3 }, { n: 2 })).toBe('<X n={3} />');
    expect(storyCode('X', {}, {})).toBe('<X />');
  });

  it('changes a registered component as the controls change', async () => {
    render(
      <Story
        of="Badge"
        controls={{ color: ['gray', 'green'] }}
        title="Badge story"
      >
        New
      </Story>,
    );
    const badge = screen.getByText('New');
    expect(badge).toHaveAttribute('data-badge', 'gray');
    await userEvent.selectOptions(screen.getByLabelText('color'), 'green');
    expect(badge).toHaveAttribute('data-badge', 'green');
    expect(screen.getByText('<Badge color="green" />')).toBeInTheDocument();
  });

  it('drives text, number and boolean controls on any registered component', async () => {
    function Probe(props: { label?: string; count?: number; loud?: boolean }) {
      return (
        <output>{`${props.label}|${props.count}|${String(props.loud)}`}</output>
      );
    }
    registerStoryComponents({ Probe });
    render(
      <Story
        of="Probe"
        controls={{
          label: 'hi',
          count: { type: 'number', default: 1, min: 0 },
          loud: false,
        }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('hi|1|false');
    await userEvent.clear(screen.getByLabelText('label'));
    await userEvent.type(screen.getByLabelText('label'), 'yo');
    await userEvent.click(screen.getByLabelText('loud'));
    fireEvent.change(screen.getByLabelText('count'), {
      target: { value: '5' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('yo|5|true');
    fireEvent.change(screen.getByLabelText('count'), { target: { value: '' } });
    expect(screen.getByRole('status')).toHaveTextContent('yo|0|true');
  });

  it('sets props on a child element when no component is named', async () => {
    render(
      <Story controls={{ title: 'one' }}>
        <button type="button">press</button>
      </Story>,
    );
    expect(screen.getByRole('button', { name: 'press' })).toHaveAttribute(
      'title',
      'one',
    );
    expect(screen.getByText('<button />')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('title'), {
      target: { value: 'two' },
    });
    expect(screen.getByRole('button', { name: 'press' })).toHaveAttribute(
      'title',
      'two',
    );
    expect(screen.getByText('<button title="two" />')).toBeInTheDocument();
  });

  it('says so when the component is not registered, and copes with no child', () => {
    const { rerender } = render(<Story of="Nope" controls={{}} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'no component named "Nope"',
    );
    rerender(<Story controls={{}}>just text</Story>);
    expect(screen.getByText('just text')).toBeInTheDocument();
  });

  it('writes itself as Markdown', () => {
    expect(
      Story.toMarkdown(
        { controls: { size: ['a'], on: true }, title: 'T' } as never,
        'child',
      ),
    ).toMatch(/`size`, `on`/);
    expect(Story.toMarkdown({ controls: {} } as never, 'child')).not.toMatch(
      /Props you can change/,
    );
  });
});

describe('Section', () => {
  it('renders a band with title and lead, and writes itself as Markdown', () => {
    const { container } = render(
      <Section id="why" title="Why" lead="Because" tone="muted" align="center">
        inner
      </Section>,
    );
    expect(container.querySelector('section')).toHaveAttribute(
      'data-tone',
      'muted',
    );
    expect(screen.getByRole('heading', { name: 'Why' })).toBeInTheDocument();
    expect(screen.getByText('Because')).toBeInTheDocument();
    expect(
      Section.toMarkdown({ title: 'Why', lead: 'Because' } as never, 'inner'),
    ).toContain('## Why');
    render(<Section>bare</Section>);
  });
});
