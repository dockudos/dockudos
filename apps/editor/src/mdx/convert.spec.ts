import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type PM, parseMdx, serializeMdx } from './convert.ts';

const root = join(import.meta.dirname, '../../../docs/docs');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.mdx?$/.test(f) ? [p] : [];
  });
}
const corpus = files(root);

describe('round trip over the real docs', () => {
  it('has a corpus to test', () => expect(corpus.length).toBeGreaterThan(100));

  it('parse -> serialize -> parse gives the same document for every page', () => {
    const failures: string[] = [];
    for (const f of corpus) {
      const src = readFileSync(f, 'utf8');
      try {
        const a = parseMdx(src);
        const b = parseMdx(serializeMdx(a));
        if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(f);
      } catch (e) {
        failures.push(`${f}: ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('writes an unedited page back byte for byte', () => {
    const changed = corpus.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return serializeMdx(parseMdx(src)) !== src;
    });
    expect(changed).toEqual([]);
  });
});

const SAMPLE = `---
title: "Hello"
---


# Title

Some *text* with [a link](/x) and \`code\`.

<Callout type="info" note={{
    a: 1,
  }}>

Inside **bold**.

</Callout>

- one
- two

| A | B |
|---|---|
| 1 | 2 |

:::note[Keep]
brackets
:::

import X from './x'
`;

const find = (n: PM, pred: (n: PM) => boolean): PM | undefined =>
  pred(n) ? n : n.content?.map((c) => find(c, pred)).find(Boolean);

describe('editing', () => {
  it('changes only the block that was edited', () => {
    const page = parseMdx(SAMPLE);
    const para = page.doc.content!.find((n) => n.type === 'paragraph')!;
    para.content = [{ type: 'text', text: 'Rewritten.' }];
    const out = serializeMdx(page);
    expect(out).toBe(
      SAMPLE.replace(
        /Some \*text\* with \[a link\]\(\/x\) and `code`\./,
        'Rewritten.',
      ),
    );
  });

  it('keeps the tag text of a component, including multi-line attributes, when its content changes', () => {
    const page = parseMdx(SAMPLE);
    const jsx = find(page.doc, (n) => n.type === 'jsxBlock')!;
    expect(jsx.attrs!['open']).toBe(
      '<Callout type="info" note={{\n    a: 1,\n  }}>',
    );
    jsx.content = [
      { type: 'paragraph', content: [{ type: 'text', text: 'New body' }] },
    ];
    const out = serializeMdx(page);
    expect(out).toContain(
      '<Callout type="info" note={{\n    a: 1,\n  }}>\n\nNew body\n\n</Callout>',
    );
    // The blocks around it are untouched.
    expect(out).toContain('# Title\n\nSome *text*');
    expect(out.endsWith("import X from './x'\n")).toBe(true);
  });

  it('adds, removes and reorders blocks', () => {
    const page = parseMdx(SAMPLE);
    page.doc.content!.splice(1, 0, {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Added.' }],
    });
    page.doc.content!.splice(
      page.doc.content!.findIndex((n) => n.type === 'table'),
      1,
    );
    const out = serializeMdx(page);
    expect(out).toContain('# Title\n\nAdded.\n\nSome *text*');
    expect(out).not.toContain('| A |');
    expect(parseMdx(out).doc.content!.map((n) => n.type)).toEqual([
      'heading',
      'paragraph',
      'paragraph',
      'jsxBlock',
      'bulletList',
      'paragraph',
      'rawBlock',
    ]);
  });

  it('writes marks, links and lists the editor makes', () => {
    const page = parseMdx('x\n');
    page.doc.content = [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Head' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'a ', marks: [] },
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' ' },
          {
            type: 'text',
            text: 'both',
            marks: [{ type: 'italic' }, { type: 'bold' }],
          },
          { type: 'text', text: ' ' },
          {
            type: 'text',
            text: 'link',
            marks: [
              { type: 'link', attrs: { href: '/p', title: null } },
              { type: 'bold' },
            ],
          },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'c', marks: [{ type: 'code' }] },
          { type: 'hardBreak' },
          {
            type: 'image',
            attrs: { src: '/media/a.png', alt: 'A', title: null },
          },
        ],
      },
      {
        type: 'orderedList',
        attrs: { start: 3, spread: false },
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
            ],
          },
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'y' }] },
            ],
          },
        ],
      },
      {
        type: 'codeBlock',
        attrs: { language: 'ts', meta: 'title="a.ts"' },
        content: [{ type: 'text', text: 'const a = 1;' }],
      },
      {
        type: 'blockquote',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'q' }] },
        ],
      },
      { type: 'horizontalRule' },
    ];
    expect(serializeMdx(page)).toBe(
      '## Head\n\na **bold** **_both_** [**link**](/p) `c`\\\n![A](/media/a.png)\n\n3. x\n4. y\n\n```ts title="a.ts"\nconst a = 1;\n```\n\n> q\n\n---\n',
    );
  });

  it('keeps the container syntax when its paragraph is edited elsewhere', () => {
    const page = parseMdx(':::note[Title]\nbody `x`\n:::\n');
    const p = page.doc.content![0]!;
    p.content!.push({ type: 'text', text: ' more' });
    expect(serializeMdx(page)).toContain(':::note[Title]');
  });

  it('turns an empty document into an empty file, and keeps a file without a final newline that way', () => {
    const empty = parseMdx('');
    expect(
      serializeMdx({
        ...empty,
        doc: { type: 'doc', content: [{ type: 'paragraph' }] },
      }),
    ).toBe('');
    expect(serializeMdx(parseMdx('no newline'))).toBe('no newline');
  });

  it('reports invalid MDX', () => {
    expect(() => parseMdx('<Unclosed>')).toThrow();
  });

  it('keeps front matter as written and without it when there is none', () => {
    const p = parseMdx('---\ntitle: A\nicon: x\n---\n\nBody\n');
    expect(p.frontmatter).toBe('title: A\nicon: x');
    p.frontmatter = 'title: B';
    expect(serializeMdx(p)).toBe('---\ntitle: B\n---\n\nBody\n');
    expect(parseMdx('Body\n').frontmatter).toBeNull();
  });

  it('edits the text inside an inline component and keeps its tags exactly', () => {
    const page = parseMdx(
      'A <Tooltip tip="Hint: a &quot;b&quot;">term</Tooltip> here.\n',
    );
    const para = page.doc.content![0]!;
    const inl = para.content!.find((n) => n.type === 'jsxInline')!;
    expect(inl.attrs!['open']).toBe('<Tooltip tip="Hint: a &quot;b&quot;">');
    inl.content = [{ type: 'text', text: 'word', marks: [{ type: 'bold' }] }];
    expect(serializeMdx(page)).toBe(
      'A <Tooltip tip="Hint: a &quot;b&quot;">**word**</Tooltip> here.\n',
    );
  });

  it('keeps an inline component with no text, or inside bold, as written', () => {
    const src =
      'An <Icon name="x" /> and **<Kbd>Esc</Kbd>** and <Kbd>Esc</Kbd>.\n';
    const page = parseMdx(src);
    const kinds = page.doc.content![0]!.content!.map((n) => n.type);
    expect(kinds).toContain('rawInline');
    expect(kinds).toContain('jsxInline');
    expect(serializeMdx(page)).toBe(src);
  });

  it('keeps task lists, HTML, expressions and inline JSX exactly', () => {
    const src =
      '- [x] done\n- [ ] todo\n\n<div class="x">\n  raw\n</div>\n\n{1 + 1}\n\nA <Kbd>Esc</Kbd> and {x} inline.\n';
    const page = parseMdx(src);
    expect(serializeMdx(page)).toBe(src);
    expect(page.doc.content!.map((n) => n.type)).toEqual([
      'rawBlock',
      'jsxBlock',
      'rawBlock',
      'paragraph',
    ]);
    expect(page.doc.content![3]!.content!.map((n) => n.type)).toEqual([
      'text',
      'jsxInline',
      'text',
      'rawInline',
      'text',
    ]);
  });
});
