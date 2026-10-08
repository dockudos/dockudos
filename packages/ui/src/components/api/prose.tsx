import { Fragment, type ReactNode } from 'react';

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|((?<![\w*])\*[^*\s][^*]*\*(?!\w))|(https?:\/\/[^\s<)]+)/g;
const SAFE_URL = /^(?:https?:\/\/|mailto:|\/|#)/i;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const [token] = m;
    if (m[1]) out.push(<code key={key++}>{token.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else if (m[3]) {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      out.push(
        SAFE_URL.test(href) ? (
          <a key={key++} href={href}>
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else if (m[4]) out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    else out.push(<a key={key++} href={token}>{token}</a>);
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

/**
 * Text from a spec: paragraphs, lists, code, `code`, **bold**, *italic* and links. Anything else, HTML included, is
 * shown as the text it is: the text is not trusted, so it never becomes markup.
 */
export function Prose({ text, className }: { text?: string; className?: string }) {
  if (!text?.trim()) return null;
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (!line.trim()) {
      i++;
    } else if (/^\s*(```|~~~)/.test(line)) {
      const fence = /^\s*(```|~~~)/.exec(line)?.[1] as string;
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] as string).trimStart().startsWith(fence)) code.push(lines[i++] as string);
      i++;
      blocks.push(
        <pre key={key++} className="dk-api-prose-code">
          <code>{code.join('\n')}</code>
        </pre>,
      );
    } else if (LIST_ITEM.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && LIST_ITEM.test(lines[i] as string)) {
        items.push((lines[i++] as string).replace(LIST_ITEM, ''));
      }
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(
        <Tag key={key++}>
          {items.map((item, n) => (
            <li key={n}>{inline(item)}</li>
          ))}
        </Tag>,
      );
    } else {
      const para: string[] = [];
      while (
        i < lines.length &&
        (lines[i] as string).trim() &&
        !/^\s*(```|~~~)/.test(lines[i] as string) &&
        !LIST_ITEM.test(lines[i] as string)
      ) {
        para.push((lines[i++] as string).replace(/^#{1,6}\s+/, ''));
      }
      blocks.push(
        <p key={key++}>
          {para.map((l, n) => (
            <Fragment key={n}>
              {n > 0 && ' '}
              {inline(l.trim())}
            </Fragment>
          ))}
        </p>,
      );
    }
  }
  return <div className={className ?? 'dk-api-prose'}>{blocks}</div>;
}
