import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CopyText } from './copy-text.tsx';
import { Endpoint } from './endpoint.tsx';
import { Hero, LinkButton } from './hero.tsx';
import { ParamField, ResponseField } from './param-field.tsx';
import { Update } from './update.tsx';

describe('ParamField and ResponseField', () => {
  it('shows name, type, location, required, default and description', () => {
    const { container } = render(
      <ParamField name="limit" type="number" location="query" required default="10">
        How many to return.
      </ParamField>,
    );
    expect(container.querySelector('.dk-param-name')).toHaveTextContent('limit');
    expect(container).toHaveTextContent('number');
    expect(container).toHaveTextContent('query');
    expect(container).toHaveTextContent('required');
    expect(container).toHaveTextContent('default 10');
    expect(screen.getByText('How many to return.')).toBeInTheDocument();
  });

  it('omits what is not given, and a default of 0 or empty string still shows', () => {
    const { container } = render(<ParamField name="n" default="0" />);
    expect(container).not.toHaveTextContent('required');
    expect(container).toHaveTextContent('default 0');
    expect(container.querySelector('.dk-param-body')).toBeNull();
  });

  it('ResponseField has no required or location', () => {
    const { container } = render(<ResponseField name="id" type="string">The id.</ResponseField>);
    expect(container).not.toHaveTextContent('required');
    expect(container).toHaveTextContent('The id.');
  });
});

describe('Endpoint', () => {
  it('shows the method and path', () => {
    render(<Endpoint method="POST" path="/v1/users/{id}" baseUrl="https://api.acme.dev" />);
    expect(screen.getByText('POST')).toHaveAttribute('data-method', 'POST');
    expect(screen.getByText('/v1/users/{id}', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('https://api.acme.dev')).toBeInTheDocument();
  });

  it('falls back to GET for an unknown method', () => {
    render(<Endpoint method={'FETCH' as never} path="/x" />);
    expect(screen.getByText('GET')).toBeInTheDocument();
  });
});

describe('Update', () => {
  it('renders a changelog entry with a formatted, machine-readable date and tags', () => {
    const { container } = render(
      <Update label="1.4.0" date="2026-03-05" tags={['Added', 'Breaking']}>
        New things.
      </Update>,
    );
    expect(screen.getByRole('heading', { name: '1.4.0' })).toBeInTheDocument();
    const time = container.querySelector('time')!;
    expect(time).toHaveAttribute('datetime', '2026-03-05');
    expect(time).toHaveTextContent('March 5, 2026');
    expect(screen.getByText('Breaking')).toHaveAttribute('data-badge', 'red');
    expect(screen.getByText('Added')).toHaveAttribute('data-badge', 'blue');
  });

  it('shows a date it cannot parse as written', () => {
    const { container } = render(<Update label="x" date="Spring 2026" />);
    expect(container.querySelector('time')).toBeNull();
    expect(container).toHaveTextContent('Spring 2026');
  });
});

describe('CopyText', () => {
  it('copies the text, or an explicit value, and announces it', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(
      <>
        <CopyText>npm install dockudos</CopyText>
        <CopyText value="sk_test_123">sk_test_…</CopyText>
      </>,
    );
    const [a, b] = screen.getAllByRole('button', { name: 'Copy' });
    await user.click(a!);
    expect(writeText).toHaveBeenLastCalledWith('npm install dockudos');
    await user.click(b!);
    expect(writeText).toHaveBeenLastCalledWith('sk_test_123');
    expect((await screen.findAllByRole('status'))[1]).toHaveTextContent('Copied to clipboard');
  });

  it('reports a failed copy', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true });
    render(<CopyText>x</CopyText>);
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Copy failed');
  });
});

describe('Hero and LinkButton', () => {
  it('renders eyebrow, headline, description and actions', () => {
    render(
      <Hero eyebrow="v0.1" title="Docs that ship" description="From MDX.">
        <LinkButton href="/quickstart">Get started</LinkButton>
        <LinkButton href="https://github.com/x/y" variant="secondary">GitHub</LinkButton>
      </Hero>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Docs that ship' })).toBeInTheDocument();
    expect(screen.getByText('v0.1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/quickstart');
    const ext = screen.getByRole('link', { name: /GitHub/ });
    expect(ext).toHaveAttribute('target', '_blank');
    expect(ext).toHaveClass('dk-button-secondary');
  });
});
