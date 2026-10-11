// A plain file server for the static export in `out/`: no rewrites, no API, no cleverness, as a static host.
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = new URL('../out/', import.meta.url).pathname;
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const path = normalize(
    decodeURIComponent(new URL(req.url, 'http://x').pathname),
  ).replace(/^(\.\.[/\\])+/, '');
  for (const candidate of [join(root, path), join(root, path, 'index.html')]) {
    try {
      if ((await stat(candidate)).isFile()) {
        res.writeHead(200, {
          'content-type':
            types[extname(candidate)] ?? 'application/octet-stream',
        });
        return res.end(await readFile(candidate));
      }
    } catch {
      /* try the next */
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
}).listen(4312, '127.0.0.1');
