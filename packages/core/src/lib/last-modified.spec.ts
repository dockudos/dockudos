import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lastModified } from './last-modified.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dockudos-lm-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const git = (...args: string[]) =>
  execFileSync(
    'git',
    [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    {
      cwd: dir,
      env: {
        ...process.env,
        GIT_COMMITTER_DATE: '2024-03-01T10:00:00Z',
        GIT_AUTHOR_DATE: '2024-03-01T10:00:00Z',
      },
    },
  );

describe('lastModified', () => {
  it('uses the last commit date when the file is committed and clean', async () => {
    const file = join(dir, 'a.mdx');
    await writeFile(file, 'x');
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    const lm = await lastModified(file);
    expect(lm.source).toBe('git');
    expect(lm.date.toISOString()).toBe('2024-03-01T10:00:00.000Z');
  });

  it('falls back to mtime for an untracked file in a repository', async () => {
    git('init', '-q');
    const file = join(dir, 'new.mdx');
    await writeFile(file, 'x');
    const when = new Date('2021-05-05T00:00:00Z');
    await utimes(file, when, when);
    expect(await lastModified(file)).toEqual({ date: when, source: 'fs' });
  });

  it('falls back to mtime for uncommitted edits to a tracked file', async () => {
    const file = join(dir, 'a.mdx');
    await writeFile(file, 'x');
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    await writeFile(file, 'changed');
    expect((await lastModified(file)).source).toBe('fs');
  });

  it('falls back to mtime outside any repository', async () => {
    const file = join(dir, 'a.mdx');
    await writeFile(file, 'x');
    const lm = await lastModified(file);
    expect(lm.source).toBe('fs');
  });

  it('rejects for a file that does not exist', async () => {
    await expect(lastModified(join(dir, 'nope.mdx'))).rejects.toThrow();
  });
});
