import { execFileSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type EditServer,
  respondError,
  staticFile,
  startEditServer,
} from './server.ts';

const TOKEN = 'test-token-0123456789';
let dir: string;
let srv: EditServer;

const sh = (...args: string[]) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

async function seed() {
  await mkdir(join(dir, 'docs'), { recursive: true });
  await writeFile(
    join(dir, 'docs.json'),
    JSON.stringify({
      name: 'Acme',
      navigation: [
        { tab: 'Docs', groups: [{ group: 'Start', pages: ['index'] }] },
      ],
    }),
  );
  await writeFile(
    join(dir, 'docs/index.mdx'),
    '---\ntitle: Home\n---\n\nHello\n',
  );
  await writeFile(join(dir, 'package.json'), '{"name":"outside"}');
}

function gitInit() {
  sh('init', '-q', '-b', 'main');
  sh('config', 'user.name', 'Ada');
  sh('config', 'user.email', 'ada@example.com');
  sh('add', '-A');
  sh('commit', '-q', '-m', 'first');
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dkd-edit-'));
  await seed();
});
afterEach(async () => {
  await srv?.close();
  await rm(dir, { recursive: true, force: true });
});

const start = async () => {
  srv = await startEditServer({ dir, token: TOKEN });
  return srv;
};
const call = async (
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = { 'x-dockudos-token': TOKEN },
) => {
  const res = await fetch(`http://127.0.0.1:${srv.port}${path}`, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data: Record<string, any> = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { text };
  }
  return { status: res.status, data };
};

describe('access', () => {
  it('refuses API calls without the token and accepts the cookie for reads only', async () => {
    await start();
    expect((await call('GET', '/api/project', undefined, {})).status).toBe(401);
    expect(
      (
        await call('GET', '/api/project', undefined, {
          'x-dockudos-token': 'nope',
        })
      ).status,
    ).toBe(401);
    const cookie = { cookie: `dkd_edit=${TOKEN}` };
    expect((await call('GET', '/api/project', undefined, cookie)).status).toBe(
      200,
    );
    expect(
      (
        await call(
          'PUT',
          '/api/file',
          { path: 'docs/index.mdx', content: 'x' },
          cookie,
        )
      ).status,
    ).toBe(401);
  });

  it('trades the launch token for a cookie and rejects a wrong one', async () => {
    await start();
    const ok = await fetch(srv.url, { redirect: 'manual' });
    expect(ok.status).toBe(302);
    expect(ok.headers.get('set-cookie')).toMatch(
      /dkd_edit=.*HttpOnly.*SameSite=Strict/,
    );
    const wrong = await fetch(`http://127.0.0.1:${srv.port}/?t=wrong`, {
      redirect: 'manual',
    });
    expect(wrong.status).toBe(403);
  });

  it('answers only to the loopback Host and same-origin writes (DNS rebinding, CSRF)', async () => {
    await start();
    const status = (
      headers: Record<string, string>,
      method = 'GET',
      path = '/api/project',
    ) =>
      new Promise<number>((ok, fail) => {
        const req = request(
          {
            host: '127.0.0.1',
            port: srv.port,
            path,
            method,
            headers: { 'x-dockudos-token': TOKEN, ...headers },
          },
          (res) => {
            res.resume();
            ok(res.statusCode!);
          },
        );
        req.on('error', fail);
        req.end();
      });
    expect(await status({ host: 'evil.example' })).toBe(403);
    expect(await status({ host: `localhost:${srv.port}` })).toBe(200);
    expect(
      await status(
        { host: `127.0.0.1:${srv.port}`, origin: 'http://evil.example' },
        'DELETE',
        '/api/file?path=docs/index.mdx',
      ),
    ).toBe(403);
  });

  it('serves a notice when the interface is not built, and the built interface when it is', async () => {
    await start();
    expect((await call('GET', '/', undefined, {})).data['text']).toContain(
      'not built',
    );
    await srv.close();
    const ui = await mkdtemp(join(tmpdir(), 'dkd-ui-'));
    await writeFile(join(ui, 'index.html'), '<h1>ui</h1>');
    await writeFile(join(ui, 'app.js'), 'x');
    srv = await startEditServer({ dir, token: TOKEN, uiDir: ui });
    expect((await call('GET', '/', undefined, {})).data['text']).toBe(
      '<h1>ui</h1>',
    );
    expect((await call('GET', '/app.js', undefined, {})).data['text']).toBe(
      'x',
    );
    expect((await call('GET', '/some/route', undefined, {})).data['text']).toBe(
      '<h1>ui</h1>',
    );
    expect(
      (await call('GET', '/..%2f..%2fetc/passwd', undefined, {})).data['text'],
    ).toBe('<h1>ui</h1>');
    await rm(ui, { recursive: true, force: true });
  });
});

