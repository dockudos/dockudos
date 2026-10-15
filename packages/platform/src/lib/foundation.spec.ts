import { describe, expect, it } from 'vitest';
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  PlatformError,
  tooMany,
  unauthorized,
} from './errors.ts';
import { spawnRunner } from './exec.ts';
import { createHealth } from './health.ts';
import { createLogger, createScrubber } from './logger.ts';
import { MetricsRegistry } from './metrics.ts';

describe('errors', () => {
  it.each([
    [badRequest('b'), 400, 'bad_request'],
    [unauthorized(), 401, 'unauthorized'],
    [forbidden(), 403, 'forbidden'],
    [notFound(), 404, 'not_found'],
    [conflict('c'), 409, 'conflict'],
    [tooMany(), 429, 'rate_limited'],
  ])('%s carries its status and code', (e, status, code) => {
    expect(e).toBeInstanceOf(PlatformError);
    expect(e).toBeInstanceOf(Error);
    expect(e).toMatchObject({ status, code, name: 'PlatformError' });
  });

  it('keeps structured details only when given, and lets messages be customised', () => {
    expect(conflict('x', 'files_changed', { files: ['a'] }).details).toEqual({
      files: ['a'],
    });
    expect(badRequest('x').details).toBeUndefined();
    expect(tooMany('slow down').message).toBe('slow down');
    expect(forbidden('no').message).toBe('no');
    expect(notFound('gone').message).toBe('gone');
    expect(unauthorized('who?').message).toBe('who?');
  });
});

describe('logger', () => {
  const capture = (opts: Parameters<typeof createLogger>[0] = {}) => {
    const lines: Record<string, any>[] = [];
    const log = createLogger({
      write: (l) => lines.push(JSON.parse(l)),
      now: () => new Date('2026-01-02T03:04:05Z'),
      ...opts,
    });
    return { lines, log };
  };

  it('writes one JSON object per line with the time, level and message', () => {
    const { lines, log } = capture();
    log.info('hello', { a: 1 });
    expect(lines).toEqual([
      { time: '2026-01-02T03:04:05.000Z', level: 'info', msg: 'hello', a: 1 },
    ]);
  });

  it('drops lines below the level, and everything when silent', () => {
    const a = capture({ level: 'warn' });
    a.log.debug('d');
    a.log.info('i');
    a.log.warn('w');
    a.log.error('e');
    expect(a.lines.map((l) => l.level)).toEqual(['warn', 'error']);
    const b = capture({ level: 'silent' });
    b.log.error('nope');
    expect(b.lines).toEqual([]);
  });

  it('writes to stdout by default', () => {
    const out: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => (out.push(s), true)) as never;
    try {
      createLogger({ level: 'info' }).info('to stdout');
    } finally {
      process.stdout.write = orig;
    }
    expect(JSON.parse(out[0]!)).toMatchObject({ msg: 'to stdout' });
    expect(out[0]!.endsWith('\n')).toBe(true);
  });

  it('never writes the value of a sensitive field, at any depth', () => {
    const { lines, log } = capture();
    log.info('x', {
      password: 'hunter2',
      nested: { apiKey: 'k', Authorization: 'Bearer z', ok: 'fine' },
      list: [{ session_token: 't' }],
    });
    const text = JSON.stringify(lines);
    for (const leaked of ['hunter2', 'Bearer z', '"t"'])
      expect(text).not.toContain(leaked);
    expect(lines[0]!.nested.ok).toBe('fine');
    expect(lines[0]!.password).toBe('[redacted]');
  });

  it('scrubs configured secrets out of messages, fields and errors, but ignores short ones', () => {
    const { lines, log } = capture({ secrets: ['SUPERSECRET', 'ab'] });
    log.error('token SUPERSECRET leaked', {
      url: 'https://x/?k=SUPERSECRET',
      error: new Error('failed with SUPERSECRET and ab'),
    });
    const text = JSON.stringify(lines);
    expect(text).not.toContain('SUPERSECRET');
    expect(lines[0]!.error.message).toBe('failed with [redacted] and ab');
    expect(lines[0]!.error.name).toBe('Error');
    expect(lines[0]!.error.stack).not.toContain('SUPERSECRET');
  });

  it('copes with an error that has no stack and with null / primitive fields', () => {
    const { lines, log } = capture();
    const e = new Error('plain');
    e.stack = undefined;
    log.warn('odd', { e, n: null, num: 3, flag: true });
    expect(lines[0]).toMatchObject({ n: null, num: 3, flag: true });
    expect(lines[0]!.e.message).toBe('plain');
  });

  it('stops descending into very deep structures', () => {
    const { lines, log } = capture();
    let deep: any = { end: true };
    for (let i = 0; i < 10; i++) deep = { next: deep };
    log.info('deep', { deep });
    expect(JSON.stringify(lines[0])).toContain('[deep]');
  });

  it('child loggers add bindings, and call-site fields win over them', () => {
    const { lines, log } = capture({ bindings: { svc: 'web' } });
    const child = log.child({ build: 'b1', svc: 'worker' });
    child.info('hi');
    child.child({ extra: 1 }).info('there', { build: 'b2' });
    expect(lines[0]).toMatchObject({ svc: 'worker', build: 'b1' });
    expect(lines[1]).toMatchObject({ svc: 'worker', build: 'b2', extra: 1 });
  });

  it('createScrubber ignores short and missing secrets', () => {
    const scrub = createScrubber(['abcdef', undefined, 'xy']);
    expect(scrub('abcdef xy abcdef')).toBe('[redacted] xy [redacted]');
    expect(createScrubber([])('nothing')).toBe('nothing');
  });
});

