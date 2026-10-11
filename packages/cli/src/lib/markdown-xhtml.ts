import { headingSlugger } from '@dockudos/core';

export const escapeXml = (s: string): string =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export interface XhtmlOptions {
  /** Where a link goes in the book, or `undefined` to show its text without a link. */
  link(href: string): string | undefined;
  /** An image's address in the book, or `undefined` to show its alt text instead. */
  image(src: string): string | undefined;
}

const TOKEN =
  /\\([\\`*_{}[\]()#+\-.!|~<>])|(`+)([\s\S]*?[^`])\2(?!`)|!\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\s*\)|\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\s*\)|<(https?:\/\/[^>\s]+)>|\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__|\*(?=\S)([\s\S]*?\S)\*|\b_(?=\S)([\s\S]*?\S)_\b|~~(?=\S)([\s\S]*?\S)~~| {2,}\n|\n/g;

const unwrap = (u: string) =>
  u.startsWith('<') && u.endsWith('>') ? u.slice(1, -1) : u;

/** Inline Markdown as XHTML. Everything not recognized is text, and text is always escaped. */
export function inlineToXhtml(
  text: string,
  o: XhtmlOptions,
  inLink = false,
): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    out += escapeXml(text.slice(last, m.index));
    last = (m.index as number) + m[0].length;
    if (m[1] !== undefined) out += escapeXml(m[1]);
    else if (m[3] !== undefined)
      out += `<code>${escapeXml(m[3].trim())}</code>`;
    else if (m[4] !== undefined) {
      const src = o.image(unwrap(m[5] as string));
      out += src
        ? `<img src="${escapeXml(src)}" alt="${escapeXml(m[4])}"/>`
        : escapeXml(m[4]);
    } else if (m[6] !== undefined) {
      const inner = inlineToXhtml(m[6], o, true);
      const href = inLink ? undefined : o.link(unwrap(m[7] as string));
      out += href ? `<a href="${escapeXml(href)}">${inner}</a>` : inner;
    } else if (m[8] !== undefined) {
      const href = inLink ? undefined : o.link(m[8]);
      out += href
        ? `<a href="${escapeXml(href)}">${escapeXml(m[8])}</a>`
        : escapeXml(m[8]);
    } else if (m[9] !== undefined || m[10] !== undefined)
      out += `<strong>${inlineToXhtml((m[9] ?? m[10]) as string, o, inLink)}</strong>`;
    else if (m[11] !== undefined || m[12] !== undefined)
      out += `<em>${inlineToXhtml((m[11] ?? m[12]) as string, o, inLink)}</em>`;
    else if (m[13] !== undefined)
      out += `<del>${inlineToXhtml(m[13], o, inLink)}</del>`;
    else out += m[0] === '\n' ? '\n' : '<br/>\n';
  }
  return out + escapeXml(text.slice(last));
}

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  const parts = line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/);
  return parts.map((c) => c.replace(/\\\|/g, '|').trim());
}

/**
 * Markdown as well-formed XHTML (EPUB readers refuse anything else): headings with ids, paragraphs, lists (nested,
 * task lists), block quotes, fenced code, tables, rules. The Markdown is what `readPageMarkdown` writes, so this
 * covers GitHub-style Markdown and not every corner of it. Raw HTML is shown as text, never passed through.
 */
