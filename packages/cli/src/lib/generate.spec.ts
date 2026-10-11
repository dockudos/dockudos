import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliError, type Env } from './io.ts';
import { generate, generatePages, watchedInputs } from './generate.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dockudos-gen-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function makeEnv() {
  const out: string[] = [];
  const env = { cwd: dir, out: (t: string) => out.push(t) } as unknown as Env;
  return { env, text: () => out.join('') };
}

const SPEC = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Pets', version: '1' },
  paths: {
    '/pets': { get: { operationId: 'list', responses: { '200': {} } } },
  },
});

async function site(config: object, files: Record<string, string> = {}) {
  await mkdir(join(dir, 'docs'), { recursive: true });
  await writeFile(join(dir, 'docs.json'), JSON.stringify(config));
  for (const [f, t] of Object.entries(files)) {
    await mkdir(join(dir, f, '..'), { recursive: true });
    await writeFile(join(dir, f), t);
  }
}

describe('generatePages', () => {
  it('turns an unreadable docs.json into a CliError', async () => {
    await expect(generatePages(makeEnv().env)).rejects.toBeInstanceOf(CliError);
  });

  it('does nothing when there are no sources', async () => {
    await site({ name: 'T' });
    expect(await generatePages(makeEnv().env)).toBe(0);
  });

  it('writes the pages and logs each report unless quiet', async () => {
    await site(
      {
        name: 'T',
        openapi: { sources: [{ name: 'pets', spec: 'pets.json' }] },
      },
      { 'pets.json': SPEC },
    );
    const loud = makeEnv();
    expect(await generatePages(loud.env, { force: true })).toBeGreaterThan(0);
    expect(loud.text()).not.toBe('');
    const quiet = makeEnv();
    await generatePages(quiet.env, { force: true, quiet: true });
    expect(quiet.text()).toBe('');
  });

  it('names the spec that cannot be read', async () => {
    await site({
      name: 'T',
      openapi: { sources: [{ name: 'm', spec: 'missing.json' }] },
    });
    await expect(generatePages(makeEnv().env)).rejects.toBeInstanceOf(CliError);
  });

  it('lets an unexpected error through', async () => {
    await site(
      {
        name: 'T',
        openapi: { sources: [{ name: 'pets', spec: 'pets.json' }] },
      },
      { 'pets.json': SPEC },
    );
    const env = {
      cwd: dir,
      out: () => {
        throw new TypeError('boom');
      },
    } as unknown as Env;
    await expect(generatePages(env, { force: true })).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});

describe('watchedInputs', () => {
  it('lists local specs and reference inputs, skipping URLs', async () => {
    await site({
      name: 'T',
      openapi: {
        sources: [
          { name: 'a', spec: 'a.json' },
          { name: 'b', spec: 'https://x.test/b.json' },
        ],
      },
      reference: {
        sources: [
          { name: 'r1', type: 'typescript', input: 'src/index.ts' },
          { name: 'r2', type: 'typescript', input: ['src/a.ts', '/abs/b.ts'] },
        ],
      },
    });
    expect(await watchedInputs(makeEnv().env)).toEqual([
      join(dir, 'a.json'),
      join(dir, 'src/index.ts'),
      join(dir, 'src/a.ts'),
      '/abs/b.ts',
    ]);
  });

  it('is empty when docs.json is unreadable', async () => {
    expect(await watchedInputs(makeEnv().env)).toEqual([]);
  });
});

describe('generate', () => {
  it('rejects unknown options', async () => {
    await expect(generate(makeEnv().env, ['--wat'])).rejects.toThrow(
      'Unknown option "--wat"',
    );
  });

  it('says so when there is nothing to generate', async () => {
    await site({ name: 'T' });
    const t = makeEnv();
    expect(await generate(t.env, [])).toBe(0);
    expect(t.text()).toContain('Nothing to generate');
  });

  it('generates with --force', async () => {
    await site(
      {
        name: 'T',
        openapi: { sources: [{ name: 'pets', spec: 'pets.json' }] },
      },
      { 'pets.json': SPEC },
    );
    const t = makeEnv();
    expect(await generate(t.env, ['--force'])).toBe(0);
    expect(t.text()).not.toContain('Nothing to generate');
  });
});
