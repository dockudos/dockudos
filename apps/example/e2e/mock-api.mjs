// A small stand-in for the Petstore API the playground tries. Port 4398 allows the docs site's origin (CORS) and
// records what it was sent (GET /__calls, DELETE /__calls to clear). Port 4397 answers the same but never sends CORS
// headers, so a browser refuses to show its answers: the playground must explain that.
import { createServer } from 'node:http';

const calls = [];
const pets = new Map([
  [
    1,
    {
      id: 1,
      name: 'Rex',
      category: { id: 1, name: 'Dogs' },
      photoUrls: [],
      status: 'available',
    },
  ],
]);

function handler(cors) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const headers = {};
    if (cors) {
      headers['access-control-allow-origin'] = req.headers.origin ?? '*';
      headers['access-control-allow-methods'] = 'GET,POST,PUT,DELETE,OPTIONS';
      headers['access-control-allow-headers'] =
        req.headers['access-control-request-headers'] ?? '*';
      headers['access-control-expose-headers'] = 'x-mock';
    }
    headers['x-mock'] = cors ? 'cors' : 'no-cors';
    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers).end();
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString('utf8');
    if (url.pathname === '/__calls') {
      if (req.method === 'DELETE') calls.length = 0;
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      });
      res.end(JSON.stringify(calls));
      return;
    }
    calls.push({
      method: req.method,
      path: url.pathname + url.search,
      headers: req.headers,
      body,
    });

    const json = (status, value) => {
      res.writeHead(status, { ...headers, 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    const pet = /^\/api\/v3\/pet\/(\d+)$/.exec(url.pathname);
    if (req.method === 'GET' && pet) {
      const found = pets.get(Number(pet[1]));
      return found
        ? json(200, found)
        : json(404, { code: 1, type: 'error', message: 'Pet not found' });
    }
    if (req.method === 'GET' && url.pathname === '/api/v3/pet/findByStatus') {
      const status = url.searchParams.get('status') ?? 'available';
      return json(
        200,
        [...pets.values()].filter((p) => p.status === status),
      );
    }
    if (req.method === 'POST' && url.pathname === '/api/v3/pet') {
      let created;
      try {
        created = JSON.parse(body);
      } catch {
        return json(400, { message: 'Invalid JSON' });
      }
      pets.set(created.id ?? pets.size + 1, created);
      return json(200, created);
    }
    json(404, { message: `No mock for ${req.method} ${url.pathname}` });
  };
}

createServer(handler(true)).listen(4398, '127.0.0.1');
createServer(handler(false)).listen(4397, '127.0.0.1');