describe('files', () => {
  it('lists the project and reads a page', async () => {
    await start();
    const p = await call('GET', '/api/project');
    expect(p.data['name']).toBe('Acme');
    expect(p.data['files']).toEqual(['docs.json', 'docs/index.mdx']);
    expect(p.data['git'].isRepo).toBe(false);
    const f = await call('GET', '/api/file?path=docs/index.mdx');
    expect(f.data['content']).toContain('Hello');
    expect((await call('GET', '/api/file?path=docs/none.mdx')).status).toBe(
      404,
    );
  });

  it('refuses anything outside docs.json, docs/** and public/media', async () => {
    await start();
    for (const path of [
      'package.json',
      '../x.mdx',
      'docs/../package.json',
      '.git/config',
      'docs/.hidden.mdx',
      '/etc/passwd',
      'docs/a.txt',
    ])
      expect(
        (await call('GET', `/api/file?path=${encodeURIComponent(path)}`))
          .status,
      ).toBe(400);
    expect(
      (await call('PUT', '/api/file', { path: 'package.json', content: '{}' }))
        .status,
    ).toBe(400);
    expect(await readFile(join(dir, 'package.json'), 'utf8')).toBe(
      '{"name":"outside"}',
    );
  });

  it('does not follow a symlink out of the folder', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'dkd-outside-'));
    await symlink(outside, join(dir, 'docs/escape'));
    await start();
    const r = await call('PUT', '/api/file', {
      path: 'docs/escape/x.mdx',
      content: 'pwned',
    });
    expect(r.status).toBe(403);
    expect(existsSync(join(outside, 'x.mdx'))).toBe(false);
    await rm(outside, { recursive: true, force: true });
  });

  it('saves a page, creating folders, and detects a change on disk', async () => {
    await start();
    const first = await call('GET', '/api/file?path=docs/index.mdx');
    const saved = await call('PUT', '/api/file', {
      path: 'docs/index.mdx',
      content: 'one',
      baseHash: first.data['hash'],
    });
    expect(saved.status).toBe(200);
    await writeFile(join(dir, 'docs/index.mdx'), 'changed elsewhere');
    const stale = await call('PUT', '/api/file', {
      path: 'docs/index.mdx',
      content: 'two',
      baseHash: saved.data['hash'],
    });
    expect(stale.status).toBe(409);
    expect(stale.data['current']).toBe('changed elsewhere');
    expect(await readFile(join(dir, 'docs/index.mdx'), 'utf8')).toBe(
      'changed elsewhere',
    );
    expect(
      (
        await call('PUT', '/api/file', {
          path: 'docs/deep/er/new.mdx',
          content: 'n',
        })
      ).status,
    ).toBe(200);
  });

  it('rejects an invalid docs.json and oversized or non-string content', async () => {
    await start();
    const notJson = await call('PUT', '/api/file', {
      path: 'docs.json',
      content: '{nope',
    });
    expect(notJson.status).toBe(400);
    expect(notJson.data['error']).toContain('not valid JSON');
    expect(
      (
        await call('PUT', '/api/file', {
          path: 'docs.json',
          content: '{"navigation":"x"}',
        })
      ).status,
    ).toBe(400);
    expect(
      (await call('PUT', '/api/file', { path: 'docs/a.mdx', content: 5 }))
        .status,
    ).toBe(400);
    expect(
      (
        await call('PUT', '/api/file', {
          path: 'docs/a.mdx',
          content: 'x'.repeat(1024 * 1024 + 1),
        })
      ).status,
    ).toBe(413);
    expect(
      JSON.parse(await readFile(join(dir, 'docs.json'), 'utf8')).name,
    ).toBe('Acme');
  });

  it('creates a page and lists it in the first sidebar group', async () => {
    await start();
    const r = await call('POST', '/api/page', {
      id: 'guides/start',
      title: 'Get "started"',
    });
    expect(r.status).toBe(200);
    expect(r.data['touched']).toEqual(['docs/guides/start.mdx', 'docs.json']);
    expect(await readFile(join(dir, 'docs/guides/start.mdx'), 'utf8')).toBe(
      '---\ntitle: "Get \\"started\\""\n---\n\n# Get "started"\n\n',
    );
    expect(
      JSON.parse(await readFile(join(dir, 'docs.json'), 'utf8')).navigation[0]
        .groups[0].pages,
    ).toEqual(['index', 'guides/start']);
    expect(
      (await call('POST', '/api/page', { id: 'guides/start', title: 'x' }))
        .status,
    ).toBe(409);
    expect(
      (await call('POST', '/api/page', { id: 'Bad Id', title: 'x' })).status,
    ).toBe(400);
    expect(
      (await call('POST', '/api/page', { id: 'ok', title: '  ' })).status,
    ).toBe(400);
    expect(
      (
        await call('POST', '/api/page', {
          id: 'solo',
          title: 'Solo',
          nav: false,
        })
      ).data['touched'],
    ).toEqual(['docs/solo.mdx']);
  });

  it('creates the navigation when docs.json has none, and works without a docs.json', async () => {
    await writeFile(join(dir, 'docs.json'), '{"name":"A"}');
    await start();
    await call('POST', '/api/page', { id: 'first', title: 'First' });
    expect(
      JSON.parse(await readFile(join(dir, 'docs.json'), 'utf8')).navigation,
    ).toEqual([
      { tab: 'Docs', groups: [{ group: 'Pages', pages: ['first'] }] },
    ]);
    await rm(join(dir, 'docs.json'));
    expect(
      (await call('POST', '/api/page', { id: 'second', title: 'Second' })).data[
        'touched'
      ],
    ).toEqual(['docs/second.mdx']);
    expect((await call('GET', '/api/project')).data['hasConfig']).toBe(false);
  });

  it('renames a page: moves the file, updates the sidebar and adds a redirect', async () => {
    await start();
    const r = await call('POST', '/api/move', { from: 'index', to: 'welcome' });
    expect(r.status).toBe(200);
    expect(existsSync(join(dir, 'docs/index.mdx'))).toBe(false);
    expect(await readFile(join(dir, 'docs/welcome.mdx'), 'utf8')).toContain(
      'Hello',
    );
    const cfg = JSON.parse(await readFile(join(dir, 'docs.json'), 'utf8'));
    expect(cfg.navigation[0].groups[0].pages).toEqual(['welcome']);
    expect(cfg.redirects).toEqual([
      { source: '/index', destination: '/welcome', permanent: true },
    ]);
    expect(
      (await call('POST', '/api/move', { from: 'ghost', to: 'x' })).status,
    ).toBe(404);
    await call('POST', '/api/page', { id: 'other', title: 'Other' });
    expect(
      (await call('POST', '/api/move', { from: 'welcome', to: 'other' }))
        .status,
    ).toBe(409);
    expect(
      (await call('POST', '/api/move', { from: 'welcome', to: '../x' })).status,
    ).toBe(400);
  });

  it('deletes a page and its sidebar entry, but never docs.json', async () => {
    await start();
    const r = await call('DELETE', '/api/file?path=docs/index.mdx');
    expect(r.data['touched']).toEqual(['docs/index.mdx', 'docs.json']);
    expect(
      JSON.parse(await readFile(join(dir, 'docs.json'), 'utf8')).navigation[0]
        .groups[0].pages,
    ).toEqual([]);
    expect((await call('DELETE', '/api/file?path=docs/index.mdx')).status).toBe(
      404,
    );
    expect((await call('DELETE', '/api/file?path=docs.json')).status).toBe(400);
  });
});

