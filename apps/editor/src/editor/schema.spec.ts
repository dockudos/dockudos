// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extensions } from './extensions.tsx';
import { parseMdx, serializeMdx } from '../mdx/convert.ts';
import { startInText } from './selection.ts';

const SRC =
  '---\ntitle: Guide\n---\n\nimport X from "./x";\n\n<Callout type="info">\n\nKeep **this**.\n\n</Callout>\n\nSee {1 + 1} and <Kbd>Esc</Kbd>.\n';

function through(src: string) {
  const page = parseMdx(src);
  const editor = new Editor({ extensions, content: page.doc });
  const out = serializeMdx({ ...page, doc: editor.getJSON() as never });
  editor.destroy();
  return out;
}

describe('starting selection', () => {
  const open = (src: string) =>
    new Editor({ extensions, content: parseMdx(src).doc });

  it('would select a leading raw block, and startInText moves the cursor into text instead', () => {
    const editor = open(SRC);
    expect('node' in editor.state.selection).toBe(true); // the hazard: typing now replaces the import line
    startInText(editor);
    expect('node' in editor.state.selection).toBe(false);
    editor.commands.insertContent('x');
    expect(
      serializeMdx({ ...parseMdx(SRC), doc: editor.getJSON() as never }),
    ).toContain('import X from "./x";');
    editor.destroy();
  });

  it('leaves a page that already starts with text alone', () => {
    const editor = open('# Hello\n');
    const before = editor.state.selection.from;
    startInText(editor);
    expect(editor.state.selection.from).toBe(before);
    editor.destroy();
  });

  it('does nothing when the page has only raw blocks', () => {
    const editor = open('import X from "./x";\n');
    expect(() => startInText(editor)).not.toThrow();
    editor.destroy();
  });
});

describe('the editor schema keeps what the converter needs', () => {
  it('a page opened and read back is unchanged', () => {
    expect(through(SRC)).toBe(SRC);
  });

  it('the setEditable call that switches views does not report a change', () => {
    const page = parseMdx(SRC);
    const editor = new Editor({ extensions, content: page.doc });
    let updates = 0;
    editor.on('update', () => updates++);
    editor.setEditable(false, false);
    editor.setEditable(true, false);
    expect(updates).toBe(0);
    editor.destroy();
  });

  it('every page of the real docs survives the editor unchanged', () => {
    const root = join(import.meta.dirname, '../../../docs/docs');
    const bad: string[] = [];
    const walk = (d: string): string[] =>
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('node:fs') as typeof import('node:fs'))
        .readdirSync(d, { withFileTypes: true })
        .flatMap((e) =>
          e.isDirectory()
            ? walk(join(d, e.name))
            : /\.mdx?$/.test(e.name)
              ? [join(d, e.name)]
              : [],
        );
    for (const f of walk(root)) {
      const src = readFileSync(f, 'utf8');
      try {
        if (through(src) !== src) bad.push(f.slice(root.length + 1));
      } catch (e) {
        bad.push(`${f}: ${(e as Error).message}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
