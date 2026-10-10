import type { ApiOperationData, ApiSecurityScheme } from '@dockudos/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiOperation } from './context.tsx';
import { ApiPlayground } from './playground.tsx';

const fetchMock = vi.fn();
beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response('ok'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const data = (
  op: Partial<ApiOperationData['operation']> = {},
  rest: Partial<ApiOperationData> = {},
): ApiOperationData => ({
  operation: {
    id: 'op',
    method: 'post',
    path: '/things',
    tags: [],
    parameters: [],
    responses: [],
    security: [],
    ...op,
  },
  servers: [{ url: 'https://api.test' }],
  securitySchemes: {},
  ...rest,
});

const mount = (d: ApiOperationData, proxy = false) =>
  render(
    <ApiOperation data={d} schemasUrl="/s" proxy={proxy}>
      <ApiPlayground />
    </ApiOperation>,
  );

const body = (content: Record<string, object>, required = false) => ({
  requestBody: { required, content: content as never },
});

const send = () => userEvent.click(screen.getByRole('button', { name: 'Send request' }));
const sentInit = () => fetchMock.mock.calls[0]?.[1] as RequestInit;

describe('ApiPlayground servers', () => {
  const servers = [
    {
      url: 'https://{region}.api.test/{plain}',
      description: 'Main',
      variables: {
        region: { default: 'eu', enum: ['eu', 'us'] },
        plain: { default: 'v1' },
      },
    },
    { url: 'https://other.test' },
  ];

  it('switches server and edits server variables', async () => {
    mount(data({}, { servers }));
    const base = screen.getByLabelText('Base URL');
    expect(base).toHaveValue('https://eu.api.test/v1');
    expect(screen.getByRole('option', { name: 'Main (https://{region}.api.test/{plain})' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'https://other.test' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByDisplayValue('eu'), 'us');
    expect(base).toHaveValue('https://us.api.test/v1');
    const plain = screen.getByDisplayValue('v1');
    await userEvent.clear(plain);
    await userEvent.type(plain, 'v2');
    expect(base).toHaveValue('https://us.api.test/v2');

    await userEvent.selectOptions(screen.getByLabelText('Server'), '1');
    expect(base).toHaveValue('https://other.test');
    expect(screen.queryByDisplayValue('us')).toBeNull();
  });

  it('asks for a usable address before sending', async () => {
    mount(data());
    const base = screen.getByLabelText('Base URL');
    await userEvent.clear(base);
    await send();
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toContain('Give the address of the API');
    expect(base).toHaveAttribute('aria-invalid', 'true');
    await userEvent.type(base, 'api.test');
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toContain('Must start with http:// or https://');
    expect(screen.getByText('Fix the 1 highlighted field first.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('has no server picker and an empty address when the spec lists no servers', () => {
    mount(data({}, { servers: [] }));
    expect(screen.getByLabelText('Base URL')).toHaveValue('');
    expect(screen.queryByLabelText('Server')).toBeNull();
  });
});

describe('ApiPlayground authorization', () => {
  const schemes: Record<string, ApiSecurityScheme> = {
    basic: { type: 'http', scheme: 'basic' },
    bearer: { type: 'http', scheme: 'bearer' },
    digest: { type: 'http', scheme: 'digest' },
    oauth: { type: 'oauth2', flows: {} },
    key: { type: 'apiKey', in: 'query', name: 'k' },
  };

  it('has fields for each kind of credential, and marks the alternatives', async () => {
    mount(
      data(
        { security: [{ basic: [] }, { bearer: [] }, { digest: [] }, { oauth: [] }, { key: [] }, { missing: [] }] },
        { securitySchemes: schemes },
      ),
      true,
    );
    expect(screen.getByRole('tab', { name: /Authorization/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/through this site, because the proxy is on/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('basic: username'), 'me');
    await userEvent.type(screen.getByLabelText('basic: password'), 'pw');
    expect(screen.getByLabelText('bearer (alternative): bearer token')).toBeInTheDocument();
    expect(screen.getByLabelText('digest (alternative): digest credentials')).toBeInTheDocument();
    expect(screen.getByLabelText('oauth (alternative): access token')).toBeInTheDocument();
    expect(screen.getByLabelText('key (alternative): API key (query k)')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'has content' })).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem('dockudos-api-auth') ?? '{}').basic).toEqual({
      username: 'me',
      password: 'pw',
    });
  });
});

describe('ApiPlayground parameters', () => {
  const op = {
    method: 'get' as const,
    parameters: [
      { name: 'flag', in: 'query' as const, required: true, schema: { type: 'boolean' as const } },
      { name: 'size', in: 'query' as const, required: false, schema: { type: 'string' as const, enum: ['s', 'm'] } },
      { name: 'tags', in: 'query' as const, required: false, schema: { type: 'array' as const } },
      { name: 'when', in: 'query' as const, required: false, schema: { type: 'string' as const, format: 'date' } },
      { name: 'Cookie', in: 'header' as const, required: false },
      { name: 'User-Agent', in: 'header' as const, required: false },
      { name: 'X-Mode', in: 'header' as const, required: true, schema: { type: 'string' as const, enum: ['a'] } },
    ],
  };

  it('uses selects for choices, placeholders for the rest, and warns about headers a browser drops', async () => {
    mount(data(op));
    expect(screen.getByRole('option', { name: 'Choose…' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '(not set)' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('a,b,c')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('date')).toBeInTheDocument();
    await send();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(1);
    expect(screen.getByRole('tab', { name: /Params/ })).toHaveAttribute('data-bad');
    await userEvent.selectOptions(screen.getByLabelText(/^flag/), 'true');
    await userEvent.selectOptions(screen.getByLabelText(/^size/), 's');

    await userEvent.click(screen.getByRole('tab', { name: /Headers/ }));
    await userEvent.type(screen.getByLabelText('Cookie'), 'a=b');
    await userEvent.type(screen.getByLabelText('User-Agent'), 'x');
    expect(screen.getByText(/they are left out of the request/)).toBeInTheDocument();
    expect(screen.getByText(/The code sample above has them/)).toBeInTheDocument();
  });

  it('says it for a single dropped header', async () => {
    mount(
      data({
        method: 'get',
        parameters: [{ name: 'Cookie', in: 'header', required: false }],
      }),
    );
    await userEvent.type(screen.getByLabelText('Cookie'), 'a=b');
    expect(screen.getByText(/it is left out of the request/)).toBeInTheDocument();
  });
});

describe('ApiPlayground body', () => {
  it('has no body tab when the operation takes no body', () => {
    mount(data());
    expect(screen.queryByRole('tab', { name: /Body/ })).toBeNull();
  });

  it('switches content type to a form body built from an example, and to plain text', async () => {
    mount(
      data(
        body({
          'application/json': { examples: {} },
          'application/x-www-form-urlencoded': { examples: { e: { value: { a: 'x', b: [1] } } } },
          'text/plain': { examples: { e: { value: 'hello' } } },
        }),
      ),
    );
    const type = screen.getByLabelText('Content type');
    expect(type).toHaveValue('application/json');
    await userEvent.selectOptions(type, 'application/x-www-form-urlencoded');
    await waitFor(() => expect(document.body).toHaveTextContent('a=x&b=%5B1%5D'));
    expect(screen.queryByRole('button', { name: /Beautify/ })).toBeNull();
    await userEvent.selectOptions(type, 'text/plain');
    await waitFor(() => expect(document.body).toHaveTextContent('hello'));
    await send();
    expect(sentInit().body).toBe('hello');
  });

  it('falls back to the first content type and says so when it cannot be sent', () => {
    mount(data(body({ 'image/png': { examples: {} } })));
    expect(screen.getByText(/cannot send/)).toHaveTextContent('image/png');
    expect(screen.getByText('image/png', { selector: 'code' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Body/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('requires a body, rejects bad JSON, and leaves bad JSON alone when beautifying', async () => {
    mount(data(body({ 'application/json': { examples: {} } }, true)));
    await send();
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toContain('Required');
    const editor = await screen.findByRole('textbox', { name: /Body/ });
    await userEvent.type(editor, '{{oops');
    const beautify = screen.getByRole('button', { name: /Beautify/ });
    expect(beautify).toBeEnabled();
    await userEvent.click(beautify);
    await waitFor(() =>
      expect(screen.getAllByRole('alert').some((a) => /Not valid JSON/.test(a.textContent ?? ''))).toBe(true),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends when Ctrl+Enter is pressed in the editor', async () => {
    mount(data(body({ 'application/json': { examples: { e: { value: { a: 1 } } } } })));
    const sel = '.dk-api-pane .cm-content';
    await waitFor(() => expect(document.querySelector(sel)).not.toBeNull());
    const content = document.querySelector(sel) as HTMLElement;
    fireEvent.keyDown(content, { key: 'Enter', code: 'Enter', ctrlKey: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(sentInit().body as string)).toEqual({ a: 1 });
  });
});

describe('ApiPlayground sending', () => {
  it('can be cancelled while waiting, and sends again afterwards', async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('x')))),
    );
    mount(data());
    await send();
    expect(await screen.findByText('Waiting for the API…')).toBeInTheDocument();
    // submitting while busy does nothing
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(screen.queryByText('Waiting for the API…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument();
    await send();
    expect(await screen.findByRole('region', { name: 'Response' })).toBeInTheDocument();
  });

  it('aborts the request when the page goes away', async () => {
    let signal: AbortSignal | null | undefined;
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      signal = init.signal;
      return new Promise(() => undefined);
    });
    const view = mount(data());
    await send();
    await waitFor(() => expect(signal).toBeDefined());
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('shows why a request failed, with the hint', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mount(data());
    await send();
    const failure = await screen.findByText('The request could not be sent.');
    expect(failure.closest('[role="alert"]')).toHaveTextContent(/CORS/i);
  });

  it('goes through the proxy and shows redirects, errors and binary answers', async () => {
    const proxied = (payload: object) => async () => new Response(JSON.stringify(payload));
    fetchMock.mockImplementationOnce(proxied({ status: 302, statusText: 'Found', headers: [['content-type', 'text/html']], body: '<a/>' }));
    mount(data(), true);
    await send();
    const region = await screen.findByRole('region', { name: 'Response' });
    expect(region.querySelector('[data-tone="redirect"]')).toHaveTextContent('302 Found');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/playground');

    fetchMock.mockImplementationOnce(proxied({ status: 500, statusText: 'Boom', body: 'e' }));
    await send();
    await waitFor(() => expect(document.querySelector('[data-tone="error"]')).not.toBeNull());

    fetchMock.mockImplementationOnce(proxied({ status: 200, statusText: 'OK', encoding: 'base64', body: btoa('x'.repeat(2048)) }));
    await send();
    expect(await screen.findByText(/The body is binary \(2\.0 kB\)/)).toBeInTheDocument();

    fetchMock.mockImplementationOnce(
      proxied({ status: 200, statusText: 'OK', encoding: 'base64', body: btoa('x'.repeat(2 * 1024 * 1024)) }),
    );
    await send();
    expect(await screen.findByText(/The body is binary \(2\.0 MB\)/)).toBeInTheDocument();
  });

  it('says when the body is longer than what is shown', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('a'.repeat(600_000)));
    mount(data());
    await send();
    expect(await screen.findByText(/longer than what is shown/)).toBeInTheDocument();
    expect(screen.getByText(/\d+\.\d kB|\d+\.\d MB/)).toBeInTheDocument();
  });
});

describe('ApiPlayground tabs', () => {
  it('moves with Home, End and the arrows, wrapping round', async () => {
    mount(
      data(
        {
          parameters: [
            { name: 'a', in: 'query', required: true },
            { name: 'H', in: 'header', required: false },
          ],
          security: [{ key: [] }],
          ...body({ 'application/json': { examples: {} } }),
        },
        { securitySchemes: { key: { type: 'apiKey', in: 'header', name: 'K' } } },
      ),
    );
    const tab = (n: RegExp) => screen.getByRole('tab', { name: n });
    tab(/Params/).focus();
    await userEvent.keyboard('{End}');
    expect(tab(/Body/)).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(tab(/Params/)).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(tab(/Body/)).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Home}');
    expect(tab(/Params/)).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{a}');
    expect(tab(/Params/)).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('tablist', { name: 'Request' })).getAllByRole('tab')).toHaveLength(4);
  });

  it('has no request panel when there is nothing to fill in', () => {
    mount(data({ method: 'get' }));
    expect(screen.queryByRole('tablist', { name: 'Request' })).toBeNull();
  });
});

describe('ApiPlayground.toMarkdown', () => {
  it('writes nothing', () => {
    expect((ApiPlayground as unknown as { toMarkdown: () => string }).toMarkdown()).toBe('');
  });
});
