import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { parseConfig } from '@dockudos/core';
import { createGit, GitFailure, type Git } from './git.ts';
import {
  addToNav,
  classifyPath,
  cleanSvg,
  isPageId,
  mapNav,
  MAX_DOC,
  MAX_MEDIA,
  mediaType,
  sniffMedia,
} from './paths.ts';

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const bad = (m: string) => new HttpError(400, m);

const sha = (b: Uint8Array | string) =>
  createHash('sha1').update(b).digest('hex');

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const PLACEHOLDER = `<!doctype html><meta charset="utf-8"><title>dockudos editor</title>
<body style="font:16px system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>The editor interface is not built</h1><p>The server is running, but its web interface is missing.
Build it with <code>pnpm nx build @dockudos/editor</code>.</p>`;

/** The file of the built interface that answers `pathname`; anything outside the folder gets the app's page. */
export function staticFile(ui: string, pathname: string): string {
  const file = resolve(ui, `.${pathname === '/' ? '/index.html' : pathname}`);
  return file !== ui && !file.startsWith(ui + sep)
    ? join(ui, 'index.html')
    : file;
}

/** Answer a failed request. A response that has already started can only be ended. */
export function respondError(res: ServerResponse, e: unknown): void {
  if (res.headersSent) return void res.end();
  const status =
    e instanceof HttpError || e instanceof GitFailure ? e.status : 500;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify({ error: (e as Error).message }));
}

export interface EditServerOptions {
  /** The docs folder (the one with `docs.json`). */
  dir: string;
  /** Built web interface. Without it the server answers with a notice. */
  uiDir?: string;
  port?: number;
  /** Fixed token, for tests. Random by default. */
  token?: string;
}

export interface EditServer {
  server: Server;
  port: number;
  token: string;
  /** The address to open: it signs the browser in and redirects to the editor. */
  url: string;
  close(): Promise<void>;
}

/**
 * The editor's backend for one folder. It listens on the loopback interface only, answers only requests whose
 * `Host` is the loopback address (a rebinding defence), and needs a per-launch token. It can read and write
 * `docs.json`, `docs/**` and `public/media/*`, nothing else.
 */
