import { expect, test } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

// Budgets for what the browser has to download. They are a little above today's sizes: a change that makes the
// page noticeably heavier fails here and has to say why.
const KB = 1024;
const PALETTE_CHUNK = 30 * KB; // gzipped; the chunk with the command palette (about 19 KB today)
const FIRST_LOAD = 300 * KB; // gzipped; all scripts a docs page loads (about 265 KB today)
const CLIENT_CHUNK = 40 * KB; // gzipped; the API client, fetched when a reader opens it

async function chunks(): Promise<{ file: string; text: string; gz: number }[]> {
  const dir = join(process.cwd(), '.next', 'static', 'chunks');
  const out = [];
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.js')) continue;
    const text = await readFile(join(dir, name), 'utf8');
    out.push({ file: name, text, gz: gzipSync(text).length });
  }
  return out;
}

test.describe('what the browser downloads', () => {
  test('the command palette chunk stays small, and the assistant is not part of it', async () => {
    const all = await chunks();
    const palette = all.filter((c) => c.text.includes('dockudos:palette'));
    expect(palette.length).toBeGreaterThan(0);
    for (const c of palette) {
      expect(
        c.gz,
        `${c.file} is ${(c.gz / KB).toFixed(1)} KB gzipped`,
      ).toBeLessThan(PALETTE_CHUNK);
      // The conversation, answer renderer and stream reader load when someone asks.
      expect(c.text, c.file).not.toContain('Looking through the docs');
    }
    const assistant = all.filter((c) =>
      c.text.includes('Looking through the docs'),
    );
    expect(assistant.length).toBeGreaterThan(0);
  });

  test('the API client is a chunk of its own, and no page loads it to begin with', async ({
    request,
  }) => {
    const all = await chunks();
    // A string only the client has in it: its empty state.
    const client = all.filter((c) => c.text.includes('Nothing saved yet'));
    expect(client.length).toBeGreaterThan(0);
    for (const c of client) {
      expect(
        c.gz,
        `${c.file} is ${(c.gz / KB).toFixed(1)} KB gzipped`,
      ).toBeLessThan(CLIENT_CHUNK);
      // The storage layer and the import converters belong to the client, not to an endpoint page.
      expect(c.text, c.file).toContain('dockudos-api-client');
    }
    // No page asks for it up front: not a guide, and not an endpoint page with the playground on it.
    for (const path of [
      '/guides/hello',
      '/api-reference/pet/getpetbyid',
    ]) {
      const html = await (await request.get(path)).text();
      const scripts = new Set(
        [...html.matchAll(/\/_next\/static\/[^"']+\.js/g)].map((m) => m[0]),
      );
      for (const c of client) {
        expect(
          [...scripts].some((s) => s.endsWith(c.file)),
          `${path} loads ${c.file}`,
        ).toBe(false);
      }
    }
  });

  test('the config schema and the answer pipeline stay on the server', async () => {
    for (const c of await chunks()) {
      expect(c.text, c.file).not.toContain('ZodError');
      // The server side of the assistant: prompt building and rate limits.
      expect(c.text, c.file).not.toContain('NO_ANSWER');
      expect(c.text, c.file).not.toContain('createRateLimiter');
    }
  });

  test('a docs page loads no more script than the budget', async ({
    request,
  }) => {
    const html = await (await request.get('/guides/hello')).text();
    const scripts = [
      ...new Set(
        [...html.matchAll(/\/_next\/static\/[^"']+\.js/g)].map((m) => m[0]),
      ),
    ];
    expect(scripts.length).toBeGreaterThan(3);
    let total = 0;
    for (const src of scripts) {
      const body = await (
        await request.get(src, { headers: { 'accept-encoding': 'identity' } })
      ).body();
      total += gzipSync(body).length;
    }
    expect(
      total,
      `first load is ${(total / KB).toFixed(0)} KB gzipped`,
    ).toBeLessThan(FIRST_LOAD);
  });
});
