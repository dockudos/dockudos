#!/usr/bin/env node
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { ConfigError, loadConfig } from './lib/config.ts';
import { createPlatform } from './lib/runtime.ts';

/** The platform process. Which roles it plays comes from `DOCKUDOS_SERVICES`; every role is the same program. */
async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(78);
    }
    throw error;
  }
  const platform = await createPlatform(config);
  const migrated = await platform.migrate();
  if (migrated.length) platform.log.info('migrations applied', { ids: migrated });

  const server = createServer(async (incoming, outgoing) => {
    const host = incoming.headers.host ?? 'localhost';
    const url = new URL(incoming.url ?? '/', `${config.publicUrl.startsWith('https') ? 'https' : 'http'}://${host}`);
    const method = incoming.method ?? 'GET';
    const body = method === 'GET' || method === 'HEAD' ? undefined : (Readable.toWeb(incoming) as ReadableStream);
    const headers = new Headers();
    for (const [k, v] of Object.entries(incoming.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const request = new Request(url, { method, headers, ...(body && { body, duplex: 'half' } as object) });
    const response = await platform.handler(request, { ip: incoming.socket.remoteAddress ?? '' });
    const out: Record<string, string | string[]> = {};
    response.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) out['set-cookie'] = cookies;
    outgoing.writeHead(response.status, out);
    if (method === 'HEAD' || !response.body) return void outgoing.end();
    Readable.fromWeb(response.body as never).pipe(outgoing);
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 20_000;
  server.keepAliveTimeout = 65_000;
  server.listen(config.port, '0.0.0.0', () => platform.log.info('listening', { port: config.port, services: config.services }));
  platform.start();

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    platform.log.info('shutting down', { signal });
    server.close();
    await platform.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
