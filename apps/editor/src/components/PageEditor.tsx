import { EditorContent, useEditor } from '@tiptap/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api.ts';
import { extensions } from '../editor/extensions.tsx';
import { startInText } from '../editor/selection.ts';
import { type Page, parseMdx, serializeMdx } from '../mdx/convert.ts';
import { Frontmatter } from './Frontmatter.tsx';
import { Toolbar } from './Toolbar.tsx';

type Save = 'saved' | 'saving' | 'error';
type Loaded =
  | { state: 'loading' }
  | { state: 'failed'; message: string }
  | {
      state: 'ready';
      text: string;
      hash: string;
      page?: Page;
      parseError?: string;
    };

const SAVE_DELAY = 600;

/** Load a file and pick the right editor for it. Remounted (by `key`) for every file. */
export function PageEditor({
  path,
  onSaved,
}: {
  path: string;
  onSaved: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    api.read(path).then(
      (f) => {
        if (!live) return;
        if (path === 'docs.json')
          return setLoaded({ state: 'ready', text: f.content, hash: f.hash });
        try {
          setLoaded({
            state: 'ready',
            text: f.content,
            hash: f.hash,
            page: parseMdx(f.content),
          });
        } catch (e) {
          setLoaded({
            state: 'ready',
            text: f.content,
            hash: f.hash,
            parseError: (e as Error).message,
          });
        }
      },
      (e: Error) => live && setLoaded({ state: 'failed', message: e.message }),
    );
    return () => {
      live = false;
    };
  }, [path]);

  if (loaded.state === 'loading') return <p className="muted pad">Loading…</p>;
  if (loaded.state === 'failed')
    return (
      <p role="alert" className="error pad">
        {loaded.message}
      </p>
    );
  return <Loaded {...loaded} path={path} onSaved={onSaved} />;
}