describe('media', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(16),
  ]);
  const upload = (name: string, data: Buffer) =>
    fetch(
      `http://127.0.0.1:${srv.port}/api/media?name=${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: { 'x-dockudos-token': TOKEN },
        body: new Uint8Array(data),
      },
    ).then(async (r) => ({
      status: r.status,
      data: (await r.json()) as Record<string, string>,
    }));

  it('stores an image by its bytes, avoids name clashes and serves it back', async () => {
    await start();
    const a = await upload('My Photo!.exe', png);
    expect(a.data['path']).toBe('public/media/My-Photo.png');
    expect((await upload('My Photo!.exe', png)).data['path']).toBe(
      'public/media/My-Photo-2.png',
    );
    const res = await fetch(`http://127.0.0.1:${srv.port}${a.data['url']}`, {
      headers: { cookie: `dkd_edit=${TOKEN}` },
    });
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(
      (await fetch(`http://127.0.0.1:${srv.port}${a.data['url']}`)).status,
    ).toBe(401);
    expect(
      (await call('GET', '/api/raw?path=public/media/My-Photo.png')).status,
    ).toBe(200);
    expect((await call('GET', '/api/raw?path=docs/index.mdx')).status).toBe(
      400,
    );
    expect(
      (await call('GET', '/api/raw?path=public/media/none.png')).status,
    ).toBe(404);
    expect((await call('GET', '/api/project')).data['files']).toContain(
      'public/media/My-Photo.png',
    );
  });

  it('rejects files that are not images, whatever they are called', async () => {
    await start();
    expect(
      (
        await upload(
          'a.png',
          Buffer.from('#!/bin/sh\necho hi, this is a script\n'),
        )
      ).status,
    ).toBe(400);
  });

  it('removes scripts from an SVG', async () => {
    await start();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>alert(1)</script><rect/></svg>',
    );
    const r = await upload('v.svg', svg);
    const saved = await readFile(join(dir, r.data['path']!), 'utf8');
    expect(saved).not.toMatch(/script|onload/);
    expect(saved).toContain('<rect/>');
  });
});

