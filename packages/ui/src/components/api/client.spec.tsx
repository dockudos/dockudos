import 'fake-indexeddb/auto';
import { decodeSharedRequest, encodeSharedRequest } from '@dockudos/core';
import { IDBFactory } from 'fake-indexeddb';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ClientPrefill } from './client.tsx';

/** A fresh store and a fresh client, as a first visit would have them. */
const mount = async (props: Record<string, unknown> = {}) => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  const { ApiClient } = await import('./client.tsx');
  const store = await import('./client-store.ts');
  const view = render(<ApiClient {...props} />);
  await waitFor(() => expect(store.clientSnapshot().loaded).toBe(true));
  return { ...view, store };
};

const prefill = (over: Partial<ClientPrefill> = {}): ClientPrefill => ({
  name: 'Find pet by ID',
  request: {
    method: 'GET',
    url: 'https://api.test/pet/10',
    headers: [['Accept', 'application/json']],
  },
  ...over,
});

/** Put text in a field as it is written: userEvent.type() treats `{` as a key name. */
const fill = async (field: HTMLElement, text: string) => {
  await userEvent.click(field);
  await userEvent.paste(text);
};

/** The notice the client shows, which is not the copy button's own live region. */
const note = () => screen.getByTestId('api-client-note');

/** The tabs of the request editor, which the response has a set of its own. */
const requestTab = (name: RegExp | string) =>
  within(screen.getByRole('tablist', { name: 'Request' })).getByRole('tab', { name });

