import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGit, GitFailure, parseStatus } from './git.ts';

let dir: string;
const sh = (...a: string[]) =>
  execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
const IDENTITY = ['-c', 'user.name=Ada', '-c', 'user.email=a@e.co'];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dkd-git-'));
  await mkdir(join(dir, 'docs'));
  await writeFile(join(dir, 'docs/a.mdx'), 'a\n');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('parseStatus', () => {
  it('reads porcelain -z entries, renames with their source, and ignores short junk', () => {
    expect(
      parseStatus(
        ' M docs/a.mdx\0?? docs/b.mdx\0A  docs/c.mdx\0 D docs/d.mdx\0R  docs/new.mdx\0docs/old.mdx\0\0x\0',
      ),
    ).toEqual([
      { path: 'docs/a.mdx', status: 'modified', staged: false },
      { path: 'docs/b.mdx', status: 'added', staged: false },
      { path: 'docs/c.mdx', status: 'added', staged: true },
      { path: 'docs/d.mdx', status: 'deleted', staged: false },
      {
        path: 'docs/new.mdx',
        status: 'renamed',
        staged: true,
        from: 'docs/old.mdx',
      },
    ]);
  });
});

describe('createGit', () => {
  it('says so when git is not installed', async () => {
    const path = process.env['PATH'];
    process.env['PATH'] = '';
    try {
      await expect(createGit(dir).root()).rejects.toThrow(
        'git is not installed',
      );
    } finally {
      process.env['PATH'] = path;
    }
  });

  it('is not a repository until initialised, then names its branch with or without commits', async () => {
    const g = createGit(dir);
    expect(await g.root()).toBeUndefined();
    await g.init();
    expect(await g.root()).toBeTruthy();
    expect(await g.head()).toBeUndefined();
    expect(['master', 'main']).toContain(await g.branch());
    expect(await g.log(10)).toEqual([]);
  });

  it('names a detached HEAD as HEAD', async () => {
    sh('init', '-q', '-b', 'main');
    sh(...IDENTITY, 'add', '-A');
    sh(...IDENTITY, 'commit', '-q', '-m', 'one');
    sh('checkout', '-q', '--detach');
    expect(await createGit(dir).branch()).toBe('HEAD');
  });

  it('has no identity when none is configured anywhere', async () => {
    sh('init', '-q');
    const saved = {
      g: process.env['GIT_CONFIG_GLOBAL'],
      s: process.env['GIT_CONFIG_SYSTEM'],
    };
    process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
    process.env['GIT_CONFIG_SYSTEM'] = '/dev/null';
    try {
      expect(await createGit(dir).identity()).toBeUndefined();
      sh('config', 'user.name', 'Ada');
      expect(await createGit(dir).identity()).toBeUndefined(); // a name without an email is not enough
      sh('config', 'user.email', 'a@e.co');
      expect(await createGit(dir).identity()).toEqual({
        name: 'Ada',
        email: 'a@e.co',
      });
    } finally {
      for (const [k, v] of [
        ['GIT_CONFIG_GLOBAL', saved.g],
        ['GIT_CONFIG_SYSTEM', saved.s],
      ] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('refuses to commit without a message or paths, and reports git errors it cannot ignore', async () => {
    sh('init', '-q');
    sh('config', 'user.name', 'Ada');
    sh('config', 'user.email', 'a@e.co');
    await writeFile(join(dir, '.gitignore'), 'docs/secret.mdx\n');
    await writeFile(join(dir, 'docs/secret.mdx'), 's\n');
    const g = createGit(dir);
    await expect(g.commit('  ', ['docs/a.mdx'])).rejects.toMatchObject({
      status: 400,
    });
    await expect(g.commit('m', [])).rejects.toMatchObject({ status: 400 });
    await expect(g.commit('m', ['docs/secret.mdx'])).rejects.toBeInstanceOf(
      GitFailure,
    );
  });

  it('discards a staged file in a repository with no commits by unstaging it', async () => {
    sh('init', '-q');
    sh('add', 'docs/a.mdx');
    await createGit(dir).discard(['docs/a.mdx']);
    expect(sh('ls-files')).toBe('');
  });
});