describe('git', () => {
  it('reports a folder that is not a repository, and can initialise one', async () => {
    await start();
    expect((await call('GET', '/api/git/status')).status).toBe(409);
    expect((await call('GET', '/api/git/status')).data['error']).toContain(
      'not a Git repository',
    );
    const init = await call('POST', '/api/git/init');
    expect(init.data['git'].isRepo).toBe(true);
    expect((await call('POST', '/api/git/init')).status).toBe(409);
  });

  it('shows changes, diffs them and commits only the chosen paths', async () => {
    gitInit();
    await start();
    expect((await call('GET', '/api/project')).data['git']).toMatchObject({
      isRepo: true,
      branch: 'main',
      identity: { name: 'Ada' },
    });
    expect((await call('GET', '/api/git/status')).data['changes']).toEqual([]);

    await call('PUT', '/api/file', {
      path: 'docs/index.mdx',
      content: 'edited\n',
    });
    await call('POST', '/api/page', { id: 'new', title: 'New' });
    await writeFile(
      join(dir, 'package.json'),
      '{"name":"changed outside scope"}',
    );

    const st = (await call('GET', '/api/git/status')).data['changes'] as {
      path: string;
      status: string;
    }[];
    expect(st.map((c) => `${c.status}:${c.path}`).sort()).toEqual([
      'added:docs/new.mdx',
      'modified:docs.json',
      'modified:docs/index.mdx',
    ]);

    expect(
      (await call('GET', '/api/git/diff?path=docs/index.mdx')).data['diff'],
    ).toMatch(/-Hello[\s\S]*\+edited/);
    expect(
      (await call('GET', '/api/git/diff?path=docs/new.mdx')).data['diff'],
    ).toContain('+# New');

    const c = await call('POST', '/api/git/commit', {
      message: 'Edit home',
      paths: ['docs/index.mdx'],
    });
    expect(c.status).toBe(200);
    expect(c.data['committed']).toEqual(['docs/index.mdx']);
    expect(sh('log', '-1', '--format=%s%n%an')).toBe('Edit home\nAda\n');
    expect(sh('show', '--stat', '--format=', 'HEAD')).not.toContain('new.mdx');
    expect((await call('GET', '/api/git/status')).data['changes']).toHaveLength(
      2,
    );
    // Files outside the editor's scope are never staged.
    expect(sh('status', '--porcelain')).toContain(' M package.json');

    const all = await call('POST', '/api/git/commit', { message: 'Add page' });
    expect(all.data['committed'].sort()).toEqual(['docs.json', 'docs/new.mdx']);
    expect(
      (await call('GET', '/api/git/log?limit=5')).data['commits'].map(
        (x: { subject: string }) => x.subject,
      ),
    ).toEqual(['Add page', 'Edit home', 'first']);
    expect(
      (await call('GET', '/api/git/log?path=docs/new.mdx')).data['commits'],
    ).toHaveLength(1);
  });

  it('commits a staged rename with both of its paths, and a deletion', async () => {
    gitInit();
    await start();
    sh('mv', 'docs/index.mdx', 'docs/home.mdx');
    const changes = (await call('GET', '/api/git/status')).data['changes'];
    expect(changes).toEqual([
      {
        path: 'docs/home.mdx',
        status: 'renamed',
        staged: true,
        from: 'docs/index.mdx',
      },
    ]);
    // Asking for only the new path still takes the removed one, so the history shows a move.
    const c = await call('POST', '/api/git/commit', {
      message: 'Rename',
      paths: ['docs/home.mdx'],
    });
    expect(c.data['committed'].sort()).toEqual([
      'docs/home.mdx',
      'docs/index.mdx',
    ]);
    expect(sh('ls-files')).not.toContain('docs/index.mdx');
    await call('DELETE', '/api/file?path=docs/home.mdx');
    await call('POST', '/api/git/commit', { message: 'Delete' });
    expect(sh('ls-files')).not.toContain('docs/home.mdx');
  });

  it('commits a page rename made in the editor (a delete and an add) when both paths are given', async () => {
    gitInit();
    await start();
    const r = await call('POST', '/api/move', { from: 'index', to: 'home' });
    const c = await call('POST', '/api/git/commit', {
      message: 'Rename',
      paths: r.data['touched'],
    });
    expect(c.data['committed'].sort()).toEqual([
      'docs.json',
      'docs/home.mdx',
      'docs/index.mdx',
    ]);
    expect((await call('GET', '/api/git/status')).data['changes']).toEqual([]);
  });

  it('refuses an empty message, nothing to commit, unknown paths and a missing identity', async () => {
    gitInit();
    await start();
    expect(
      (await call('POST', '/api/git/commit', { message: 'x' })).status,
    ).toBe(400);
    await call('PUT', '/api/file', { path: 'docs/index.mdx', content: 'e' });
    expect(
      (await call('POST', '/api/git/commit', { message: '  ' })).status,
    ).toBe(400);
    expect(
      (
        await call('POST', '/api/git/commit', {
          message: 'x',
          paths: ['package.json'],
        })
      ).status,
    ).toBe(400);
    // Only changed, in-scope paths are committed: a path with no change is dropped.
    expect(
      (
        await call('POST', '/api/git/commit', {
          message: 'x',
          paths: ['docs/other.mdx'],
        })
      ).status,
    ).toBe(400);
    sh('config', '--unset', 'user.name');
    const env = { ...process.env };
    // The machine's global identity may exist; only assert the message when it does not.
    const global = (() => {
      try {
        return execFileSync('git', ['config', '--global', 'user.name'], {
          encoding: 'utf8',
        }).trim();
      } catch {
        return '';
      }
    })();
    if (!global) {
      const r = await call('POST', '/api/git/commit', { message: 'x' });
      expect(r.status).toBe(409);
      expect(r.data['error']).toContain('git config user.name');
    }
    expect(env).toBeTruthy();
  });

  it('discards changes: restores tracked files and removes new ones', async () => {
    gitInit();
    await start();
    await call('PUT', '/api/file', {
      path: 'docs/index.mdx',
      content: 'scribble',
    });
    await call('POST', '/api/page', { id: 'tmp', title: 'Tmp', nav: false });
    expect((await call('POST', '/api/git/discard', { paths: [] })).status).toBe(
      400,
    );
    expect(
      (
        await call('POST', '/api/git/discard', {
          paths: ['docs/index.mdx', 'docs/tmp.mdx'],
        })
      ).status,
    ).toBe(200);
    expect(await readFile(join(dir, 'docs/index.mdx'), 'utf8')).toContain(
      'Hello',
    );
    expect(existsSync(join(dir, 'docs/tmp.mdx'))).toBe(false);
  });

  it('works when the docs folder is inside a bigger repository', async () => {
    const repo = dir;
    dir = join(repo, 'site');
    await mkdir(dir);
    await seed();
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Ada'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'a@e.co'], { cwd: repo });
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'first'], { cwd: repo });
    await start();
    await call('PUT', '/api/file', {
      path: 'docs/index.mdx',
      content: 'in a subfolder',
    });
    expect((await call('GET', '/api/git/status')).data['changes']).toEqual([
      { path: 'docs/index.mdx', status: 'modified', staged: false },
    ]);
    await call('POST', '/api/git/commit', { message: 'sub' });
    expect(
      execFileSync('git', ['log', '-1', '--format=%s'], {
        cwd: repo,
        encoding: 'utf8',
      }),
    ).toBe('sub\n');
    dir = repo;
  });

  it('reports a repository with no commits yet', async () => {
    sh('init', '-q', '-b', 'trunk');
    sh('config', 'user.name', 'Ada');
    sh('config', 'user.email', 'a@e.co');
    await start();
    const p = (await call('GET', '/api/project')).data['git'];
    expect(p).toMatchObject({ isRepo: true, branch: 'trunk', head: null });
    expect(
      (await call('GET', '/api/git/diff?path=docs/index.mdx')).data['diff'],
    ).toContain('+Hello');
    const c = await call('POST', '/api/git/commit', {
      message: 'initial',
      paths: ['docs.json', 'docs/index.mdx'],
    });
    expect(c.status).toBe(200);
    expect(sh('log', '--format=%s')).toBe('initial\n');
    await call('PUT', '/api/file', {
      path: 'docs/index.mdx',
      content: 'second',
    });
    expect(
      (await call('GET', '/api/git/diff?path=docs/index.mdx')).data['diff'],
    ).toContain('+second');
    await call('POST', '/api/git/discard', { paths: ['docs/index.mdx'] });
    expect(await readFile(join(dir, 'docs/index.mdx'), 'utf8')).toContain(
      'Hello',
    );
  });
});

