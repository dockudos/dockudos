import type { ApiOperationData } from '@dockudos/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiOperation } from './context.tsx';
import { ApiPlayground } from './playground.tsx';

const data = (
  codeSamples: { lang: string; label: string; source: string }[] | undefined,
  rest: Partial<ApiOperationData> = {},
): ApiOperationData => ({
  operation: {
    id: 'op',
    method: 'get',
    path: '/things',
    tags: [],
    parameters: [],
    responses: [],
    security: [],
    ...(codeSamples && { codeSamples }),
  },
  servers: [{ url: 'https://api.test' }],
  securitySchemes: {},
  ...rest,
});

const mount = (d: ApiOperationData) =>
  render(
    <ApiOperation data={d} schemasUrl="/s">
      <ApiPlayground />
    </ApiOperation>,
  );

const tabs = () => screen.getAllByRole('tab').map((t) => t.textContent);

beforeEach(() => localStorage.clear());

describe('code sample tabs from the spec', () => {
  const samples = [
    {
      lang: 'Shell',
      label: 'cURL (from the spec)',
      source: 'curl --silent https://api.test/things',
    },
    {
      lang: 'Ruby',
      label: 'Ruby',
      source: 'Net::HTTP.get(URI("https://api.test/things"))',
    },
  ];

  it('shows the generated tabs unchanged when the spec has none', () => {
    mount(data(undefined));
    expect(tabs()).toEqual(['cURL', 'JavaScript', 'Python', 'Go']);
  });

  it('replaces the tab for the language it stands for and adds the others (the default)', async () => {
    mount(data(samples));
    expect(tabs()).toEqual([
      'cURL (from the spec)',
      'JavaScript',
      'Python',
      'Go',
      'Ruby',
    ]);
    expect(screen.getByText(/curl --silent/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Ruby' }));
    expect(screen.getByText(/Net::HTTP\.get/)).toBeInTheDocument();
  });

  it('appends after the generated tabs in append mode, and the generated cURL is still there', () => {
    mount(data(samples, { samplesMode: 'append' }));
    expect(tabs()).toEqual([
      'cURL',
      'JavaScript',
      'Python',
      'Go',
      'cURL (from the spec)',
      'Ruby',
    ]);
    expect(screen.getByText(/--request GET/)).toBeInTheDocument();
  });

  it('ignores the spec in generated-only mode', () => {
    mount(data(samples, { samplesMode: 'generated-only' }));
    expect(tabs()).toEqual(['cURL', 'JavaScript', 'Python', 'Go']);
  });

  it('shows a language the highlighter does not know as plain text, without breaking the page', async () => {
    mount(
      data([{ lang: 'Brainfuck', label: 'Brainfuck', source: '++[>+<-]' }]),
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Brainfuck' }));
    expect(screen.getByText('++[>+<-]')).toBeInTheDocument();
  });

  it('shows the spec sample as written, not as the request being built', async () => {
    mount(
      data([
        { lang: 'Python', label: 'Python', source: 'print("exactly this")' },
      ]),
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Python' }));
    expect(screen.getByRole('tabpanel').textContent).toContain(
      'print("exactly this")',
    );
    expect(screen.getByRole('tabpanel').textContent).not.toContain('requests');
  });
});
