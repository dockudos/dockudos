import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { ApiOperationData } from '@dockudos/core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** An endpoint page with the playground on it, and a fresh client store behind it. */
const mount = async (over: Partial<ApiOperationData> = {}) => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  const { ApiOperation } = await import('./context.tsx');
  const { ApiPlayground } = await import('./playground.tsx');
  const store = await import('./client-store.ts');
  const env = await import('./client-env.ts');
  const data: ApiOperationData = {
    operation: {
      id: 'getPetById',
      method: 'get',
      path: '/pet/{petId}',
      summary: 'Find pet by ID',
      tags: [],
      parameters: [
        { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: [],
      security: [{ api_key: [] }],
    },
    servers: [{ url: 'https://api.test' }],
    securitySchemes: {
      api_key: { type: 'apiKey', in: 'header', name: 'api_key' },
    },
    ...over,
  };
  const view = render(
    <ApiOperation data={data} schemasUrl="/s">
      <ApiPlayground />
    </ApiOperation>,
  );
  return { ...view, store, env };
};

const fill = async (field: HTMLElement, text: string) => {
  await userEvent.click(field);
  await userEvent.paste(text);
};

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('environments on an endpoint page', () => {
  it('shows no picker until there is an environment to pick', async () => {
    await mount();
    expect(screen.queryByLabelText('Environment')).not.toBeInTheDocument();
  });

  it('fills a variable into the address it sends to, and leaves a secret out of the sample', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const { env } = await mount();
    env.writeEnvironments({
      activeId: 'e1',
      environments: [
        {
          id: 'e1',
          name: 'Sandbox',
          order: 1,
          variables: [
            { name: 'base', value: 'https://sandbox.test' },
            { name: 'key', value: 'sk-live-1', secret: true },
          ],
          v: 1,
        },
      ],
    });
    await waitFor(() => expect(screen.getByLabelText('Environment')).toBeInTheDocument());
    await userEvent.clear(screen.getByLabelText('Base URL'));
    await fill(screen.getByLabelText('Base URL'), '{{base}}');
    await userEvent.type(screen.getByLabelText(/petId/), '10');

    // The cURL sample shows the resolved address, and `{{key}}` where the secret would be.
    await userEvent.click(screen.getByRole('tab', { name: 'Authorization' }));
    await fill(screen.getByLabelText(/api_key/), '{{key}}');
    const samples = document.querySelector('.dk-api-samples') as HTMLElement;
    await waitFor(() => expect(samples).toHaveTextContent('https://sandbox.test/pet/10'));
    expect(samples).toHaveTextContent('{{key}}');
    expect(samples).not.toHaveTextContent('sk-live-1');

    // What is sent has the secret in it, and goes only to the API.
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch.mock.calls[0]?.[0]).toBe('https://sandbox.test/pet/10');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: [['api_key', 'sk-live-1']],
    });
  });

  it('refuses to send to an address with a variable that has no value', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { env } = await mount();
    env.writeEnvironments({
      environments: [{ id: 'e1', name: 'Sandbox', order: 1, variables: [], v: 1 }],
    });
    await waitFor(() => expect(screen.getByLabelText('Environment')).toBeInTheDocument());
    await userEvent.clear(screen.getByLabelText('Base URL'));
    await fill(screen.getByLabelText('Base URL'), 'https://api.test/{{stage}}');
    await userEvent.type(screen.getByLabelText(/petId/), '10');
    expect(screen.getByRole('alert')).toHaveTextContent('No value for {{stage}}');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('picks the environment the whole site then uses', async () => {
    const { env } = await mount();
    env.writeEnvironments({
      environments: [
        { id: 'e1', name: 'Sandbox', order: 1, variables: [], v: 1 },
        { id: 'e2', name: 'Live', order: 2, variables: [], v: 1 },
      ],
    });
    const picker = await screen.findByLabelText('Environment');
    await userEvent.selectOptions(picker, 'e2');
    expect(env.readEnvironments().activeId).toBe('e2');
    await userEvent.selectOptions(picker, '');
    expect(env.readEnvironments().activeId).toBeUndefined();
  });
});

describe('saving a request from an endpoint page', () => {
  it('opens the client with the request in it, and keeps no credential', async () => {
    const { store } = await mount();
    await userEvent.type(screen.getByLabelText(/petId/), '10');
    await userEvent.click(screen.getByRole('tab', { name: 'Authorization' }));
    await userEvent.type(screen.getByLabelText(/api_key/), 'sk-live-1');

    await userEvent.click(screen.getByRole('button', { name: 'Save request' }));
    const panel = await screen.findByRole('dialog', { name: 'API client' });
    expect(within(panel).getByLabelText('Address')).toHaveValue('https://api.test/pet/10');
    expect(within(panel).getByLabelText('Name')).toHaveValue('Find pet by ID');

    await userEvent.click(within(panel).getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(store.clientSnapshot().requests).toHaveLength(1));
    const saved = store.clientSnapshot().requests[0];
    expect(saved?.request.headers).toEqual([['api_key', '']]);
    expect(saved?.redacted).toEqual(['api_key']);
    expect(saved?.origin).toMatchObject({ operationId: 'getPetById', base: 'https://api.test' });
    expect(JSON.stringify(store.clientSnapshot())).not.toContain('sk-live-1');
    // The playground, the lazily loaded client and the store, all in one test.
  }, 20_000);

  it('opens the saved requests and closes them again', async () => {
    await mount();
    await userEvent.click(screen.getByRole('button', { name: 'Saved requests' }));
    const panel = await screen.findByRole('dialog', { name: 'API client' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('the history of an endpoint page', () => {
  it('notes a send with placeholders where a credential was', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    const { store } = await mount();
    await userEvent.type(screen.getByLabelText(/petId/), '10');
    await userEvent.click(screen.getByRole('tab', { name: 'Authorization' }));
    await userEvent.type(screen.getByLabelText(/api_key/), 'sk-live-1');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() => expect(store.clientSnapshot().history).toHaveLength(1));
    expect(store.clientSnapshot().history[0]).toMatchObject({
      method: 'GET',
      url: 'https://api.test/pet/10',
      status: 200,
    });
    expect(JSON.stringify(store.clientSnapshot().history)).not.toContain('sk-live-1');
  });

  it('notes a send that failed, with the reason', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { store } = await mount();
    await userEvent.type(screen.getByLabelText(/petId/), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(store.clientSnapshot().history).toHaveLength(1));
    expect(store.clientSnapshot().history[0]?.error).toMatch(/could not be sent/);
  });
});