const answer = (body: string, status = 200) =>
  vi.fn().mockResolvedValue(
    new Response(body, { status, headers: { 'content-type': 'application/json' } }),
  );

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the client on a page', () => {
  it('starts empty and explains how to fill it', async () => {
    await mount();
    expect(screen.getByRole('heading', { name: 'API client' })).toBeInTheDocument();
    expect(screen.getByText(/Nothing saved yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('sends what was typed and shows the answer', async () => {
    const fetch = answer('{"name":"Rex"}');
    vi.stubGlobal('fetch', fetch);
    await mount();
    await userEvent.type(screen.getByLabelText('Address'), 'https://api.test/pet/10');
    await userEvent.selectOptions(screen.getByLabelText('Method'), 'POST');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Response' })).toBeInTheDocument(),
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://api.test/pet/10',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(screen.getByRole('region', { name: 'Response' })).toHaveTextContent('200');
  });

  it('saves a request, lists it, and opens it again with its inputs', async () => {
    const { store } = await mount({ prefill: prefill() });
    expect(screen.getByLabelText('Address')).toHaveValue('https://api.test/pet/10');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(store.clientSnapshot().requests).toHaveLength(1));
    expect(note()).toHaveTextContent('Saved “Find pet by ID”.');

    // It is in the tree, and pressing it fills the editor in again.
    const tree = screen.getByRole('tree', { name: 'Collections' });
    await userEvent.clear(screen.getByLabelText('Address'));
    await userEvent.click(within(tree).getByRole('treeitem', { name: /Find pet by ID/ }));
    expect(screen.getByLabelText('Address')).toHaveValue('https://api.test/pet/10');

    // Saving again updates the one that is open rather than adding another.
    await userEvent.click(screen.getByRole('button', { name: /^Update$/ }));
    expect(store.clientSnapshot().requests).toHaveLength(1);
  });

  it('says which credential it left out of a saved request', async () => {
    await mount({
      prefill: prefill({
        request: {
          method: 'GET',
          url: 'https://api.test/pet/10',
          headers: [['api_key', 'sk-live-1']],
        },
        secrets: ['sk-live-1'],
        authFields: ['api_key'],
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(note()).toHaveTextContent(/api_key was left out: a credential is never stored/);
  });

  it('asks for an address before saving', async () => {
    await mount();
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(note()).toHaveTextContent('Give the request an address first.');
  });

  it('moves and deletes what is saved', async () => {
    const { store } = await mount();
    const collection = store.addCollection('Petstore');
    store.saveRequest({ collectionId: collection.id, name: 'First', request: { method: 'GET', url: 'https://api.test/1', headers: [] } });
    store.saveRequest({ collectionId: collection.id, name: 'Second', request: { method: 'GET', url: 'https://api.test/2', headers: [] } });
    const tree = await screen.findByRole('tree', { name: 'Collections' });

    await userEvent.click(within(tree).getByRole('button', { name: 'Move Second up' }));
    expect(
      [...store.clientSnapshot().requests].sort((a, b) => a.order - b.order).map((r) => r.name),
    ).toEqual(['Second', 'First']);
    await userEvent.click(within(tree).getByRole('button', { name: 'Move Second down' }));
    expect(
      [...store.clientSnapshot().requests].sort((a, b) => a.order - b.order).map((r) => r.name),
    ).toEqual(['First', 'Second']);

    await userEvent.click(within(tree).getByRole('button', { name: 'Delete First' }));
    expect(store.clientSnapshot().requests.map((r) => r.name)).toEqual(['Second']);
    await userEvent.click(within(tree).getByRole('button', { name: 'Delete Petstore' }));
    expect(store.clientSnapshot().collections).toEqual([]);
  });

  it('takes a name, a collection and a content type from the reader, and deletes what is open', async () => {
    const { store } = await mount({ prefill: prefill() });
    const petstore = store.addCollection('Petstore');
    store.addCollection('Admin');

    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), 'My call');
    await userEvent.selectOptions(screen.getByLabelText('Collection'), petstore.id);
    await userEvent.click(requestTab(/Body/));
    await fill(screen.getByRole('textbox', { name: 'Request body' }), 'name=Rex');
    await userEvent.clear(screen.getByLabelText('Content type'));
    await userEvent.paste('application/x-www-form-urlencoded');

    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(store.clientSnapshot().requests).toHaveLength(1));
    expect(store.clientSnapshot().requests[0]).toMatchObject({
      name: 'My call',
      collectionId: petstore.id,
      request: {
        body: { contentType: 'application/x-www-form-urlencoded', text: 'name=Rex' },
      },
    });

    // The share link is selected when it is focused, ready to copy.
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    const link = screen.getByLabelText(/Link to this request/) as HTMLInputElement;
    link.focus();
    expect(link.selectionEnd).toBe(link.value.length);

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(store.clientSnapshot().requests).toEqual([]);
    expect(screen.getByLabelText('Address')).toHaveValue('');
    // Typing into the body editor is slow; the default five seconds is tight when the whole suite runs.
  }, 20_000);

  it('starts a new request after one was saved, instead of changing it', async () => {
    const { store } = await mount({ prefill: prefill() });
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(store.clientSnapshot().requests).toHaveLength(1));

    await userEvent.click(screen.getByRole('button', { name: 'New request' }));
    expect(screen.getByLabelText('Address')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'New request' })).not.toBeInTheDocument();

    await fill(screen.getByLabelText('Address'), 'https://api.test/pet/2');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(store.clientSnapshot().requests).toHaveLength(2));
  });

  it('closes a collection by pressing it, and adds one when there are some already', async () => {
    const { store } = await mount();
    store.addCollection('Petstore');
    store.saveRequest({ name: 'List pets', request: { method: 'GET', url: 'https://api.test/pets', headers: [] } });
    const tree = await screen.findByRole('tree', { name: 'Collections' });
    const collection = within(tree).getByRole('treeitem', { name: /^Petstore/ });
    await userEvent.click(collection);
    expect(collection).toHaveAttribute('aria-expanded', 'false');
    expect(within(tree).queryByRole('treeitem', { name: /List pets/ })).not.toBeInTheDocument();
    await userEvent.click(collection);
    expect(within(tree).getByRole('treeitem', { name: /List pets/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'New collection' }));
    await waitFor(() => expect(store.clientSnapshot().collections).toHaveLength(2));
  });

  it('renames a collection, and adds one', async () => {
    const { store } = await mount();
    await userEvent.click(screen.getByRole('button', { name: 'New collection' }));
    await waitFor(() => expect(store.clientSnapshot().collections).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: /^Rename / }));
    const field = screen.getByRole('textbox', { name: /Name of/ });
    await userEvent.clear(field);
    await userEvent.type(field, 'Petstore{Enter}');
    expect(store.clientSnapshot().collections[0]?.name).toBe('Petstore');

    // Escape leaves the name as it was.
    await userEvent.click(screen.getByRole('button', { name: /^Rename / }));
    await userEvent.type(screen.getByRole('textbox', { name: /Name of/ }), 'x{Escape}');
    expect(store.clientSnapshot().collections[0]?.name).toBe('Petstore');
  });
});

