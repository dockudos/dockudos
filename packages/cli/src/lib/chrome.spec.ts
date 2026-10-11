import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';

const calls: Record<string, unknown[]> = {};
const record = (name: string, ...args: unknown[]) => {
  (calls[name] ??= []).push(args);
};
let pdfFails = false;

vi.mock('playwright-core', () => {
  const page = {
    goto: async (...a: unknown[]) => record('goto', ...a),
    waitForSelector: async (...a: unknown[]) => record('wait', ...a),
    waitForLoadState: async () => {
      throw new Error('never idle');
    },
    emulateMedia: async (...a: unknown[]) => record('media', ...a),
    pdf: async (o: unknown) => {
      if (pdfFails) throw new Error('print failed');
      record('pdf', o);
      return new Uint8Array([1, 2]);
    },
  };
  const browser = {
    newContext: async (o: unknown) => {
      record('context', o);
      return { newPage: async () => page };
    },
    close: async () => record('close'),
  };
  return {
    chromium: {
      executablePath: () => '/nowhere/chromium',
      launch: async (o: unknown) => {
        record('launch', o);
        return browser;
      },
    },
  };
});

const { renderPdf } = await import('./chrome.ts');

let chrome: string;
let dir: string;
beforeEach(async () => {
  for (const k of Object.keys(calls)) delete calls[k];
  pdfFails = false;
  dir = await mkdtemp(join(tmpdir(), 'dockudos-chrome-'));
  chrome = join(dir, 'chrome');
  await writeFile(chrome, '');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const base = {
  url: 'http://x.test/print',
  pageSize: 'A4' as const,
  title: 'A & <B>',
  timeout: 1000,
  chrome: undefined as string | undefined,
};

describe('renderPdf', () => {
  it('prints the page and escapes the title in the footer', async () => {
    const pdf = await renderPdf({ ...base, chrome }, {});
    expect([...pdf]).toEqual([1, 2]);
    const options = calls['pdf'][0] as [{ footerTemplate: string }];
    expect(options[0].footerTemplate).toContain('A &#38; &#60;B&#62;');
    expect(calls['close']).toHaveLength(1);
    expect(calls['context'][0]).toEqual([{}]);
  });

  it('sends basic credentials', async () => {
    await renderPdf({ ...base, chrome, auth: { user: 'u', password: 'p' } }, {});
    expect(calls['context'][0]).toEqual([
      { httpCredentials: { username: 'u', password: 'p', send: 'always' } },
    ]);
  });

  it('sends a bearer token', async () => {
    await renderPdf({ ...base, chrome, auth: { token: 't' } }, {});
    expect(calls['context'][0]).toEqual([
      { extraHTTPHeaders: { authorization: 'Bearer t' } },
    ]);
  });

  it('closes the browser when printing fails', async () => {
    pdfFails = true;
    await expect(renderPdf({ ...base, chrome }, {})).rejects.toThrow(
      'print failed',
    );
    expect(calls['close']).toHaveLength(1);
  });

  it('passes --no-sandbox only as root', async () => {
    const uid = vi.spyOn(process, 'getuid').mockReturnValue(0);
    await renderPdf({ ...base, chrome }, {});
    uid.mockReturnValue(1000);
    await renderPdf({ ...base, chrome }, {});
    uid.mockRestore();
    const launches = calls['launch'] as [{ args: string[] }][];
    expect(launches[0][0].args).toEqual(['--no-sandbox']);
    expect(launches[1][0].args).toEqual([]);
  });
});