export function markdownToXhtml(markdown: string, o: XhtmlOptions): string {
  const slug = headingSlugger();
  const inline = (t: string) => inlineToXhtml(t, o);

  function blocks(lines: string[]): string {
    const out: string[] = [];
    let i = 0;
    const isBlockStart = (line: string) =>
      FENCE.test(line) ||
      HEADING.test(line) ||
      RULE.test(line) ||
      /^\s{0,3}>/.test(line) ||
      ITEM.test(line);

    while (i < lines.length) {
      const line = lines[i] as string;
      if (!line.trim()) {
        i++;
        continue;
      }
      const fence = FENCE.exec(line);
      if (fence) {
        const marker = fence[1] as string;
        const body: string[] = [];
        for (
          i++;
          i < lines.length &&
          !new RegExp(
            `^\\s*${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`,
          ).test(lines[i] as string);
          i++
        )
          body.push(lines[i] as string);
        i++; // the closing fence, if there is one
        const lang = fence[2] ? ` class="language-${escapeXml(fence[2])}"` : '';
        out.push(
          `<pre><code${lang}>${escapeXml(body.join('\n'))}</code></pre>`,
        );
        continue;
      }
      const heading = HEADING.exec(line);
      if (heading) {
        const level = (heading[1] as string).length;
        const text = heading[2] as string;
        out.push(
          `<h${level} id="${escapeXml(slug(text.replace(/[*_`[\]]/g, '')))}">${inline(text)}</h${level}>`,
        );
        i++;
        continue;
      }
      if (RULE.test(line)) {
        out.push('<hr/>');
        i++;
        continue;
      }
      if (/^\s{0,3}>/.test(line)) {
        const quoted: string[] = [];
        for (; i < lines.length && /^\s{0,3}>/.test(lines[i] as string); i++)
          quoted.push((lines[i] as string).replace(/^\s{0,3}> ?/, ''));
        out.push(`<blockquote>${blocks(quoted)}</blockquote>`);
        continue;
      }
      if (
        i + 1 < lines.length &&
        line.includes('|') &&
        TABLE_RULE.test(lines[i + 1] as string) &&
        (lines[i + 1] as string).includes('-')
      ) {
        const head = cells(line);
        const rows: string[][] = [];
        for (
          i += 2;
          i < lines.length &&
          (lines[i] as string).includes('|') &&
          (lines[i] as string).trim();
          i++
        )
          rows.push(cells(lines[i] as string));
        const row = (r: string[], tag: string) =>
          `<tr>${head.map((_, k) => `<${tag}>${inline(r[k] ?? '')}</${tag}>`).join('')}</tr>`;
        out.push(
          `<table><thead>${row(head, 'th')}</thead><tbody>${rows.map((r) => row(r, 'td')).join('')}</tbody></table>`,
        );
        continue;
      }
      const item = ITEM.exec(line);
      if (item) {
        const ordered = /\d/.test(item[2] as string);
        const indent = (item[1] as string).length;
        const items: string[][] = [];
        while (i < lines.length) {
          const here = lines[i] as string;
          const m = ITEM.exec(here);
          if (
            m &&
            (m[1] as string).length === indent &&
            /\d/.test(m[2] as string) === ordered
          ) {
            items.push([m[3] as string]);
            i++;
          } else if (!here.trim()) {
            // A blank line continues the list only when more of it follows.
            const next = lines.slice(i + 1).find((l) => l.trim());
            const nextItem = next && ITEM.exec(next);
            if (nextItem && (nextItem[1] as string).length >= indent) {
              (items.at(-1) as string[]).push('');
              i++;
            } else break;
          } else if (
            items.length &&
            (here.match(/^\s*/) as RegExpMatchArray)[0].length > indent
          ) {
            // Continuation or nested content: remove the item's indent.
            (items.at(-1) as string[]).push(
              here.slice(
                Math.min(
                  indent + 2,
                  (here.match(/^\s*/) as RegExpMatchArray)[0].length,
                ),
              ),
            );
            i++;
          } else break;
        }
        const tag = ordered ? 'ol' : 'ul';
        out.push(
          `<${tag}>${items
            .map((parts) => {
              const [head = '', ...rest] = parts;
              let first = head;
              let box = '';
              const task = /^\[([ xX])\]\s+/.exec(first);
              if (task) {
                box = task[1] === ' ' ? '☐ ' : '☑ ';
                first = first.slice(task[0].length);
              }
              const body = blocks([first, ...rest]);
              // A tight item is its text, not a paragraph in a bullet.
              const tight = /^<p>([\s\S]*?)<\/p>(?=$|\n<(?:ul|ol)>)/.exec(body);
              return `<li>${box}${tight ? `${tight[1]}${body.slice(tight[0].length).replace(/^\n/, '')}` : body}</li>`;
            })
            .join('')}</${tag}>`,
        );
        continue;
      }
      const para: string[] = [];
      for (
        ;
        i < lines.length &&
        (lines[i] as string).trim() &&
        (para.length === 0 || !isBlockStart(lines[i] as string));
        i++
      )
        para.push((lines[i] as string).replace(/^\s+/, ''));
      out.push(`<p>${inline(para.join('\n'))}</p>`);
    }
    return out.join('\n');
  }

  return blocks(
    markdown.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'),
  );
}
