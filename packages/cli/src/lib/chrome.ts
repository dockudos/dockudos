import { access } from 'node:fs/promises';
import { CliError, type PdfOptions } from './io.ts';

const CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

/** The browser to print with: the `--chrome` flag, `CHROME_PATH`, Playwright's own, or one that is installed. */
export async function findChrome(
  explicit: string | undefined,
  vars: Record<string, string | undefined>,
  playwrightPath?: () => string,
): Promise<string> {
  for (const file of [explicit, vars['CHROME_PATH']]) {
    if (file) {
      if (await exists(file)) return file;
      throw new CliError(`Chrome was not found at ${file}.`);
    }
  }
  try {
    const own = playwrightPath?.();
    if (own && (await exists(own))) return own;
  } catch {
    // Playwright has no browser installed: look elsewhere
  }
  for (const file of CANDIDATES) if (await exists(file)) return file;
  throw new CliError(
    'No Chrome or Chromium found to print with. Install one, point CHROME_PATH (or --chrome) at it, or run `npx playwright install chromium`.',
  );
}

const footer = (title: string) =>
  `<div style="width:100%;font-size:8px;color:#666;padding:0 16mm;display:flex;justify-content:space-between;font-family:sans-serif">
     <span>${title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</span>
     <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
   </div>`;

/** Print `options.url` to PDF with headless Chrome. The page must set `data-book-ready` on `<body>`. */
export async function renderPdf(
  options: PdfOptions,
  vars: Record<string, string | undefined> = process.env,
): Promise<Uint8Array> {
  const { chromium } = await import('playwright-core');
  const executablePath = await findChrome(options.chrome, vars, () =>
    chromium.executablePath(),
  );
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const browser = await chromium.launch({
    executablePath,
    args: asRoot ? ['--no-sandbox'] : [],
  });
  try {
    const page = await browser.newPage();
    await page.goto(options.url, {
      waitUntil: 'load',
      timeout: options.timeout,
    });
    await page.waitForSelector('body[data-book-ready="1"]', {
      state: 'attached',
      timeout: options.timeout,
    });
    // Images and diagrams load lazily or render after the page does.
    await page
      .waitForLoadState('networkidle', { timeout: options.timeout })
      .catch(() => undefined);
    await page.emulateMedia({ media: 'print' });
    return await page.pdf({
      format: options.pageSize,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footer(options.title),
      margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
      outline: true,
      tagged: true,
    });
  } finally {
    await browser.close();
  }
}
