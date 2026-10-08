import type { ApiOperationData, ApiSchema } from '@dockudos/core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiOperation } from './context.tsx';
import { ApiPlayground } from './playground.tsx';
import { Prose } from './prose.tsx';
import { ApiParameters, ApiRequestBody, ApiResponses } from './sections.tsx';
import { SchemaTree } from './schema.tsx';
import { CORS_HINT, formatBody, sendRequest } from './send.ts';

const SCHEMAS: Record<string, ApiSchema> = {
  Node: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'integer', description: 'The id', minimum: 1 },
      parent: { ref: 'Node' },
      owner: { ref: 'Owner' },
      kind: { type: 'string', enum: ['a', 'b'] },
    },
  },
  Owner: { type: 'object', properties: { name: { type: 'string' } } },
  Base: { type: 'object', properties: { base: { type: 'string' } } },
};

const files = new Map<string, number>();
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  files.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const name = /\/([^/]+)\.json$/.exec(url)?.[1];
      files.set(url, (files.get(url) ?? 0) + 1);
      const key = name?.replace(/~(.)/g, (_, c: string) => c.toUpperCase());
      const schema = key ? SCHEMAS[key] : undefined;
      return schema ? new Response(JSON.stringify(schema)) : new Response('no', { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const data = (overrides: Partial<ApiOperationData['operation']> = {}, rest: Partial<ApiOperationData> = {}): ApiOperationData => ({
  operation: {
    id: 'get-node',
    method: 'get',
    path: '/nodes/{id}',
    tags: [],
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 }, description: 'Which node' },
      { name: 'expand', in: 'query', required: false, schema: { type: 'string', enum: ['owner', 'parent'] } },
    ],
    responses: [
      { status: '200', description: 'The node', headers: [], content: { 'application/json': { schema: { ref: 'Node', ...SCHEMAS.Node }, examples: { example: { value: { id: 1 } } } } } },
      { status: '404', description: 'Not here', headers: [], content: {} },
    ],
    security: [{ key: [] }],
    ...overrides,
  },
  servers: [{ url: 'https://api.test/v1' }],
  securitySchemes: { key: { type: 'apiKey', in: 'header', name: 'X-Key' } },
  ...rest,
});

const page = (d: ApiOperationData, children: React.ReactNode) =>
  render(
    <ApiOperation data={d} schemasUrl="/schemas">
      {children}
    </ApiOperation>,
  );

describe('Prose', () => {
  it('shows text from a spec as text: formatting works, markup does not', () => {
    const { container } = render(
      <Prose text={'Hello **bold** and `code` and [a link](https://x.test) and [bad](javascript:alert(1)).\n\n- one\n- two\n\n<img src=x onerror=alert(1)> <script>x</script>'} />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('code')?.textContent).toBe('code');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://x.test');
    expect(container.querySelector('img, script')).toBeNull();
    expect(container.textContent).toContain('<script>x</script>');
  });
});

describe('ApiParameters', () => {
  it('lists parameters by location with type, required and description', () => {
    page(data(), <ApiParameters />);
    const path = screen.getByRole('region', { name: 'path parameters' });
    expect(within(path).getByText('id')).toBeInTheDocument();
    expect(within(path).getByText('required')).toBeInTheDocument();
    expect(within(path).getByText('Which node')).toBeInTheDocument();
    const query = screen.getByRole('region', { name: 'query parameters' });
    expect(within(query).getByText('owner')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'header parameters' })).toBeNull();
  });
});

describe('ApiResponses and ApiRequestBody', () => {
  it('has a tab for each status and shows the selected one', async () => {
    page(data(), <ApiResponses />);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['200', '404']);
    expect(screen.getByText('The node')).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: '404' }));
    expect(screen.getByText('Not here')).toBeVisible();
    expect(screen.getByText('No body.')).toBeVisible();
  });

  it('shows the request body schema and example', () => {
    page(
      data({ requestBody: { required: true, description: 'The node to add', content: { 'application/json': { schema: SCHEMAS.Owner as ApiSchema, examples: { example: { value: { name: 'Zed' } } } } } } }),
      <ApiRequestBody />,
    );
    expect(screen.getByText('The node to add')).toBeInTheDocument();
    expect(screen.getByText(/"name": "Zed"/)).toBeInTheDocument();
    expect(screen.getByText('name')).toBeInTheDocument();
  });
});

