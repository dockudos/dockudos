import type { ApiOperationData } from '@dockudos/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { ApiOperation, useApiOperation } from './context.tsx';
import { CodeEditor, languageForMime } from './code-editor.tsx';
import { Prose } from './prose.tsx';
import { CORS_HINT, droppedHeaders, formatBody, sendRequest } from './send.ts';
import { useAuthValues } from './store.ts';

const req = (over: object = {}) => ({
  method: 'GET',
  url: 'https://api.test/x',
  headers: [] as [string, string][],
  ...over,
});
const proxy = '/api/proxy';
const proxied = (body: unknown, status = 200) => async () =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('sendRequest', () => {
  it('sends straight to the API without cookies, leaves out headers a browser forbids, and sends a body', async () => {
    // A body that is bytes carries no content type of its own.
    const fetch = vi.fn(async () => new Response(new TextEncoder().encode('plain')));
    const out = await sendRequest(
      req({ method: 'POST', headers: [['Cookie', 'a=b'], ['X-Id', '1']], body: { text: '{}' } }),
      { fetch: fetch as never },
    );
    expect(out.ok && out.response.body).toBe('plain');
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.credentials).toBe('omit');
    expect(init.headers).toEqual([['X-Id', '1']]);
    expect(init.body).toBe('{}');
    expect(droppedHeaders([['Cookie', 'a'], ['X-Id', '1']])).toEqual(['Cookie']);
  });

  it('sends no body with GET, and shows a binary answer as its size only', async () => {
    const fetch = vi.fn(
      async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    );
    const out = await sendRequest(req({ body: { text: 'ignored' } }), { fetch: fetch as never });
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).toBeUndefined();
    expect(out.ok && [out.response.binary, out.response.size, out.response.body]).toEqual([true, 3, '']);
  });

  it('says when nothing answered in time, when it was cancelled, and when it could not be sent', async () => {
    const hang = (_url: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) =>
        init.signal?.addEventListener('abort', () => rej(new Error('aborted'))),
      );
    const slow = await sendRequest(req(), { fetch: hang as never, timeoutMs: 5 });
    expect(!slow.ok && slow.message).toContain('No answer after');

    const controller = new AbortController();
    const pending = sendRequest(req(), { fetch: hang as never, signal: controller.signal });
    controller.abort();
    const cancelled = await pending;
    expect(!cancelled.ok && cancelled.message).toBe('The request was cancelled.');

    const failed = await sendRequest(req(), {
      fetch: (async () => {
        throw new TypeError('Failed to fetch');
      }) as never,
    });
    expect(!failed.ok && failed.hint).toBe(CORS_HINT);
  });

  it('reads a proxied answer in text or base64, with the defaults for what is missing', async () => {
    const text = await sendRequest(req({ body: { text: 'x' } }), {
      proxy,
      fetch: proxied({ status: 200, body: 'hello' }) as never,
    });
    expect(text.ok && [text.response.body, text.response.statusText, text.response.headers]).toEqual(['hello', '', []]);

    const empty = await sendRequest(req(), { proxy, fetch: proxied({ status: 204 }) as never });
    expect(empty.ok && empty.response.size).toBe(0);

    const b64 = await sendRequest(req(), {
      proxy,
      fetch: proxied({ status: 200, statusText: 'OK', headers: [['a', 'b']], body: btoa('xyz'), encoding: 'base64' }) as never,
    });
    expect(b64.ok && [b64.response.binary, b64.response.size, b64.response.headers]).toEqual([true, 3, [['a', 'b']]]);

    const noBody = await sendRequest(req(), {
      proxy,
      fetch: proxied({ status: 200, encoding: 'base64' }) as never,
    });
    expect(noBody.ok && noBody.response.size).toBe(0);
  });

  it('explains a proxy that failed', async () => {
    const message = async (fetch: () => Promise<Response>) => {
      const out = await sendRequest(req(), { proxy, fetch: fetch as never });
      return !out.ok && out.message;
    };
    expect(await message(proxied('not json', 502))).toBe('The proxy answered 502 without a usable body.');
    expect(await message(proxied({ error: 'Blocked' }, 403))).toBe('Blocked');
    expect(await message(proxied({}, 500))).toBe('The proxy answered 500.');
    expect(await message(proxied({ body: 'x' }, 200))).toBe('The proxy answered 200.');
  });

  it('uses the page’s own fetch when none is given', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const out = await sendRequest(req());
    expect(out.ok).toBe(true);
    spy.mockRestore();
  });
});

