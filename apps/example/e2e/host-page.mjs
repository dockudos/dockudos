// A page on another origin, standing in for the product that embeds the assistant. It listens on two ports: 4390
// is in `ai.allowedOrigins` of the example's docs.json, 4391 is not.
import { createServer } from 'node:http';

const page = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Acme app</title></head>
  <body>
    <main>
      <h1>Acme app</h1>
      <p>Your billing settings.</p>
    </main>
    <script src="http://localhost:4300/dockudos-widget.js" async data-hint="Billing settings" data-path="/guides/billing"></script>
  </body>
</html>`;

for (const port of [4390, 4391]) {
  createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page);
  }).listen(port, '127.0.0.1', () => console.log(`host page on ${port}`));
}