describe('errors', () => {
  it('answers unknown endpoints, bad JSON and unsupported methods with clear statuses', async () => {
    await start();
    expect((await call('GET', '/api/nope')).status).toBe(404);
    const bad = await fetch(`http://127.0.0.1:${srv.port}/api/page`, {
      method: 'POST',
      headers: { 'x-dockudos-token': TOKEN },
      body: '{oops',
    });
    expect(bad.status).toBe(400);
    expect((await call('POST', '/')).status).toBe(405);
    expect(
      (
        await call('GET', '/media/..%2fdocs.json', undefined, {
          cookie: `dkd_edit=${TOKEN}`,
        })
      ).status,
    ).toBe(404);
  });
});

describe('edge cases', () => {
  it('hands out the session token to a signed-in page', async () => {
    await start();
    expect((await call('GET', '/api/session')).data['token']).toBe(TOKEN);
  });

  it('lists nested pages and skips dot folders', async () => {
    await mkdir(join(dir, 'docs/guides/deep'), { recursive: true });
    await mkdir(join(dir, 'docs/.drafts'), { recursive: true });
    await writeFile(join(dir, 'docs/guides/deep/p.mdx'), 'p');
    await writeFile(join(dir, 'docs/.drafts/x.mdx'), 'x');
    await writeFile(join(dir, 'docs/notes.txt'), 'not a page');
    await start();
    expect((await call('GET', '/api/project')).data['files']).toEqual([
      'docs.json',
      'docs/guides/deep/p.mdx',
      'docs/index.mdx',
    ]);
  });

  it('keeps media and pages on their own endpoints', async () => {
    await start();
    expect(
      (await call('GET', '/api/file?path=public/media/a.png')).status,
    ).toBe(400);
    expect(
      (
        await call('PUT', '/api/file', {
          path: 'public/media/a.png',
          content: 'x',
        })
      ).status,
    ).toBe(400);
  });

  it('saves a new file even when the caller sends a hash for it', async () => {
    await start();
    expect(
      (
        await call('PUT', '/api/file', {
          path: 'docs/fresh.mdx',
          content: 'x',
          baseHash: 'old',
        })
      ).status,
    ).toBe(200);
  });

  it('replaces an earlier redirect for the same address when a page moves again', async () => {
    await writeFile(
      join(dir, 'docs.json'),
      JSON.stringify({
        name: 'A',
        redirects: [{ source: '/index', destination: '/old', permanent: true }],
        navigation: [],
      }),
    );
    await start();
    await call('POST', '/api/move', { from: 'index', to: 'next' });
    expect(
      JSON.parse(await readFile(join(dir, 'docs.json'), 'utf8')).redirects,
    ).toEqual([{ source: '/index', destination: '/next', permanent: true }]);
  });

  it('refuses bodies that are too large', async () => {
    await start();
    const big = await fetch(`http://127.0.0.1:${srv.port}/api/page`, {
      method: 'POST',
      headers: { 'x-dockudos-token': TOKEN },
      body: 'x'.repeat(2 * 1024 * 1024 + 1),
    });
    expect(big.status).toBe(413);
    const media = await fetch(
      `http://127.0.0.1:${srv.port}/api/media?name=a.png`,
      {
        method: 'POST',
        headers: { 'x-dockudos-token': TOKEN },
        body: new Uint8Array(10 * 1024 * 1024 + 1),
      },
    );
    expect(media.status).toBe(413);
  });

  it('serves nothing for missing or hidden media, and says why for reads without a cookie', async () => {
    await start();
    const cookie = { cookie: `dkd_edit=${TOKEN}` };
    expect(
      (await call('GET', '/media/none.png', undefined, cookie)).status,
    ).toBe(404);
    expect(
      (await call('GET', '/media/.secret', undefined, cookie)).status,
    ).toBe(404);
    expect((await call('GET', '/media/none.png', undefined, {})).status).toBe(
      401,
    );
  });

  it('shows the notice when the interface folder has no index.html', async () => {
    const ui = await mkdtemp(join(tmpdir(), 'dkd-ui-empty-'));
    srv = await startEditServer({ dir, token: TOKEN, uiDir: ui });
    expect(
      (await call('GET', '/anything', undefined, {})).data['text'],
    ).toContain('not built');
    await rm(ui, { recursive: true, force: true });
  });

  it('reports an empty log for a repository with no commits', async () => {
    sh('init', '-q', '-b', 'main');
    await start();
    expect((await call('GET', '/api/git/log')).data['commits']).toEqual([]);
  });

  it('refuses a commit when Git has no identity', async () => {
    gitInit();
    sh('config', 'user.name', 'Ada');
    sh('config', '--unset', 'user.email');
    const saved = {
      g: process.env['GIT_CONFIG_GLOBAL'],
      s: process.env['GIT_CONFIG_SYSTEM'],
    };
    process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
    process.env['GIT_CONFIG_SYSTEM'] = '/dev/null';
    try {
      await start();
      await call('PUT', '/api/file', {
        path: 'docs/index.mdx',
        content: 'changed',
      });
      const r = await call('POST', '/api/git/commit', { message: 'x' });
      expect(r.status).toBe(409);
      expect(r.data['error']).toContain('git config user.name');
      expect(
        (await call('GET', '/api/project')).data['git'].identity,
      ).toBeNull();
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
});

describe('staticFile', () => {
  it('maps the root to index.html and keeps everything inside the folder', () => {
    expect(staticFile('/ui', '/')).toBe('/ui/index.html');
    expect(staticFile('/ui', '/assets/a.js')).toBe('/ui/assets/a.js');
    expect(staticFile('/ui', '/../etc/passwd')).toBe('/ui/index.html');
    expect(staticFile('/ui', '/../../x')).toBe('/ui/index.html');
  });
});

describe('respondError', () => {
  const fake = (headersSent: boolean) => {
    const calls: unknown[][] = [];
    return {
      calls,
      res: {
        headersSent,
        writeHead: (...a: unknown[]) => calls.push(['writeHead', ...a]),
        end: (...a: unknown[]) => calls.push(['end', ...a]),
      } as never,
    };
  };

  it('only ends a response that has already started', () => {
    const f = fake(true);
    respondError(f.res, new Error('late'));
    expect(f.calls).toEqual([['end']]);
  });

  it('answers an unexpected error with 500 and its message', () => {
    const f = fake(false);
    respondError(f.res, new Error('boom'));
    expect(f.calls[0]![1]).toBe(500);
    expect(f.calls[1]).toEqual(['end', JSON.stringify({ error: 'boom' })]);
  });
});