describe('SchemaTree', () => {
  const tree = (schema: ApiSchema) =>
    page(data(), <SchemaTree schema={schema} />);

  it('opens and closes a field, and loads a referenced schema once, when it is opened', async () => {
    tree({ ref: 'Node', ...SCHEMAS.Node });
    expect(screen.getByText('The id')).toBeInTheDocument();
    expect(files.size).toBe(0);
    const owner = screen.getByRole('button', { name: 'owner' });
    expect(owner).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(owner);
    await waitFor(() => expect(screen.getByText('name')).toBeInTheDocument());
    expect(owner).toHaveAttribute('aria-expanded', 'true');
    expect([...files.keys()]).toEqual(['/schemas/~owner.json']);
    await userEvent.click(owner);
    expect(screen.queryByText('name')).toBeNull();
    await userEvent.click(owner);
    expect(files.get('/schemas/~owner.json')).toBe(1);
  });

  it('stops at a circular reference instead of following it', async () => {
    tree({ ref: 'Node', ...SCHEMAS.Node });
    expect(screen.getByText('recursive')).toBeInTheDocument();
    // `parent` is a Node inside a Node: nothing to open
    expect(screen.queryByRole('button', { name: 'parent' })).toBeNull();
  });

  it('shows constraints, enums and required', () => {
    tree({ ref: 'Node', ...SCHEMAS.Node });
    expect(screen.getByText('min 1')).toBeInTheDocument();
    expect(screen.getByText('required')).toBeInTheDocument();
    expect(screen.getByText('a')).toBeInTheDocument();
  });

  it('merges allOf parts, loading the ones that are not in the page', async () => {
    tree({ allOf: [{ ref: 'Base' }, { type: 'object', properties: { extra: { type: 'number' } } }] });
    await waitFor(() => expect(screen.getByText('base')).toBeInTheDocument());
    expect(screen.getByText('extra')).toBeInTheDocument();
  });

  it('lets the reader choose between oneOf variants', async () => {
    tree({ oneOf: [{ type: 'object', title: 'Cat', properties: { lives: { type: 'integer' } } }, { type: 'object', title: 'Dog', properties: { bark: { type: 'boolean' } } }], discriminator: { propertyName: 'kind' } });
    expect(screen.getByText('lives')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dog' }));
    expect(screen.getByText('bark')).toBeInTheDocument();
    expect(screen.queryByText('lives')).toBeNull();
  });

  it('says so when a schema cannot be loaded', async () => {
    tree({ type: 'object', properties: { x: { ref: 'Missing' } } });
    await userEvent.click(screen.getByRole('button', { name: 'x' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not load this schema'));
  });
});

describe('ApiPlayground', () => {
  it('validates before sending and names the problem on the field', async () => {
    const d = data();
    page(d, <ApiPlayground />);
    const send = screen.getByRole('button', { name: 'Send request' });
    await userEvent.click(send);
    expect(screen.getAllByRole('alert').some((a) => a.textContent === 'Required')).toBe(true);
    const id = screen.getByLabelText(/^id/);
    await userEvent.type(id, '0');
    expect(screen.getAllByRole('alert').some((a) => a.textContent === 'Must be at least 1')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows code in the chosen language, with what has been typed', async () => {
    page(data(), <ApiPlayground />);
    await userEvent.type(screen.getByLabelText(/^id/), '42');
    await waitFor(() => expect(document.body).toHaveTextContent("--url 'https://api.test/v1/nodes/42'"));
    await userEvent.click(screen.getByRole('tab', { name: 'Go' }));
    await waitFor(() => expect(document.body).toHaveTextContent('http.NewRequest("GET", "https://api.test/v1/nodes/42"'));
  });

  it('keeps credentials in this tab only, and shares them between endpoints', async () => {
    const view = page(data(), <ApiPlayground />);
    await userEvent.type(screen.getByLabelText(/API key/), 'top-secret');
    expect(JSON.parse(sessionStorage.getItem('dockudos-api-auth') ?? '{}')).toEqual({ key: { value: 'top-secret' } });
    expect(JSON.stringify({ ...localStorage })).not.toContain('top-secret');
    view.unmount();
    page(data({ id: 'other' }), <ApiPlayground />);
    expect(screen.getByLabelText(/API key/)).toHaveValue('top-secret');
  });

  it('sends the request and shows the answer', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => new Response('{"id":42}', { status: 200, headers: { 'content-type': 'application/json', 'x-a': 'b' } }));
    page(data(), <ApiPlayground />);
    await userEvent.type(screen.getByLabelText(/^id/), '42');
    // credentials are shared by the whole tab, so an earlier test's value may be there
    await userEvent.clear(screen.getByLabelText(/API key/));
    await userEvent.type(screen.getByLabelText(/API key/), 'k1');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    const response = await screen.findByRole('region', { name: 'Response' });
    expect(response).toHaveTextContent('200');
    expect(within(response).getByTestId('api-response-body')).toHaveTextContent('"id": 42');
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/nodes/42');
    expect(init.credentials).toBe('omit');
    expect(init.headers).toEqual([['X-Key', 'k1']]);
  });

  const withBody = () =>
    data(
      {
        method: 'post',
        path: '/nodes',
        parameters: [],
        security: [],
        requestBody: { required: true, content: { 'application/json': { examples: { example: { value: { name: 'a' } } } } } },
      },
      { securitySchemes: {} },
    );

  it('edits a JSON body in the editor and sends what is in it', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }));
    page(withBody(), <ApiPlayground />);
    const body = await screen.findByRole('textbox', { name: /Body/ });
    await waitFor(() => expect(body.closest('.dk-cm')?.querySelector('.cm-content')).not.toBeNull());
    expect(screen.getByRole('tab', { name: /Body/ })).toHaveAttribute('aria-selected', 'true');
    // the example is there; Beautify indents what was typed on one line
    const editor = document.querySelector('.dk-api-pane .cm-content') as HTMLElement;
    expect(editor).toHaveTextContent('"name": "a"');
    await userEvent.click(screen.getByRole('button', { name: /Beautify/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('region', { name: 'Response' });
    const init = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ name: 'a' });
  });

  it('opens the tab with the problem when sending fails validation, and marks it', async () => {
    const d = data({}, {});
    d.operation.parameters = [
      ...d.operation.parameters,
      { name: 'X-Trace', in: 'header', required: true, schema: { type: 'string' } },
    ];
    d.operation.security = [];
    page(d, <ApiPlayground />);
    expect(screen.getByRole('tab', { name: /Params/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.type(screen.getByLabelText(/^id/), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    const headers = screen.getByRole('tab', { name: /Headers/ });
    expect(headers).toHaveAttribute('aria-selected', 'true');
    expect(headers).toHaveAttribute('data-bad');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('moves between the request tabs with the arrow keys', async () => {
    page(data(), <ApiPlayground />);
    const [first] = screen.getAllByRole('tab', { name: /Params/ });
    first?.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Authorization/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Authorization/ })).toHaveFocus();
  });

  it('shows the response headers on their own tab', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => new Response('hi', { headers: { 'x-a': 'b' } }));
    page(data(), <ApiPlayground />);
    await userEvent.type(screen.getByLabelText(/^id/), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    const response = await screen.findByRole('region', { name: 'Response' });
    expect(within(response).getByText('x-a')).not.toBeVisible();
    await userEvent.click(within(response).getByRole('tab', { name: /Headers \(/ }));
    expect(within(response).getByText('x-a')).toBeVisible();
  });

  it('only shows samples when the playground is off', () => {
    page(data({}, { noPlayground: true }), <ApiPlayground />);
    expect(screen.getByRole('tab', { name: 'cURL' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send request' })).toBeNull();
  });
});

describe('sendRequest', () => {
  const req = { method: 'GET', url: 'https://api.test/x', headers: [['Cookie', 'a=b'], ['X-Key', 'k']] as [string, string][] };

  it('drops headers a browser cannot set and never sends cookies along', async () => {
    const f = vi.fn(async () => new Response('hi'));
    await sendRequest(req, { fetch: f as unknown as typeof fetch });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual([['X-Key', 'k']]);
    expect(init.credentials).toBe('omit');
  });

  it('explains a request the browser blocked', async () => {
    const f = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await sendRequest(req, { fetch: f as unknown as typeof fetch })).toEqual({ ok: false, message: 'The request could not be sent.', hint: CORS_HINT });
    expect(CORS_HINT).toContain('CORS');
    expect(CORS_HINT).toContain('playground.proxy');
  });

  it('goes through the proxy route when asked and reads its answer', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ status: 202, statusText: 'Accepted', headers: [['content-type', 'text/plain']], body: 'ok', encoding: 'utf8' })));
    const out = await sendRequest({ ...req, method: 'POST', body: { contentType: 'text/plain', text: 'x' } }, { fetch: f as unknown as typeof fetch, proxy: '/api/playground' });
    expect(out.ok && out.response.status).toBe(202);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/playground');
    expect(JSON.parse(init.body as string)).toMatchObject({ method: 'POST', url: 'https://api.test/x', body: 'x' });
    expect((init.headers as Record<string, string>)['x-dockudos-playground']).toBe('1');
    const failed = await sendRequest(req, { proxy: '/p', fetch: (async () => new Response('{"error":"nope"}', { status: 403 })) as unknown as typeof fetch });
    expect(failed).toEqual({ ok: false, message: 'nope' });
  });

  it('formats JSON and leaves other text alone', () => {
    expect(formatBody('{"a":1}', 'application/json')).toBe('{\n  "a": 1\n}');
    expect(formatBody('{bad', 'application/json')).toBe('{bad');
    expect(formatBody('plain', 'text/plain')).toBe('plain');
  });
});
