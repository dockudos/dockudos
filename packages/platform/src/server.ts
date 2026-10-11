#!/usr/bin/env node
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { backup, createFsSink, restore } from './lib/backup.ts';
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
  if (migrated.length)
    platform.log.info('migrations applied', { ids: migrated });

  // Operator commands: `server.js migrate` (apply migrations, exit) and `server.js bootstrap <team name>` (print an admin API key).
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'migrate') {
    process.stdout.write(`${JSON.stringify({ applied: migrated })}\n`);
    await platform.stop();
    process.exit(0);
  }
  if (command === 'backup' || command === 'restore') {
    const dir = rest[0];
    if (!dir) {
      process.stderr.write(`Usage: server.js ${command} <directory>\n`);
      process.exit(64);
    }
    const sink = createFsSink(dir);
    const manifest =
      command === 'backup'
        ? await backup(platform.db, platform.storage, sink)
        : await restore(platform.db, platform.storage, sink);
    process.stdout.write(
      `${JSON.stringify({ [command]: 'ok', createdAt: manifest.createdAt, tables: Object.fromEntries(Object.entries(manifest.tables).map(([t, v]) => [t, v.rows])), objects: manifest.objects.count })}\n`,
    );
    await platform.stop();
    process.exit(0);
  }
  if (command === 'bootstrap') {
    const { team, secret } = await platform.auth.bootstrap(
      rest.join(' ') || 'Default',
    );
    process.stdout.write(
      `${JSON.stringify({ team: team.slug, apiKey: secret })}\n`,
    );
    await platform.stop();
    process.exit(0);
  }
  if (command) {
    process.stderr.write(
      `Unknown command "${command}". Use: migrate | bootstrap <team name> | (none, to run the server)\n`,
    );
    process.exit(64);
  }

  const server = createServer(async (incoming, outgoing) => {
    const host = incoming.headers.host ?? 'localhost';
    const url = new URL(
      incoming.url ?? '/',
      `${config.publicUrl.startsWith('https') ? 'https' : 'http'}://${host}`,
    );
    const method = incoming.method ?? 'GET';
    const body =
      method === 'GET' || method === 'HEAD'
        ? undefined
        : (Readable.toWeb(incoming) as ReadableStream);
    const headers = new Headers();
    for (const [k, v] of Object.entries(incoming.headers))
      if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const request = new Request(url, {
      method,
      headers,
      ...(body && ({ body, duplex: 'half' } as object)),
    });
    const response = await platform.handler(request, {
      ip: incoming.socket.remoteAddress ?? '',
    });
    const out: Record<string, string | string[]> = {};
    response.headers.forEach((v, k) => {
      if (k !== 'set-cookie') out[k] = v;
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) out['set-cookie'] = cookies;
    outgoing.writeHead(response.status, out);
    if (method === 'HEAD' || !response.body) return void outgoing.end();
    Readable.fromWeb(response.body as never).pipe(outgoing);
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 20_000;
  server.keepAliveTimeout = 65_000;
  server.listen(config.port, '0.0.0.0', () =>
    platform.log.info('listening', {
      port: config.port,
      services: config.services,
    }),
  );
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
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