function Loaded({
  path,
  text: initial,
  hash,
  page,
  parseError,
  onSaved,
}: {
  path: string;
  text: string;
  hash: string;
  page?: Page;
  parseError?: string;
  onSaved: () => void;
}) {
  const isConfig = path === 'docs.json';
  const [mode, setMode] = useState<'visual' | 'source'>(
    page ? 'visual' : 'source',
  );
  const [save, setSave] = useState<Save>('saved');
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState<string>();
  const [source, setSource] = useState(initial);
  const [modeError, setModeError] = useState(
    parseError
      ? `This page is not valid MDX yet, so it is shown as source: ${parseError.split('\n')[0]}`
      : undefined,
  );
  const [front, setFrontState] = useState(page?.frontmatter ?? null);
  const frontRef = useRef(front);
  const setFront = (v: string | null) => {
    frontRef.current = v;
    setFrontState(v);
  };
  const hashRef = useRef(hash);
  const lastRef = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const tailRef = useRef(page?.tail ?? '\n');
  const pending = useRef<(() => string) | undefined>(undefined);

  const persist = useCallback(
    async (text: string, force = false) => {
      if (text === lastRef.current) return setSave('saved');
      setSave('saving');
      try {
        const r = await api.write(
          path,
          text,
          force ? undefined : hashRef.current,
        );
        hashRef.current = r.hash;
        lastRef.current = text;
        setError(undefined);
        setConflict(undefined);
        setSave('saved');
        onSaved();
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          setConflict(String(e.body['current'] ?? ''));
          setSave('error');
        } else {
          setError((e as Error).message);
          setSave('error');
        }
      }
    },
    [path, onSaved],
  );

  /** Save soon, from whatever the page looks like when the timer fires. */
  const schedule = useCallback(
    (produce: () => string) => {
      pending.current = produce;
      setSave('saving');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        pending.current = undefined;
        void persist(produce());
      }, SAVE_DELAY);
    },
    [persist],
  );

  useEffect(() => {
    // Leaving the page (or the tab) must not lose the last few keystrokes.
    const flush = () => {
      if (!pending.current) return;
      clearTimeout(timer.current);
      const produce = pending.current;
      pending.current = undefined;
      void persist(produce());
    };
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current) {
        flush();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      flush();
    };
  }, [persist]);

  const editor = useEditor({
    extensions,
    content: page?.doc ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    editable: mode === 'visual',
    onCreate: ({ editor: e }) => startInText(e),
    editorProps: {
      attributes: { class: 'prose', 'aria-label': 'Page content' },
      handlePaste: (_v, event) => {
        const file = [...(event.clipboardData?.files ?? [])].find((f) =>
          f.type.startsWith('image/'),
        );
        if (!file) return false;
        void insertImage(file);
        return true;
      },
      handleDrop: (_v, event) => {
        const file = [...(event.dataTransfer?.files ?? [])].find((f) =>
          f.type.startsWith('image/'),
        );
        if (!file) return false;
        event.preventDefault();
        void insertImage(file);
        return true;
      },
    },
    onUpdate: ({ editor: e }) =>
      schedule(() =>
        serializeMdx({
          frontmatter: frontRef.current,
          tail: tailRef.current,
          doc: e.getJSON() as never,
        }),
      ),
  });

  async function insertImage(file: File) {
    try {
      const r = await api.upload(file);
      editor
        ?.chain()
        .focus()
        .setImage({ src: r.url, alt: file.name.replace(/\.[^.]*$/, '') })
        .run();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const imageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    editor?.setEditable(mode === 'visual', false);
  }, [editor, mode]);

  const changeFront = (next: string) => {
    setFront(next);
    if (editor)
      schedule(() =>
        serializeMdx({
          frontmatter: next,
          tail: tailRef.current,
          doc: editor.getJSON() as never,
        }),
      );
  };

  const toSource = () => {
    if (!editor) return;
    clearTimeout(timer.current);
    pending.current = undefined;
    const text = serializeMdx({
      frontmatter: front,
      tail: tailRef.current,
      doc: editor.getJSON() as never,
    });
    setSource(text);
    void persist(text);
    setModeError(undefined);
    setMode('source');
  };
  const toVisual = () => {
    try {
      const p = parseMdx(source);
      clearTimeout(timer.current);
      pending.current = undefined;
      // Edits typed in the source box may still be waiting for their timer: write them now.
      void persist(source);
      editor?.commands.setContent(p.doc, { emitUpdate: false });
      setFront(p.frontmatter);
      tailRef.current = p.tail;
      setModeError(undefined);
      setMode('visual');
    } catch (e) {
      setModeError(
        `Cannot switch to Visual: ${(e as Error).message.split('\n')[0]}`,
      );
    }
  };

  const reload = async () => {
    const f = await api.read(path);
    hashRef.current = f.hash;
    lastRef.current = f.content;
    setSource(f.content);
    setConflict(undefined);
    setSave('saved');
    if (!isConfig && editor) {
      try {
        const p = parseMdx(f.content);
        editor.commands.setContent(p.doc, { emitUpdate: false });
        setFront(p.frontmatter);
        tailRef.current = p.tail;
      } catch (e) {
        setModeError(
          `This page is not valid MDX yet, so it is shown as source: ${(e as Error).message.split('\n')[0]}`,
        );
        setMode('source');
      }
    }
  };

  const status =
    save === 'saving'
      ? 'Saving…'
      : save === 'error'
        ? 'Not saved'
        : 'Saved to disk';

  return (
    <div className="page">
      <div className="page-bar">
        <h1>{path}</h1>
        <span className={`save save-${save}`} role="status">
          {status}
        </span>
        {!isConfig && (
          <div className="seg" role="group" aria-label="View">
            <button
              type="button"
              aria-pressed={mode === 'visual'}
              onClick={toVisual}
            >
              Visual
            </button>
            <button
              type="button"
              aria-pressed={mode === 'source'}
              onClick={toSource}
            >
              Source
            </button>
          </div>
        )}
      </div>

      {conflict !== undefined && (
        <div role="alert" className="banner">
          This file changed on disk while you were editing it.
          <button type="button" onClick={() => void reload()}>
            Load the version on disk
          </button>
          <button
            type="button"
            onClick={() =>
              void persist(
                mode === 'source' || isConfig
                  ? source
                  : serializeMdx({
                      frontmatter: front,
                      tail: tailRef.current,
                      doc: editor!.getJSON() as never,
                    }),
                true,
              )
            }
          >
            Keep mine
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error pad">
          {error}
        </p>
      )}
      {modeError && (
        <p role="alert" className="error pad">
          {modeError}
        </p>
      )}

      {mode === 'visual' && editor ? (
        <>
          <Toolbar
            editor={editor}
            onImage={() => imageInput.current?.click()}
          />
          <input
            ref={imageInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void insertImage(f);
              e.target.value = '';
            }}
          />
          <div className="scroll">
            {front !== null && (
              <Frontmatter value={front} onChange={changeFront} />
            )}
            <EditorContent editor={editor} />
          </div>
        </>
      ) : (
        <textarea
          className="source"
          aria-label={isConfig ? 'docs.json' : 'MDX source'}
          spellCheck={false}
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            schedule(() => e.target.value);
          }}
        />
      )}
    </div>
  );
}
