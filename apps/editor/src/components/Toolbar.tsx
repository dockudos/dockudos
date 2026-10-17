import { type Editor, useEditorState } from '@tiptap/react';
import { parseMdx } from '../mdx/convert.ts';
import { SNIPPETS } from '../editor/snippets.ts';

interface Props {
  editor: Editor;
  onImage: () => void;
}

export function Toolbar({ editor, onImage }: Props) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      undo: e.can().undo(),
      redo: e.can().redo(),
    }),
  });
  const run = () => editor.chain().focus();
  const btn = (
    label: string,
    on: boolean,
    act: () => void,
    title = label,
    disabled = false,
  ) => (
    <button
      type="button"
      className="tb"
      aria-pressed={on}
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={act}
    >
      {label}
    </button>
  );

  const setLink = () => {
    const prev = String(editor.getAttributes('link')['href'] ?? '');
    const href = window.prompt('Link address', prev);
    if (href === null) return;
    if (href === '') run().unsetLink().run();
    else run().extendMarkRange('link').setLink({ href }).run();
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {btn('B', s.bold, () => run().toggleBold().run(), 'Bold')}
      {btn('I', s.italic, () => run().toggleItalic().run(), 'Italic')}
      {btn('S', s.strike, () => run().toggleStrike().run(), 'Strikethrough')}
      {btn('</>', s.code, () => run().toggleCode().run(), 'Inline code')}
      {btn('Link', s.link, setLink, 'Link')}
      <span className="sep" />
      {btn(
        'H1',
        s.h1,
        () => run().toggleHeading({ level: 1 }).run(),
        'Heading 1',
      )}
      {btn(
        'H2',
        s.h2,
        () => run().toggleHeading({ level: 2 }).run(),
        'Heading 2',
      )}
      {btn(
        'H3',
        s.h3,
        () => run().toggleHeading({ level: 3 }).run(),
        'Heading 3',
      )}
      <span className="sep" />
      {btn(
        '• List',
        s.bullet,
        () => run().toggleBulletList().run(),
        'Bulleted list',
      )}
      {btn(
        '1. List',
        s.ordered,
        () => run().toggleOrderedList().run(),
        'Numbered list',
      )}
      {btn('Quote', s.quote, () => run().toggleBlockquote().run(), 'Quote')}
      {btn(
        'Code',
        s.codeBlock,
        () => run().toggleCodeBlock().run(),
        'Code block',
      )}
      {btn('—', false, () => run().setHorizontalRule().run(), 'Divider')}
      {btn('Image', false, onImage, 'Insert image')}
      <select
        aria-label="Insert component"
        className="insert"
        value=""
        onChange={(e) => {
          const snippet = SNIPPETS.find((x) => x.label === e.target.value);
          if (snippet)
            run()
              .insertContent(parseMdx(snippet.mdx).doc.content ?? [])
              .run();
        }}
      >
        <option value="">Insert…</option>
        {SNIPPETS.map((x) => (
          <option key={x.label}>{x.label}</option>
        ))}
      </select>
      <span className="sep" />
      {btn('↶', false, () => run().undo().run(), 'Undo', !s.undo)}
      {btn('↷', false, () => run().redo().run(), 'Redo', !s.redo)}
    </div>
  );
}