describe('formatBody', () => {
  it('indents JSON, found by type or by shape, and leaves anything else', () => {
    expect(formatBody('{"a":1}', 'application/json')).toBe('{\n  "a": 1\n}');
    expect(formatBody('[1]', undefined)).toBe('[\n  1\n]');
    expect(formatBody('{broken', 'application/json')).toBe('{broken');
    expect(formatBody('plain', 'text/plain')).toBe('plain');
    expect(formatBody('plain', undefined)).toBe('plain');
  });
});

describe('Prose', () => {
  const html = (text: string) => render(<Prose text={text} />).container;

  it('shows italics, plain links and code fences, closed or not, and ordered lists', () => {
    const c = html(
      [
        '`code` at the start, then *italic* and https://x.test/y at the end',
        '',
        '```js',
        'const a = 1;',
        '```',
        '',
        '1. one',
        '2. two',
        '',
        'first line',
        'second line',
        '',
        '~~~',
        'never closed',
      ].join('\n'),
    );
    expect(c.querySelector('em')?.textContent).toBe('italic');
    expect(c.querySelector('a')?.getAttribute('href')).toBe('https://x.test/y');
    expect(c.querySelectorAll('pre')).toHaveLength(2);
    expect(c.querySelector('pre code')?.textContent).toBe('const a = 1;');
    expect(c.querySelector('ol')).not.toBeNull();
    expect(c.textContent).toContain('first line second line');
  });

  it('ends cleanly when the text ends with a token', () => {
    expect(html('`code`').querySelector('code')?.textContent).toBe('code');
  });

  it('shows nothing for no text', () => {
    expect(render(<Prose text="  " />).container.firstChild).toBeNull();
    expect(render(<Prose />).container.firstChild).toBeNull();
  });
});

describe('CodeEditor', () => {
  it('picks a language by type, or by the shape of the body when there is no type', () => {
    expect(languageForMime('application/json')).toBe('json');
    expect(languageForMime('text/html')).toBe('xml');
    expect(languageForMime('application/yaml')).toBe('yaml');
    expect(languageForMime('text/javascript')).toBe('javascript');
    expect(languageForMime(undefined, '[1]')).toBe('json');
    expect(languageForMime(undefined, 'hello')).toBe('text');
    expect(languageForMime('text/plain', '{}')).toBe('text');
  });

  it('is editable at once, before the editor has loaded, and says when it is invalid', () => {
    const onChange = vi.fn();
    const { container } = render(
      <CodeEditor value="a" language="text" label="Body" invalid onChange={onChange} />,
    );
    expect(container.querySelector('.dk-cm')).toHaveAttribute('data-invalid', '');
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('works with no change handler, and valid', () => {
    const { container } = render(<CodeEditor value="a" language="text" label="Body" />);
    expect(container.querySelector('.dk-cm')).not.toHaveAttribute('data-invalid');
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'b' } });
  });
});

describe('API context and store', () => {
  const data = (deprecated?: boolean) =>
    ({ operation: { method: 'get', deprecated } }) as unknown as ApiOperationData;

  it('refuses to be used outside an operation', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Probe = () => {
      useApiOperation();
      return null;
    };
    expect(() => render(<Probe />)).toThrow('belongs inside <ApiOperation>');
    quiet.mockRestore();
  });

  it('notes a deprecated endpoint, and has no Markdown of its own', () => {
    const { container, rerender } = render(<ApiOperation data={data(true)} schemasUrl="/s" />);
    expect(container.querySelector('.dk-api-deprecated')).not.toBeNull();
    rerender(<ApiOperation data={data()} schemasUrl="/s" />);
    expect(container.querySelector('.dk-api-deprecated')).toBeNull();
    expect((ApiOperation as unknown as { toMarkdown: () => string }).toMarkdown()).toBe('');
  });

  it('has no credentials on the server', () => {
    const Probe = () => <p>{Object.keys(useAuthValues()[0]).length}</p>;
    expect(renderToString(<Probe />)).toContain('0');
  });
});