describe('moving around the saved requests with the keyboard', () => {
  it('walks the tree with the arrows, closes and opens a collection, and jumps to the ends', async () => {
    const { store } = await mount();
    const collection = store.addCollection('Petstore');
    store.saveRequest({ collectionId: collection.id, name: 'First', request: { method: 'GET', url: 'https://api.test/1', headers: [] } });
    store.saveRequest({ collectionId: collection.id, name: 'Second', request: { method: 'GET', url: 'https://api.test/2', headers: [] } });
    const tree = await screen.findByRole('tree', { name: 'Collections' });
    const row = (name: RegExp | string) => within(tree).getByRole('treeitem', { name });

    row(/^Petstore/).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(row(/First/)).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(row(/Second/)).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(row(/Second/)).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(row(/^Petstore/)).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(row(/Second/)).toHaveFocus();

    // Left closes the collection, right opens it again.
    await userEvent.keyboard('{Home}{ArrowLeft}');
    expect(row(/^Petstore/)).toHaveAttribute('aria-expanded', 'false');
    expect(within(tree).queryByRole('treeitem', { name: /First/ })).not.toBeInTheDocument();
    await userEvent.keyboard('{ArrowRight}');
    expect(row(/^Petstore/)).toHaveAttribute('aria-expanded', 'true');

    // A key the tree does not use is left alone.
    await userEvent.keyboard('{PageDown}');
    expect(row(/^Petstore/)).toHaveFocus();
  });
});