export async function startEditServer(
  options: EditServerOptions,
): Promise<EditServer> {
  const root = await realpath(resolve(options.dir));
  const token = options.token ?? randomBytes(24).toString('base64url');
  const git = createGit(root);
  let port = 0;

  const tokenOk = (given: string | undefined) => {
    if (!given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const cookieToken = (req: IncomingMessage) =>
    /(?:^|;\s*)dkd_edit=([\w-]+)/.exec(req.headers.cookie ?? '')?.[1];

  /** Resolve a project path under `root`, refusing anything that escapes it through a symlink. */
  async function abs(path: string): Promise<string> {
    const full = resolve(root, path);
    // Walk up to the nearest part that exists (the folder itself, at worst) and check where it really points.
    let probe = full;
    for (;;) {
      try {
        const real = await realpath(probe);
        if (real !== root && !real.startsWith(root + sep))
          throw new HttpError(403, `${path} is outside the folder.`);
        return full;
      } catch (e) {
        if (e instanceof HttpError) throw e;
        probe = dirname(probe);
      }
    }
  }

  const exists = (p: string) =>
    stat(p).then(
      () => true,
      () => false,
    );

  async function walk(dir: string, prefix: string): Promise<string[]> {
    const out: string[] = [];
    let entries;
    try {
      entries = await readdir(join(root, dir), { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      const rel = `${prefix}${e.name}`;
      if (e.isDirectory())
        out.push(...(await walk(`${dir}/${e.name}`, `${rel}/`)));
      else if (e.isFile() && classifyPath(rel)) out.push(rel);
    }
    return out;
  }

  async function atomicWrite(path: string, data: string | Uint8Array) {
    const full = await abs(path);
    await mkdir(dirname(full), { recursive: true });
    const tmp = `${full}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, full);
  }

  async function readConfig(): Promise<Record<string, unknown> | undefined> {
    try {
      return JSON.parse(await readFile(join(root, 'docs.json'), 'utf8'));
    } catch {
      return undefined;
    }
  }

  const checkDoc = (p: unknown): string => {
    if (typeof p !== 'string' || !classifyPath(p))
      throw bad(
        'The editor can change docs.json, docs/**/*.md(x) and public/media/* only.',
      );
    return p;
  };

  function validateConfigText(text: string) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw bad(`docs.json is not valid JSON: ${(e as Error).message}`);
    }
    try {
      parseConfig(json, 'docs.json');
    } catch (e) {
      throw bad((e as Error).message);
    }
  }

  async function body(req: IncomingMessage, limit: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req as AsyncIterable<Buffer>) {
      size += c.length;
      if (size > limit) throw new HttpError(413, 'That is too large.');
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  }
  async function json<T>(req: IncomingMessage): Promise<T> {
    try {
      return JSON.parse((await body(req, MAX_DOC * 2)).toString('utf8')) as T;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw bad('The request body is not valid JSON.');
    }
  }

  const send = (
    res: ServerResponse,
    status: number,
    data: unknown,
    headers: Record<string, string> = {},
  ) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    });
    res.end(JSON.stringify(data));
  };

  async function project() {
    const repoRoot = await git.root();
    const isRepo = repoRoot !== undefined;
    const config = await readConfig();
    return {
      name:
        typeof config?.['name'] === 'string' ? config['name'] : basename(root),
      dir: root,
      hasConfig: config !== undefined,
      files: [
        ...((await exists(join(root, 'docs.json'))) ? ['docs.json'] : []),
        ...(await walk('docs', 'docs/')),
        ...(await walk('public/media', 'public/media/')),
      ],
      git: isRepo
        ? {
            isRepo,
            branch: await git.branch(),
            head: (await git.head()) ?? null,
            identity: (await git.identity()) ?? null,
          }
        : { isRepo, branch: null, head: null, identity: null },
    };
  }

  async function api(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const method = req.method ?? 'GET';
    const route = `${method} ${url.pathname}`;
    const q = (k: string) => url.searchParams.get(k) ?? '';

    if (route === 'GET /api/session') return send(res, 200, { token });
    if (route === 'GET /api/project') return send(res, 200, await project());

    if (route === 'GET /api/file') {
      const path = checkDoc(q('path'));
      if (classifyPath(path) === 'media')
        throw bad('Media is read from /api/raw.');
      let text: string;
      try {
        text = await readFile(await abs(path), 'utf8');
      } catch {
        throw new HttpError(404, `No file ${path}.`);
      }
      return send(res, 200, { path, content: text, hash: sha(text) });
    }

    if (route === 'GET /api/raw') {
      const path = checkDoc(q('path'));
      if (classifyPath(path) !== 'media') throw bad('Not a media file.');
      let data: Buffer;
      try {
        data = await readFile(await abs(path));
      } catch {
        throw new HttpError(404, `No file ${path}.`);
      }
      res.writeHead(200, {
        'content-type': mediaType(path),
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      });
      return void res.end(data);
    }

    if (route === 'PUT /api/file') {
      const b = await json<{
        path?: string;
        content?: string;
        baseHash?: string;
      }>(req);
      const path = checkDoc(b.path);
      const kind = classifyPath(path);
      if (kind === 'media') throw bad('Upload media through /api/media.');
      if (typeof b.content !== 'string') throw bad('content must be a string.');
      if (Buffer.byteLength(b.content) > MAX_DOC)
        throw new HttpError(413, 'That page is too large.');
      if (kind === 'config') validateConfigText(b.content);
      const full = await abs(path);
      if (b.baseHash !== undefined) {
        const current = await readFile(full, 'utf8').catch(() => undefined);
        if (current !== undefined && sha(current) !== b.baseHash)
          return send(res, 409, {
            error: `${path} changed on disk since it was opened.`,
            current,
            hash: sha(current),
          });
      }
      await atomicWrite(path, b.content);
      return send(res, 200, { path, hash: sha(b.content) });
    }

    if (route === 'POST /api/page') {
      const b = await json<{ id?: string; title?: string; nav?: boolean }>(req);
      const id = String(b.id ?? '');
      if (!isPageId(id))
        throw bad(
          'A page address uses lowercase letters, digits, - and _, with / between folders.',
        );
      const title = String(b.title ?? '').trim();
      if (!title || title.length > 120 || /[\r\n]/.test(title))
        throw bad('A title is one line of 1 to 120 characters.');
      const path = `docs/${id}.mdx`;
      if (
        (await exists(join(root, path))) ||
        (await exists(join(root, `docs/${id}.md`)))
      )
        throw new HttpError(409, `"${id}" already exists.`);
      await atomicWrite(
        path,
        `---\ntitle: ${JSON.stringify(title)}\n---\n\n# ${title}\n\n`,
      );
      const touched = [path];
      const cfg = await readConfig();
      if (cfg && b.nav !== false) {
        cfg['navigation'] = addToNav(cfg['navigation'], id);
        await atomicWrite('docs.json', `${JSON.stringify(cfg, null, 2)}\n`);
        touched.push('docs.json');
      }
      return send(res, 200, { path, touched });
    }

    if (route === 'POST /api/move') {
      const b = await json<{ from?: string; to?: string }>(req);
      const from = String(b.from ?? '');
      const to = String(b.to ?? '');
      if (!isPageId(from) || !isPageId(to))
        throw bad('Both addresses must be page addresses.');
      const ext = (await exists(join(root, `docs/${from}.mdx`)))
        ? 'mdx'
        : (await exists(join(root, `docs/${from}.md`)))
          ? 'md'
          : undefined;
      if (!ext) throw new HttpError(404, `No page "${from}".`);
      if (
        (await exists(join(root, `docs/${to}.mdx`))) ||
        (await exists(join(root, `docs/${to}.md`)))
      )
        throw new HttpError(409, `"${to}" already exists.`);
      const src = `docs/${from}.${ext}`;
      const dst = `docs/${to}.${ext}`;
      const content = await readFile(await abs(src));
      await atomicWrite(dst, content);
      await unlink(await abs(src));
      const touched = [src, dst];
      const cfg = await readConfig();
      if (cfg) {
        cfg['navigation'] = mapNav(cfg['navigation'], (id) =>
          id === from ? to : id,
        );
        const redirects = Array.isArray(cfg['redirects'])
          ? (cfg['redirects'] as { source?: string }[])
          : [];
        cfg['redirects'] = [
          ...redirects.filter((r) => r.source !== `/${from}`),
          { source: `/${from}`, destination: `/${to}`, permanent: true },
        ];
        await atomicWrite('docs.json', `${JSON.stringify(cfg, null, 2)}\n`);
        touched.push('docs.json');
      }
      return send(res, 200, { path: dst, touched });
    }

    if (route === 'DELETE /api/file') {
      const path = checkDoc(q('path'));
      const kind = classifyPath(path);
      if (kind === 'config')
        throw bad('docs.json cannot be deleted from the editor.');
      try {
        await unlink(await abs(path));
      } catch {
        throw new HttpError(404, `No file ${path}.`);
      }
      const touched = [path];
      const cfg = await readConfig();
      if (cfg && kind === 'doc') {
        const id = path.replace(/^docs\//, '').replace(/\.mdx?$/, '');
        const before = JSON.stringify(cfg['navigation']);
        cfg['navigation'] = mapNav(cfg['navigation'], (x) =>
          x === id ? null : x,
        );
        if (JSON.stringify(cfg['navigation']) !== before) {
          await atomicWrite('docs.json', `${JSON.stringify(cfg, null, 2)}\n`);
          touched.push('docs.json');
        }
      }
      return send(res, 200, { touched });
    }

    if (route === 'POST /api/media') {
      const data = await body(req, MAX_MEDIA);
      const kind = sniffMedia(data);
      if (!kind)
        throw bad('That is not a PNG, JPEG, GIF, WebP, SVG, PDF or MP4 file.');
      const stem = (
        q('name')
          .replace(/\.[^.]*$/, '')
          .replace(/[^A-Za-z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'image'
      ).slice(0, 60);
      let name = `${stem}.${kind.ext}`;
      for (let n = 2; await exists(join(root, 'public/media', name)); n++)
        name = `${stem}-${n}.${kind.ext}`;
      const out = kind.ext === 'svg' ? cleanSvg(data.toString('utf8')) : data;
      await atomicWrite(`public/media/${name}`, out);
      return send(res, 200, {
        path: `public/media/${name}`,
        url: `/media/${name}`,
      });
    }

    if (route === 'GET /api/git/status')
      return send(res, 200, {
        changes: await requireRepo().then(() => git.status()),
      });
    if (route === 'GET /api/git/diff') {
      const path = checkDoc(q('path'));
      return send(res, 200, {
        diff: await requireRepo().then(() => git.diff(path)),
      });
    }
    if (route === 'GET /api/git/log') {
      await requireRepo();
      return send(res, 200, {
        commits: await git.log(
          Number(q('limit')) || 30,
          q('path') ? checkDoc(q('path')) : undefined,
        ),
      });
    }
    if (route === 'POST /api/git/init') {
      if (await git.root())
        throw new HttpError(409, 'This folder is already in a Git repository.');
      await git.init();
      return send(res, 200, await project());
    }
    if (route === 'POST /api/git/commit') {
      await requireRepo();
      const b = await json<{ message?: string; paths?: string[] }>(req);
      const changes = await git.status();
      const wanted = Array.isArray(b.paths)
        ? b.paths.map(checkDoc)
        : changes.map((c) => c.path);
      // A rename is two paths: the one that went away has to be committed with the one that appeared.
      const set = new Set(wanted);
      for (const c of changes) if (c.from && set.has(c.path)) set.add(c.from);
      const allowed = new Set(
        changes.flatMap((c) => [c.path, ...(c.from ? [c.from] : [])]),
      );
      const paths = [...set].filter((p) => allowed.has(p));
      if (!(await git.identity()))
        throw new HttpError(
          409,
          'Git does not know who you are. Run: git config user.name "Your Name" and git config user.email you@example.com',
        );
      const commit = await git.commit(String(b.message ?? ''), paths);
      return send(res, 200, { sha: commit, committed: paths });
    }
    if (route === 'POST /api/git/discard') {
      await requireRepo();
      const b = await json<{ paths?: string[] }>(req);
      if (!Array.isArray(b.paths) || b.paths.length === 0)
        throw bad('paths is required.');
      await git.discard(b.paths.map(checkDoc));
      return send(res, 200, { ok: true });
    }

    throw new HttpError(404, 'No such endpoint.');
  }

  async function requireRepo() {
    if (!(await git.root()))
      throw new HttpError(
        409,
        'This folder is not a Git repository. Initialise one first.',
      );
  }

  async function serveStatic(res: ServerResponse, pathname: string) {
    if (!options.uiDir) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      return void res.end(PLACEHOLDER);
    }
    const ui = resolve(options.uiDir);
    let file = staticFile(ui, pathname);
    let data: Buffer;
    try {
      data = await readFile(file);
    } catch {
      // The interface is a single page: unknown paths load it.
      file = join(ui, 'index.html');
      data = await readFile(file).catch(() => Buffer.from(PLACEHOLDER));
    }
    res.writeHead(200, {
      'content-type': STATIC_TYPES[extname(file)] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    });
    res.end(data);
  }

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const hostOk = [
          `127.0.0.1:${port}`,
          `localhost:${port}`,
          `[::1]:${port}`,
        ].includes(req.headers.host ?? '');
        if (!hostOk) throw new HttpError(403, 'Unexpected Host header.');
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        const common = {
          'x-frame-options': 'DENY',
          'referrer-policy': 'no-referrer',
        };
        for (const [k, v] of Object.entries(common)) res.setHeader(k, v);

        // The launch URL: trade the token for a cookie, then drop it from the address bar.
        if (url.pathname === '/' && url.searchParams.has('t')) {
          if (!tokenOk(url.searchParams.get('t') ?? undefined))
            throw new HttpError(
              403,
              'Wrong token. Use the address the command printed.',
            );
          res.writeHead(302, {
            location: '/',
            'set-cookie': `dkd_edit=${token}; HttpOnly; SameSite=Strict; Path=/`,
            'cache-control': 'no-store',
          });
          return void res.end();
        }

        if (url.pathname.startsWith('/api/')) {
          const mutating = req.method !== 'GET' && req.method !== 'HEAD';
          const headerToken = req.headers['x-dockudos-token'];
          const given = Array.isArray(headerToken)
            ? headerToken[0]
            : headerToken;
          // Writes need the header (a cross-site page cannot set it); reads accept the cookie, for <img src>.
          if (!tokenOk(given ?? (mutating ? undefined : cookieToken(req))))
            throw new HttpError(
              401,
              'Not signed in. Open the address the command printed.',
            );
          if (mutating) {
            const origin = req.headers.origin;
            if (
              origin &&
              ![
                `http://127.0.0.1:${port}`,
                `http://localhost:${port}`,
              ].includes(origin)
            )
              throw new HttpError(403, 'Cross-origin request refused.');
          }
          return await api(req, res, url);
        }

        if (req.method !== 'GET' && req.method !== 'HEAD')
          throw new HttpError(405, 'Method not allowed.');
        // Page images live at /media/<name>, the same address the built site uses.
        if (url.pathname.startsWith('/media/')) {
          if (!tokenOk(cookieToken(req)))
            throw new HttpError(401, 'Not signed in.');
          const name = decodeURIComponent(url.pathname.slice('/media/'.length));
          const path = `public/media/${name}`;
          if (classifyPath(path) !== 'media')
            throw new HttpError(404, 'No such file.');
          const data = await readFile(await abs(path)).catch(() => undefined);
          if (!data) throw new HttpError(404, 'No such file.');
          res.writeHead(200, {
            'content-type': mediaType(path),
            'content-security-policy':
              "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            'x-content-type-options': 'nosniff',
            'cache-control': 'no-store',
          });
          return void res.end(data);
        }
        await serveStatic(res, url.pathname);
      } catch (e) {
        respondError(res, e);
      }
    })();
  });

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(options.port ?? 0, '127.0.0.1', () => ok());
  });
  port = (server.address() as { port: number }).port;

  return {
    server,
    port,
    token,
    url: `http://127.0.0.1:${port}/?t=${token}`,
    close: () =>
      new Promise((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}

export type { Git };
