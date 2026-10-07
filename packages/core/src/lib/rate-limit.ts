export interface RateLimiterOptions {
  /** Requests allowed per key in each window. */
  limit: number;
  /** Window length in ms. Default one minute. */
  windowMs?: number;
  /** Most keys remembered; the oldest are forgotten beyond it. Keeps memory bounded. Default 10,000. */
  maxKeys?: number;
  now?: () => number;
}

export interface RateDecision {
  allowed: boolean;
  /** Requests left in the window after this one. */
  remaining: number;
  /** Whole seconds until a request would be allowed; 0 when allowed. */
  retryAfter: number;
}

/**
 * A sliding-window rate limiter: at most `limit` requests per key in any `windowMs`. In memory, so each
 * server instance counts for itself.
 */
export function createRateLimiter({
  limit,
  windowMs = 60_000,
  maxKeys = 10_000,
  now = Date.now,
}: RateLimiterOptions) {
  const seen = new Map<string, number[]>();
  return {
    take(key: string): RateDecision {
      const t = now();
      const recent = (seen.get(key) ?? []).filter((at) => t - at < windowMs);
      seen.delete(key); // re-insert last, so the map stays ordered by most recent use
      if (recent.length >= limit) {
        seen.set(key, recent);
        const oldest = recent[0] as number;
        return {
          allowed: false,
          remaining: 0,
          retryAfter: Math.max(1, Math.ceil((oldest + windowMs - t) / 1000)),
        };
      }
      recent.push(t);
      seen.set(key, recent);
      if (seen.size > maxKeys) {
        const oldest = seen.keys().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      return { allowed: true, remaining: limit - recent.length, retryAfter: 0 };
    },
    /** Number of keys remembered. */
    get size() {
      return seen.size;
    },
  };
}

export interface AnswerCacheOptions {
  max?: number;
  ttlMs?: number;
  now?: () => number;
}

/** A small least-recently-used cache whose entries expire. */
export function createAnswerCache<T>({
  max = 100,
  ttlMs = 10 * 60_000,
  now = Date.now,
}: AnswerCacheOptions = {}) {
  const entries = new Map<string, { value: T; expires: number }>();
  return {
    get(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expires <= now()) {
        entries.delete(key);
        return undefined;
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key: string, value: T): void {
      entries.delete(key);
      entries.set(key, { value, expires: now() + ttlMs });
      if (entries.size > max) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
    },
    get size() {
      return entries.size;
    },
  };
}
