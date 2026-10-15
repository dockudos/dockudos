import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../src/lib/api';

const respond = (status: number, body: string, ok = status < 400) =>
  vi.fn(
    async (_path: string, _init?: RequestInit) =>
      ({ ok, status, text: async () => body }) as Response,
  );

afterEach(() => vi.unstubAllGlobals());

describe('api()', () => {
  it('GETs by default, always with the session cookie', async () => {
    const f = respond(200, '{"a":1}');
    vi.stubGlobal('fetch', f);
    expect(await api('/api/v1/x')).toEqual({ a: 1 });
    expect(f).toHaveBeenCalledWith('/api/v1/x', {
      method: 'GET',
      credentials: 'same-origin',
    });
  });

  it('POSTs a JSON body with the right header', async () => {
    const f = respond(200, '{}');
    vi.stubGlobal('fetch', f);
    await api('/api/v1/x', { body: { n: 1 } });
    expect(f).toHaveBeenCalledWith('/api/v1/x', {
      method: 'POST',
      credentials: 'same-origin',
      body: '{"n":1}',
      headers: { 'content-type': 'application/json' },
    });
  });

  it('sends a raw body untouched, and honours an explicit method', async () => {
    const f = respond(200, '{}');
    vi.stubGlobal('fetch', f);
    const bytes = new Uint8Array([1, 2]);
    await api('/up', { raw: bytes });
    expect(f.mock.calls[0]![1]).toMatchObject({ method: 'POST', body: bytes });
    expect((f.mock.calls[0]![1] as RequestInit).headers).toBeUndefined();
    await api('/thing', { method: 'DELETE' });
    expect(f.mock.calls[1]![1]).toMatchObject({ method: 'DELETE' });
    await api('/thing', { method: 'PUT', body: {} });
    expect(f.mock.calls[2]![1]).toMatchObject({ method: 'PUT' });
  });

  it('treats an empty or non-JSON success body as an empty object', async () => {
    vi.stubGlobal('fetch', respond(204, ''));
    expect(await api('/x')).toEqual({});
    vi.stubGlobal('fetch', respond(200, '<html>oops</html>'));
    expect(await api('/x')).toEqual({});
  });

  it('keeps the platform error code, message and details', async () => {
    vi.stubGlobal(
      'fetch',
      respond(
        409,
        JSON.stringify({
          error: {
            code: 'edit_conflict',
            message: 'Changed upstream',
            details: { files: ['a'] },
          },
        }),
      ),
    );
    const err = await api('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'edit_conflict',
      message: 'Changed upstream',
      details: { files: ['a'] },
    });
  });

  it('falls back to a generic message when the error has no body', async () => {
    vi.stubGlobal('fetch', respond(502, 'Bad gateway', false));
    expect(await api('/x').catch((e) => e)).toMatchObject({
      status: 502,
      code: 'error',
      message: 'Request failed (502)',
    });
  });
});
