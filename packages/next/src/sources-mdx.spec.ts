import { compile } from '@mdx-js/mdx';
import {
  convertHtmlFiles,
  convertVault,
  createRemoteSource,
  createSanitySource,
  mdxSafe,
} from '@dockudos/core';
import remarkDirective from 'remark-directive';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkAdmonitions from './mdx/remark-admonitions.ts';

/** Imported content is written by someone else. Whatever it says, it must compile and must not become code. */
const HOSTILE = [
  'Plain text with {braces} and <angle> brackets and <https://autolink.example>.',
  'import { x } from "evil"\n\nexport const y = 1\n\n{process.exit(1)}',
  '<script>alert(1)</script>\n\n<Component prop={fetch("//evil")} />',
  '<div>\n\n# unclosed',
  '```js\n{not: "touched"}\n```\n\nAfter {fence}',
  '`inline {code}` and {outside}',
  '> [!warning] Careful {now}\n> body <b>',
  '[link](javascript:alert(1)) and ![img](data:text/html,x)',
  '{/* a comment */} and <!-- html comment -->',
  '| a | b |\n|---|---|\n| {x} | <y> |',
];

async function compiles(source: string) {
  const out = await compile(source, {
    jsx: true,
    remarkPlugins: [
      remarkFrontmatter,
      remarkGfm,
      remarkDirective,
      remarkAdmonitions,
    ],
  });
  return String(out);
}

/**
 * What would run: the compiled output with the text of the page (string literals) taken out, so what remains is code.
 * Imported text may mention `fetch(` as words; it must never be a call.
 */
const stripStrings = (js: string) =>
  js.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
const runs = (js: string) =>
  /process\.exit|fetch\(|alert\(1\)|from\s*""|export const y/.test(
    stripStrings(js),
  ) || /\b(?:href|src)"?\s*[=:]\s*"(?:javascript|data|vbscript):/i.test(js);

describe('imported content compiles as MDX and stays inert', () => {
  for (const [i, body] of HOSTILE.entries()) {
    it(`hostile sample ${i + 1}`, async () => {
      expect(runs(await compiles(mdxSafe(body)))).toBe(false);
    });
  }

  it('converted Obsidian notes, HTML and remote pages compile', async () => {
    const vault = convertVault(
      HOSTILE.map((content, i) => ({
        path: `Note ${i}.md`,
        content: `---\ntitle: T${i}\ndate: not a date\n---\n${content}`,
      })),
    );
    for (const f of vault)
      expect(runs(await compiles(f.content as string)), f.path).toBe(false);

    const html = convertHtmlFiles(
      HOSTILE.map((content, i) => ({
        path: `p${i}.html`,
        content: `<html><body><main><h1>T</h1><p>${content.replace(/\n/g, '<br>')}</p></main></body></html>`,
      })),
    );
    for (const f of html)
      expect(runs(await compiles(f.content as string)), f.path).toBe(false);

    const files = await createRemoteSource({
      name: 'r',
      url: 'https://x.io/l',
      fetch: (async (u: string | URL | Request) => {
        const url = String(u);
        if (url.endsWith('/l'))
          return Response.json(
            HOSTILE.map((_, i) => ({
              path: `p${i}.mdx`,
              url: `https://x.io/${i}`,
            })),
          );
        return new Response(HOSTILE[Number(url.split('/').pop())]);
      }) as typeof fetch,
    }).read();
    for (const f of files)
      expect(runs(await compiles(f.content as string)), f.path).toBe(false);
  });

  it('converted CMS documents compile', async () => {
    const query = 'q';
    const files = await createSanitySource({
      name: 's',
      projectId: 'p1',
      dataset: 'd',
      query,
      fetch: (async () =>
        Response.json({
          result: HOSTILE.map((body, i) => ({
            title: `T${i}`,
            slug: `s${i}`,
            body:
              i % 2 ? body : [{ _type: 'block', children: [{ text: body }] }],
          })),
        })) as typeof fetch,
    }).read();
    for (const f of files)
      expect(runs(await compiles(f.content as string)), f.path).toBe(false);
  });

  it('shows why the escaping is needed: raw hostile text does not compile or does run', async () => {
    await expect(compiles(HOSTILE[0] as string)).rejects.toThrow();
    expect(runs(await compiles('import { x } from "evil"\n\nHi'))).toBe(true);
    expect(runs(await compiles(HOSTILE[7] as string))).toBe(true);
  });
});
