import { describe, expect, it, vi } from 'vitest';
import { createPlatformVerify } from './platform-verify.ts';

const rule = (extra: object = {}) => ({ paths: ['/private/**'], require: 'custom', ...extra }) as never;
const principal = { sub: 'u', roles: ['team:acme:editor'], groups: ['team:acme'] };
const answering = (p: unknown, status = 200) => vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify({ principal: p }), { status }));
const withBearer = (t = 'dkd_x') => new Request('https://docs.test/private/a', { headers: { authorization: `Bearer ${t}` } });

describe('createPlatformVerify', () => {
  it('admits a platform key whose team matches the rule', async () => {
    const f = answering(principal);
    const verify = createPlatformVerify({ platformUrl: 'https://platform.test/', fetch: f as never });
    expect(await verify(withBearer(), rule({ groups: ['team:acme'] }))).toBe(true);
    expect(f.mock.calls[0]![0]).toBe('https://platform.test/api/v1/principal');
    expect(await verify(withBearer(), rule({ groups: ['team:other'] }))).toBe(false);
    expect(await verify(withBearer(), rule({ roles: ['team:acme:editor'] }))).toBe(true);
    expect(await verify(withBearer(), rule())).toBe(true);
  });

  it('forwards the session cookie when there is no bearer', async () => {
    const f = answering(principal);
    const verify = createPlatformVerify({ platformUrl: 'https://platform.test', fetch: f as never });
    const req = new Request('https://docs.test/', { headers: { cookie: 'dockudos_platform=abc' } });
    expect(await verify(req, rule())).toBe(true);
    expect((f.mock.calls[0]![1] as unknown as RequestInit).headers).toEqual({ cookie: 'dockudos_platform=abc' });
  });

  it('refuses with no credentials, on refusals, bad answers and a platform that is down', async () => {
    const none = vi.fn();
    expect(await createPlatformVerify({ platformUrl: 'https://p.test', fetch: none as never })(new Request('https://docs.test/'), rule())).toBe(false);
    expect(none).not.toHaveBeenCalled();
    expect(await createPlatformVerify({ platformUrl: 'https://p.test', fetch: answering(undefined, 401) as never })(withBearer(), rule())).toBe(false);
    expect(await createPlatformVerify({ platformUrl: 'https://p.test', fetch: answering({ sub: 1 }) as never })(withBearer(), rule())).toBe(false);
    const down = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    expect(await createPlatformVerify({ platformUrl: 'https://p.test', fetch: down as never })(withBearer(), rule())).toBe(false);
  });

  it('caches successes only, for a short time', async () => {
    const f = answering(principal);
    const verify = createPlatformVerify({ platformUrl: 'https://p.test', fetch: f as never, cacheSeconds: 30 });
    await verify(withBearer('same'), rule());
    await verify(withBearer('same'), rule());
    expect(f).toHaveBeenCalledTimes(1);
    const refused = answering(undefined, 401);
    const v2 = createPlatformVerify({ platformUrl: 'https://p.test', fetch: refused as never });
    await v2(withBearer('bad'), rule());
    await v2(withBearer('bad'), rule());
    expect(refused).toHaveBeenCalledTimes(2);
    const off = answering(principal);
    const v3 = createPlatformVerify({ platformUrl: 'https://p.test', fetch: off as never, cacheSeconds: 0 });
    await v3(withBearer(), rule());
    await v3(withBearer(), rule());
    expect(off).toHaveBeenCalledTimes(2);
  });
});
