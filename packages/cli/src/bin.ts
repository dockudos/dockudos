#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync, watch } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { type Env } from './lib/io.ts';
import { run } from './lib/run.ts';

const version = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../package.json', import.meta.url)),
      'utf8',
    ),
  ) as { version: string }
).version;

const env: Env = {
  cwd: process.cwd(),
  vars: process.env,
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  interactive: process.stdin.isTTY === true,
  async ask(question, fallback) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      const answer = (await rl.question(`${question} (${fallback}): `)).trim();
      return answer || fallback;
    } finally {
      rl.close();
    }
  },
  spawn,
  watch: (path, onChange) => watch(path, onChange),
};

process.exitCode = await run(process.argv.slice(2), env, version);