describe('metrics', () => {
  it('renders counters with sorted, escaped labels', () => {
    const m = new MetricsRegistry();
    const c = m.counter('jobs_total', 'Jobs');
    c.inc({ b: '2', a: 'x"y\\z\nw' });
    c.inc({ a: 'x"y\\z\nw', b: '2' }, 4);
    c.inc();
    const out = m.render();
    expect(out).toContain('# HELP jobs_total Jobs');
    expect(out).toContain('# TYPE jobs_total counter');
    expect(out).toContain('jobs_total{a="x\\"y\\\\z\\nw",b="2"} 5');
    expect(out).toMatch(/^jobs_total 1$/m);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('renders gauges, replacing the value per label set', () => {
    const m = new MetricsRegistry();
    const g = m.gauge('queue_depth', 'Depth');
    g.set(5, { status: 'queued' });
    g.set(2, { status: 'queued' });
    g.set(9);
    const out = m.render();
    expect(out).toContain('queue_depth{status="queued"} 2');
    expect(out).toMatch(/^queue_depth 9$/m);
    expect(out).toContain('# TYPE queue_depth gauge');
  });

  it('renders cumulative-by-bound histograms with +Inf, sum and count', () => {
    const m = new MetricsRegistry();
    const h = m.histogram('dur', 'Duration', [1, 5]);
    h.observe(0.5, { r: 'a' });
    h.observe(3, { r: 'a' });
    h.observe(10, { r: 'a' });
    const out = m.render();
    expect(out).toContain('dur_bucket{le="1",r="a"} 1');
    expect(out).toContain('dur_bucket{le="5",r="a"} 2');
    expect(out).toContain('dur_bucket{le="+Inf",r="a"} 3');
    expect(out).toContain('dur_sum{r="a"} 13.5');
    expect(out).toContain('dur_count{r="a"} 3');
  });

  it('uses default buckets, and registers a metric name once', () => {
    const m = new MetricsRegistry();
    m.histogram('d', 'x').observe(0.01);
    expect(m.render()).toContain('d_bucket{le="0.025"} 1');
    const a = m.counter('same', 'one');
    const b = m.counter('same', 'two');
    a.inc();
    b.inc();
    expect(m.render()).toContain('same 2');
    expect(m.render().match(/# HELP same/g)).toHaveLength(1);
  });

  it('lists metrics alphabetically', () => {
    const m = new MetricsRegistry();
    m.counter('zz', 'z').inc();
    m.counter('aa', 'a').inc();
    const names = [...m.render().matchAll(/^# HELP (\w+)/gm)].map((x) => x[1]);
    expect(names).toEqual(['aa', 'zz']);
  });
});

describe('health', () => {
  it('is alive without checking anything', () => {
    expect(
      createHealth({ db: async () => Promise.reject(new Error('x')) }).live(),
    ).toEqual({
      status: 'ok',
    });
  });

  it('is ok when every check passes', async () => {
    const r = await createHealth({
      db: async () => undefined,
      storage: async () => undefined,
    }).ready();
    expect(r.status).toBe('ok');
    expect(Object.keys(r.checks)).toEqual(['db', 'storage']);
    expect(r.checks['db']).toMatchObject({ ok: true });
  });

  it('is degraded, naming only the first line of the failure, when a check throws', async () => {
    const r = await createHealth({
      db: async () => {
        throw new Error('ECONNREFUSED db:5432\n    at secret/stack/line');
      },
      ok: async () => undefined,
      weird: async () => Promise.reject('not an error'),
    }).ready();
    expect(r.status).toBe('degraded');
    expect(r.checks['db']).toMatchObject({
      ok: false,
      error: 'ECONNREFUSED db:5432',
    });
    expect(r.checks['ok']!.ok).toBe(true);
    expect(r.checks['weird']).toMatchObject({ ok: false, error: 'failed' });
  });

  it('counts a check that hangs as failed after the timeout', async () => {
    const r = await createHealth(
      { slow: () => new Promise<void>(() => undefined) },
      30,
    ).ready();
    expect(r.status).toBe('degraded');
    expect(r.checks['slow']!.error).toBe('timed out after 30 ms');
  });
});

describe('command runner output cap', () => {
  it('passes output through, then marks truncation once past 2 MB, and still exits cleanly', async () => {
    let seen = '';
    let marks = 0;
    const { code } = await spawnRunner({
      cmd: process.execPath,
      args: [
        '-e',
        "const b='x'.repeat(100000);for(let i=0;i<40;i++)process.stdout.write(b)",
      ],
      cwd: process.cwd(),
      onOutput: (c) => {
        seen += c;
        if (c.includes('[output truncated]')) marks++;
      },
    });
    expect(code).toBe(0);
    expect(marks).toBe(1);
    expect(seen.length).toBeLessThan(2_200_000);
    expect(seen).toContain('[output truncated]');
  });

  it('reports a signal death as 137 and a normal failure by its own code', async () => {
    const killed = await spawnRunner({
      cmd: process.execPath,
      args: ['-e', "process.kill(process.pid,'SIGKILL')"],
      cwd: process.cwd(),
    });
    expect(killed.code).toBe(137);
    const failed = await spawnRunner({
      cmd: process.execPath,
      args: ['-e', 'process.exit(3)'],
      cwd: process.cwd(),
    });
    expect(failed.code).toBe(3);
  });

  it('lets the caller add environment variables on top of the minimal set', async () => {
    let out = '';
    await spawnRunner({
      cmd: process.execPath,
      args: ['-e', 'process.stdout.write(process.env.FOO+"|"+process.env.CI)'],
      cwd: process.cwd(),
      env: { FOO: 'bar' },
      onOutput: (c) => (out += c),
    });
    expect(out).toBe('bar|1');
  });
});