describe('environments', () => {
  it('adds one, takes variables, masks a secret, and uses them when sending', async () => {
    const fetch = answer('{}');
    vi.stubGlobal('fetch', fetch);
    const { store } = await mount();
    await userEvent.click(screen.getByRole('tab', { name: /Environments/ }));
    await userEvent.click(screen.getByRole('button', { name: 'New environment' }));
    await waitFor(() => expect(store.clientSnapshot().environments).toHaveLength(1));

    await userEvent.click(screen.getByRole('button', { name: 'Add a variable' }));
    await userEvent.type(screen.getByLabelText('Variable 1 name'), 'baseUrl');
    await userEvent.type(screen.getByLabelText(/Value of baseUrl/), 'https://api.test');
    await userEvent.click(screen.getByRole('button', { name: 'Add a variable' }));
    await userEvent.type(screen.getByLabelText('Variable 2 name'), 'token');
    await userEvent.type(screen.getByLabelText(/Value of token/), 'sk-live-1');
    await userEvent.click(screen.getByLabelText('token is secret'));

    // A secret is masked until the reader asks to see it.
    expect(screen.getByRole('button', { name: /sk-l.*— show/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /— show/ }));
    expect(screen.getByLabelText(/Value of token/)).toHaveValue('sk-live-1');

    await fill(screen.getByLabelText('Address'), '{{baseUrl}}/pets');
    expect(screen.getByText(/Sends to/)).toHaveTextContent('https://api.test/pets');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.test/pets');
  });

  it('says when a variable has no value, and refuses to send', async () => {
    const fetch = answer('{}');
    vi.stubGlobal('fetch', fetch);
    await mount();
    await fill(screen.getByLabelText('Address'), '{{baseUrl}}/pets');
    expect(screen.getByRole('alert')).toHaveTextContent('No value for {{baseUrl}}');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('names a variable that refers to itself', async () => {
    const { store } = await mount();
    const environment = store.addEnvironment('Sandbox');
    store.setVariables(environment.id, [{ name: 'loop', value: '{{loop}}' }]);
    await fill(screen.getByLabelText('Address'), 'https://api.test/{{loop}}');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('{{loop}} refers to itself'),
    );
  });

  it('renames an environment when the field is left, and keeps the old name for an empty one', async () => {
    const { store } = await mount();
    const environment = store.addEnvironment('Sandbox');
    const name = () =>
      store.clientSnapshot().environments.find((e) => e.id === environment.id)?.name;
    await userEvent.click(screen.getByRole('tab', { name: /Environments/ }));
    const field = screen.getByLabelText('Name of Sandbox');
    await userEvent.clear(field);
    await userEvent.type(field, 'Live{Enter}');
    expect(name()).toBe('Live');

    const renamed = screen.getByLabelText('Name of Live');
    await userEvent.clear(renamed);
    await userEvent.tab();
    expect(name()).toBe('Live');
  });

  it('picks which environment is used, removes a variable, and deletes the environment', async () => {
    const { store } = await mount();
    const first = store.addEnvironment('Sandbox');
    store.setVariables(first.id, [{ name: 'baseUrl', value: 'https://sandbox.test' }]);
    const second = store.addEnvironment('Live');
    await userEvent.selectOptions(await screen.findByLabelText('Environment'), first.id);
    expect(store.clientSnapshot().activeEnvironmentId).toBe(first.id);

    await userEvent.click(screen.getByRole('tab', { name: /Environments/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Use this one' }));
    expect(store.clientSnapshot().activeEnvironmentId).toBe(second.id);

    await userEvent.click(screen.getByRole('button', { name: 'Remove baseUrl' }));
    expect(store.clientSnapshot().environments.find((e) => e.id === first.id)?.variables).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Delete Sandbox' }));
    expect(store.clientSnapshot().environments.map((e) => e.name)).toEqual(['Live']);
  });

  it('remembers secret values only when the reader asks', async () => {
    const { store } = await mount();
    store.addEnvironment('Sandbox');
    await userEvent.click(screen.getByRole('tab', { name: /Environments/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Remember secret values/ }));
    expect(store.clientSnapshot().rememberSecrets).toBe(true);
  });
});

describe('the request editor', () => {
  it('takes headers and a body, and sends them', async () => {
    const fetch = answer('{}');
    vi.stubGlobal('fetch', fetch);
    await mount();
    await userEvent.type(screen.getByLabelText('Address'), 'https://api.test/pets');
    await userEvent.selectOptions(screen.getByLabelText('Method'), 'POST');
    await userEvent.click(screen.getByRole('button', { name: 'Add a header' }));
    await userEvent.type(screen.getByLabelText('Header 1 name'), 'X-Trace');
    await userEvent.type(screen.getByLabelText(/Value of X-Trace/), 'abc');

    await userEvent.click(requestTab(/Body/));
    await fill(screen.getByRole('textbox', { name: 'Request body' }), '{"name":"Rex"}');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const options = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(options.headers).toEqual([
      ['Content-Type', 'application/json'],
      ['X-Trace', 'abc'],
    ]);
    expect(options.body).toBe('{"name":"Rex"}');

    await userEvent.click(requestTab(/Headers/));
    await userEvent.click(screen.getByRole('button', { name: 'Remove X-Trace' }));
    expect(screen.queryByLabelText('Header 1 name')).not.toBeInTheDocument();
  });

  it('can be cancelled while it waits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    await mount();
    await userEvent.type(screen.getByLabelText('Address'), 'https://api.test/pets');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    await userEvent.click(cancel);
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('explains a request the browser would not send', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await mount();
    await userEvent.type(screen.getByLabelText('Address'), 'https://api.test/pets');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be sent');
  });
});

describe('what a reader can take away', () => {
  it('offers a link with no credential in it', async () => {
    await mount({ prefill: prefill() });
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    const link = screen.getByLabelText(/Link to this request/) as HTMLInputElement;
    expect(link.value).toContain('#request=');
    expect(decodeSharedRequest(link.value.split('#')[1] as string)?.request.url).toBe(
      'https://api.test/pet/10',
    );
  });

  it('refuses a link that would be too long to paste', async () => {
    await mount({
      prefill: prefill({
        request: {
          method: 'POST',
          url: 'https://api.test/pets',
          headers: [],
          body: { contentType: 'application/json', text: 'x'.repeat(9000) },
        },
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(note()).toHaveTextContent(/too long to put in a link/);
  });

  it('opens with the request a link carried', async () => {
    window.location.hash = '';
    const { text } = encodeSharedRequest(
      { method: 'DELETE', url: 'https://api.test/pet/7', headers: [] },
      'Remove a pet',
    );
    window.location.hash = `#request=${text}`;
    await mount();
    expect(screen.getByLabelText('Address')).toHaveValue('https://api.test/pet/7');
    expect(note()).toHaveTextContent('This request came from a link');
    window.location.hash = '';
  });

  it('follows a link that only changes the fragment of the page it is on', async () => {
    window.location.hash = '';
    await mount();
    const { text } = encodeSharedRequest(
      { method: 'PUT', url: 'https://api.test/pet/9', headers: [] },
      'Change a pet',
    );
    window.location.hash = `#request=${text}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() =>
      expect(screen.getByLabelText('Address')).toHaveValue('https://api.test/pet/9'),
    );
    expect(note()).toHaveTextContent('came from a link');

    // A damaged fragment leaves what is in the editor alone.
    window.location.hash = '#request=not-a-request';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(screen.getByLabelText('Address')).toHaveValue('https://api.test/pet/9');
    window.location.hash = '';
  });

  it('copies the request as a command or as code', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: write } });
    await mount({ prefill: prefill() });
    await userEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(write).toHaveBeenCalledWith(expect.stringContaining('curl --request GET'));
    await userEvent.selectOptions(screen.getByLabelText('Copy as'), 'python');
    await userEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(write).toHaveBeenLastCalledWith(expect.stringContaining('import requests'));
  });
});

describe('importing and exporting', () => {
  it('imports a pasted curl command and lists it', async () => {
    const { store } = await mount();
    await userEvent.click(screen.getByRole('button', { name: 'Import or export' }));
    await userEvent.type(
      screen.getByLabelText(/Or paste a curl command/),
      'curl -X DELETE https://api.test/pet/1',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(store.clientSnapshot().requests).toHaveLength(1));
    expect(store.clientSnapshot().requests[0]?.name).toBe('DELETE /pet/1');
  });

  it('says what it could not read, and names the variables an import still needs', async () => {
    await mount();
    await userEvent.click(screen.getByRole('button', { name: 'Import or export' }));
    const field = screen.getByLabelText(/Or paste a curl command/);
    await userEvent.type(field, 'hello');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByText(/was not recognised/)).toBeInTheDocument();

    await userEvent.clear(field);
    await userEvent.type(field, 'curl https://api.test/pet/1?key=x');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.queryByText(/was not recognised/)).not.toBeInTheDocument();
  });

  it('reads a collection from a file and asks for the variables it uses', async () => {
    const { store } = await mount();
    await userEvent.click(screen.getByRole('button', { name: 'Import or export' }));
    const file = new File(
      [
        JSON.stringify({
          info: { name: 'Petstore', schema: 'v2.1' },
          item: [{ name: 'List', request: { method: 'GET', url: '{{baseUrl}}/pets' } }],
        }),
      ],
      'petstore.json',
      { type: 'application/json' },
    );
    await userEvent.upload(screen.getByLabelText(/From a file/), file);
    await waitFor(() => expect(store.clientSnapshot().requests).toHaveLength(1));
    expect(await screen.findByText(/\{\{baseUrl\}\}/)).toBeInTheDocument();
  });

  it('writes a file for each format', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const object = { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined };
    vi.spyOn(URL, 'createObjectURL').mockImplementation(object.createObjectURL);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(object.revokeObjectURL);
    const { store } = await mount();
    store.saveRequest({ name: 'List pets', request: { method: 'GET', url: 'https://api.test/pets', headers: [] } });
    await userEvent.click(screen.getByRole('button', { name: 'Import or export' }));
    for (const name of ['dockudos', 'Postman', 'Bruno']) {
      await userEvent.click(screen.getByRole('button', { name }));
    }
    expect(click).toHaveBeenCalledTimes(3);
  });
});

describe('the history and the responses kept', () => {
  it('lists what was sent and opens it again', async () => {
    const fetch = answer('{"a":1}');
    vi.stubGlobal('fetch', fetch);
    const { store } = await mount();
    await userEvent.type(screen.getByLabelText('Address'), 'https://api.test/pets');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(store.clientSnapshot().history).toHaveLength(1));

    await userEvent.click(screen.getByRole('tab', { name: /History/ }));
    await userEvent.clear(screen.getByLabelText('Address'));
    await userEvent.click(screen.getByRole('button', { name: /api\.test\/pets/ }));
    expect(screen.getByLabelText('Address')).toHaveValue('https://api.test/pets');

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(store.clientSnapshot().history).toEqual([]);
    expect(screen.getByText(/Nothing sent yet/)).toBeInTheDocument();
  });

  it('lets a reader ask for requests that used a secret to be listed too', async () => {
    const { store } = await mount();
    await userEvent.click(screen.getByRole('tab', { name: /History/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /used a secret variable/ }));
    expect(store.clientSnapshot().historyWithSecrets).toBe(true);
  });

  it('keeps a response, compares the next one with it, and deletes it again', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{\n  "name": "Rex"\n}', { headers: { 'content-type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response('{\n  "name": "Fido"\n}', { headers: { 'content-type': 'application/json' } }),
      );
    vi.stubGlobal('fetch', fetch);
    const { store } = await mount();
    await userEvent.type(screen.getByLabelText('Address'), 'https://api.test/pet/10');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Keep this response' }));
    await waitFor(() => expect(store.clientSnapshot().examples).toHaveLength(1));

    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const kept = store.clientSnapshot().examples[0];
    await userEvent.selectOptions(
      await screen.findByLabelText('Compare with'),
      kept?.id as string,
    );
    const diff = screen.getByRole('figure', { name: 'What changed' });
    expect(diff).toHaveTextContent('1 line added, 1 removed');
    expect(diff).toHaveTextContent('"name": "Fido"');

    await userEvent.click(screen.getByRole('button', { name: `Delete ${kept?.name}` }));
    expect(store.clientSnapshot().examples).toEqual([]);
    // Two round-trips through the editor; the default five seconds is tight when coverage is on.
  }, 20_000);
});

describe('when the browser keeps nothing', () => {
  it('says that what is saved lasts until the page is closed', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', undefined);
    const { ApiClient } = await import('./client.tsx');
    const store = await import('./client-store.ts');
    render(<ApiClient />);
    await waitFor(() => expect(store.clientSnapshot().where).toBe('memory'));
    expect(await screen.findByText(/until the page is closed/)).toBeInTheDocument();
  });

  it('shows a refused write and lets the reader dismiss it', async () => {
    const { store } = await mount();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      const error = new Error('no room');
      error.name = 'QuotaExceededError';
      throw error;
    });
    store.addCollection('Petstore');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/no room left/);
    await userEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(store.clientSnapshot().notice).toBeUndefined();
  });
});

describe('the client over an endpoint page', () => {
  it('opens as a dialog with a close button and takes focus', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', new IDBFactory());
    const onClose = vi.fn();
    const { ApiClientPanel } = await import('./client.tsx');
    render(<ApiClientPanel prefill={prefill()} onClose={onClose} title="Saved requests" />);
    const panel = screen.getByRole('dialog', { name: 'API client' });
    expect(within(panel).getByRole('heading', { name: 'Saved requests' })).toHaveFocus();
    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('writes itself as a note in Markdown, because there is nothing to try in a text file', async () => {
    const { ApiClient } = await import('./client.tsx');
    expect(await ApiClient.toMarkdown()).toMatch(/An API client runs/);
  });
});
