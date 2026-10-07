import type { AskSource } from '@dockudos/core';
import { Fragment, type ReactNode } from 'react';

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[(\d+(?:\s*,\s*\d+)*)\])/g;

/**
 * The answer text as React elements: paragraphs, lists, code, bold, and `[n]` as links to the sources.
 * It builds elements and never HTML, and the only links are the ones to a source the answer was written
 * from: anything else the model writes, including addresses and images, shows as plain text.
 */
export function AnswerText({
  text,
  sources,
  onNavigate,
}: {
  text: string;
  sources: readonly AskSource[];
  /** Called when a citation is followed, so a dialog can close. */
  onNavigate?: (url: string) => void;
}) {
  const byNumber = new Map(sources.map((s) => [s.n, s]));

  const inline = (line: string, key: string): ReactNode[] => {
    const out: ReactNode[] = [];
    let at = 0;
    for (const m of line.matchAll(INLINE)) {
      const index = m.index ?? 0;
      if (index > at) out.push(line.slice(at, index));
      if (m[1]) out.push(<code key={`${key}-${index}`}>{m[1].slice(1, -1)}</code>);
      else if (m[2]) out.push(<strong key={`${key}-${index}`}>{m[2].slice(2, -2)}</strong>);
      else if (m[4]) {
        const numbers = m[4].split(',').map((n) => Number(n.trim()));
        const links = numbers.flatMap((n) => {
          const source = byNumber.get(n);
          return source ? [source] : [];
        });
        if (links.length === 0) out.push(m[3]);
        else
          out.push(
            <Fragment key={`${key}-${index}`}>
              {links.map((source) => (
                <a
                  key={source.n}
                  href={source.url}
                  className="dk-citation mx-0.5 inline-flex min-w-[1.25rem] justify-center rounded bg-primary/15 px-1 align-baseline text-xs font-medium text-primary no-underline hover:bg-primary/25 focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Source ${source.n}: ${[source.title, ...source.headingPath].join(', ')}`}
                  onClick={(e) => {
                    if (!onNavigate || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    onNavigate(source.url);
                  }}
                >
                  {source.n}
                </a>
              ))}
            </Fragment>,
          );
      }
      at = index + m[0].length;
    }
    if (at < line.length) out.push(line.slice(at));
    return out;
  };

  const blocks: ReactNode[] = [];
  const parts = text.split(/(^|\n)```[^\n]*\n([\s\S]*?)(?:\n```|$)/g);
  // split with two capture groups yields [text, sep, code, text, sep, code, ...]
  for (let i = 0; i < parts.length; i += 3) {
    const prose = parts[i] ?? '';
    const code = parts[i + 2];
    const paragraphs = prose.split(/\n{2,}/).filter((p) => p.trim());
    paragraphs.forEach((paragraph, p) => {
      const lines = paragraph.split('\n').filter((l) => l.trim() !== '');
      const list = lines.every((l) => /^\s*(?:[-*]|\d+[.)])\s+/.test(l));
      if (list) {
        const ordered = /^\s*\d/.test(lines[0] ?? '');
        const items = lines.map((l, n) => (
          <li key={n}>{inline(l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, ''), `${i}-${p}-${n}`)}</li>
        ));
        blocks.push(
          ordered ? (
            <ol key={`${i}-${p}`} className="my-2 list-decimal pl-5">{items}</ol>
          ) : (
            <ul key={`${i}-${p}`} className="my-2 list-disc pl-5">{items}</ul>
          ),
        );
      } else {
        blocks.push(
          <p key={`${i}-${p}`} className="my-2 first:mt-0 last:mb-0">
            {lines.map((l, n) => (
              <Fragment key={n}>
                {n > 0 && <br />}
                {inline(l, `${i}-${p}-${n}`)}
              </Fragment>
            ))}
          </p>,
        );
      }
    });
    if (code !== undefined)
      blocks.push(
        <pre
          key={`${i}-code`}
          className="my-2 overflow-x-auto rounded-md bg-muted p-3 text-xs"
          tabIndex={0}
        >
          <code>{code}</code>
        </pre>,
      );
  }
  return <>{blocks}</>;
}
