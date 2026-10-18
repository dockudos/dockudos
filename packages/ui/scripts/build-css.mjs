// Compiles Tailwind and the dockudos styles into one stylesheet, so sites using
// @dockudos/ui need no Tailwind setup of their own.
import tailwind from '@tailwindcss/postcss';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const from = new URL('../src/styles/dockudos.css', import.meta.url);
const to = new URL('../dist/styles.css', import.meta.url);

const css = await readFile(from, 'utf8');
const result = await postcss([
  tailwind({ optimize: { minify: true } }),
]).process(css, {
  // Real paths, not URL pathnames: on Windows a pathname starts with a slash and the resolver doubles the drive.
  from: fileURLToPath(from),
  to: fileURLToPath(to),
});
await mkdir(new URL('./', to), { recursive: true });
await writeFile(to, result.css);
console.log(
  `wrote ${fileURLToPath(to)} (${(result.css.length / 1024).toFixed(1)} kB)`,
);
