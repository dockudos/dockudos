import { createAnswerCache, createRateLimiter } from './rate-limit.ts';

describe('createRateLimiter', () => {
  it('allows the limit, then refuses with the time to wait', () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ limit: 3, now: () => now });
    expect(limiter.take('a')).toEqual({
      allowed: true,
      remaining: 2,
      retryAfter: 0,
    });
    now += 10_000;
    limiter.take('a');
    limiter.take('a');
    const refused = limiter.take('a');
    expect(refused).toMatchObject({ allowed: false, remaining: 0 });
    expect(refused.retryAfter).toBe(50); // the first request leaves the window 50 s from now
  });

  it('counts each key separately and recovers as the window slides', () => {
    let now = 0;
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 1000,
      now: () => now,
    });
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('b').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
    now = 999;
    expect(limiter.take('a').allowed).toBe(false);
    now = 1000;
    expect(limiter.take('a').allowed).toBe(true);
  });

  it('a refused request does not extend the wait', () => {
    let now = 0;
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 1000,
      now: () => now,
    });
    limiter.take('a');
    now = 500;
    limiter.take('a');
    limiter.take('a');
    now = 1000;
    expect(limiter.take('a').allowed).toBe(true);
  });

  it('remembers a bounded number of keys', () => {
    const limiter = createRateLimiter({ limit: 1, maxKeys: 3 });
    for (let i = 0; i < 10; i++) limiter.take(`ip-${i}`);
    expect(limiter.size).toBe(3);
  });
});

describe('createAnswerCache', () => {
  it('returns what was stored until it expires', () => {
    let now = 0;
    const cache = createAnswerCache<string>({ ttlMs: 100, now: () => now });
    cache.set('q', 'a');
    expect(cache.get('q')).toBe('a');
    now = 100;
    expect(cache.get('q')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('forgets the least recently used entry beyond its size', () => {
    const cache = createAnswerCache<number>({ max: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // a is now the most recent
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });
});
