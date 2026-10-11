#!/usr/bin/env node
// A just-enough GitHub REST API for smoke tests: one repository, `main`, files, branches and pull requests.
// Usage: node tools/mock-github.mjs [port]. Prints the port it listens on.
import { createServer } from 'node:http';

export function startMockGitHub(port = 0, { repo = 'acme/docs' } = {}) {
  const sha = (n) => String(n).padStart(40, 'a');
  let commits = 1;
  const branches = new Map([['main', sha(1)]]);
  const pulls = [];
  const files = {
    'docs.json': '{"name":"Smoke"}',
    'docs/index.mdx': '---\ntitle: Home\n---\n\n# Home\n',
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const p = url.pathname;
    if (p === `/repos/${repo}`) return send(200, { default_branch: 'main' });
    let m;
    if ((m = new RegExp(`^/repos/${repo}/git/ref/heads/(.+)$`).exec(p)))
      return branches.has(m[1])
        ? send(200, { object: { sha: branches.get(m[1]) } })
        : send(404, { message: 'Not Found' });
    if (p === `/repos/${repo}/pulls` && req.method === 'POST') {
      pulls.push(1);
      return send(201, {
        html_url: `http://mock/pull/${pulls.length}`,
        number: pulls.length,
      });
    }
    if (p === '/__state')
      return send(200, {
        branches: Object.fromEntries(branches),
        pulls: pulls.length,
        commits,
        files: Object.keys(files),
      });
    return send(404, { message: 'Not Found' });
  });
  return new Promise((resolve) =>
    server.listen(port, '0.0.0.0', () =>
      resolve({ server, port: server.address().port }),
    ),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = await startMockGitHub(Number(process.argv[2] ?? 4600));
  console.log(`mock github on ${port}`);
}
