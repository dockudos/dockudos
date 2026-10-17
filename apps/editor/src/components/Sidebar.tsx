import { useState } from 'react';
import { pageId } from '../api.ts';

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function Sidebar({
  files,
  current,
  dirty,
  onOpen,
  onCreate,
  onRename,
  onDelete,
}: {
  files: string[];
  current?: string;
  dirty: Set<string>;
  onOpen: (path: string) => void;
  onCreate: (id: string, title: string) => Promise<void>;
  onRename: (id: string) => void;
  onDelete: (path: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [id, setId] = useState('');
  const [touchedId, setTouchedId] = useState(false);
  const [error, setError] = useState<string>();

  const pages = files.filter((f) => f.startsWith('docs/'));
  const media = files.filter((f) => f.startsWith('public/media/'));
  const submit = async () => {
    try {
      await onCreate(id || slug(title), title);
      setAdding(false);
      setTitle('');
      setId('');
      setTouchedId(false);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <nav className="sidebar" aria-label="Pages">
      <div className="side-head">
        <h2>Pages</h2>
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          aria-expanded={adding}
        >
          + New page
        </button>
      </div>
      {adding && (
        <form
          className="new-page"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label>
            Title
            <input
              autoFocus
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (!touchedId) setId(slug(e.target.value));
              }}
            />
          </label>
          <label>
            Address
            <input
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                setTouchedId(true);
              }}
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={!title.trim() || !(id || slug(title))}
          >
            Create
          </button>
        </form>
      )}
      <ul>
        {files.includes('docs.json') && (
          <li>
            <button
              type="button"
              className={current === 'docs.json' ? 'file active' : 'file'}
              onClick={() => onOpen('docs.json')}
            >
              Site settings <small>docs.json</small>
            </button>
          </li>
        )}
        {pages.map((p) => (
          <li key={p} className="row">
            <button
              type="button"
              className={current === p ? 'file active' : 'file'}
              aria-current={current === p ? 'page' : undefined}
              onClick={() => onOpen(p)}
            >
              {pageId(p)}
              {dirty.has(p) && (
                <span
                  className="dot"
                  role="img"
                  aria-label="Uncommitted changes"
                />
              )}
            </button>
            <button
              type="button"
              className="icon"
              title={`Rename ${pageId(p)}`}
              aria-label={`Rename ${pageId(p)}`}
              onClick={() => onRename(pageId(p))}
            >
              ✎
            </button>
            <button
              type="button"
              className="icon"
              title={`Delete ${pageId(p)}`}
              aria-label={`Delete ${pageId(p)}`}
              onClick={() => onDelete(p)}
            >
              🗑
            </button>
          </li>
        ))}
      </ul>
      {media.length > 0 && (
        <>
          <h3>Images</h3>
          <ul className="media">
            {media.map((m) => (
              <li key={m}>
                <img
                  src={`/${m.replace(/^public\//, '')}`}
                  alt=""
                  width={28}
                  height={28}
                />
                {m.replace('public/media/', '')}
              </li>
            ))}
          </ul>
        </>
      )}
    </nav>
  );
}
