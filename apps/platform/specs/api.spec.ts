import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../src/lib/api';

afterEach(() => vi.unstubAllGlobals());
const stub = (make: () => Response) => {
  const f = vi.fn(async () => make());
  vi.stubGlobal('fetch', f);
  return f;
};

describe('api', () => {
  it('sends JSON as POST and parses the answer', async () => {
    const f = stub(() => Response.json({ ok: true }));
    expect(await api('/x', { body: { a: 1 } })).toEqual({ ok: true });
    expect(f).toHaveBeenCalledWith(
      '/x',
      expect.objectContaining({
        method: 'POST',
        body: '{"a":1}',
        credentials: 'same-origin',
      }),
    );
  });
  it('sends raw bodies untouched and GETs by default', async () => {
    const f = stub(() => Response.json({}));
    await api('/m', { raw: 'bytes' });
    expect(f.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      body: 'bytes',
    });
    await api('/g');
    expect(f.mock.calls[1]![1]).toMatchObject({ method: 'GET' });
  });
  it('keeps the code, status and details of an error', async () => {
    stub(() =>
      Response.json(
        {
          error: {
            code: 'edit_conflict',
            message: 'changed',
            details: { headSha: 'h' },
          },
        },
        { status: 409 },
      ),
    );
    const e = (await api('/s', { body: {} }).catch((x) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({
      status: 409,
      code: 'edit_conflict',
      message: 'changed',
      details: { headSha: 'h' },
    });
  });
  it('copes with an empty or non-JSON body', async () => {
    stub(() => new Response('<html>bad gateway</html>', { status: 502 }));
    expect(await api('/x').catch((x) => x)).toMatchObject({
      status: 502,
      message: 'Request failed (502)',
    });
    stub(() => new Response(null, { status: 204 }));
    expect(await api('/x')).toEqual({});
  });
});
