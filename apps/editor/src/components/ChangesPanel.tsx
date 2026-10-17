import { useEffect, useState } from 'react';
import {
  type Change,
  type CommitInfo,
  type GitInfo,
  api,
  pageId,
} from '../api.ts';

const LABEL: Record<Change['status'], string> = {
  added: 'New',
  modified: 'Edited',
  deleted: 'Deleted',
  renamed: 'Moved',
};

const name = (p: string) =>
  p === 'docs.json'
    ? 'Site settings'
    : p.startsWith('docs/')
      ? pageId(p)
      : p.replace('public/media/', '');

export function ChangesPanel({
  git,
  changes,
  refresh,
  onGitInit,
}: {
  git: GitInfo;
  changes: Change[];
  refresh: (reloadPage?: boolean) => Promise<void>;
  onGitInit: () => Promise<void>;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [diffOf, setDiffOf] = useState<string>();
  const [diff, setDiff] = useState('');
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string }>();

  // New changes start selected; a change the user unticked stays unticked.
  const [known, setKnown] = useState<Set<string>>(new Set());
  useEffect(() => {
    const fresh = changes.map((c) => c.path).filter((p) => !known.has(p));
    if (fresh.length) {
      setKnown((k) => new Set([...k, ...fresh]));
      setPicked((p) => new Set([...p, ...fresh]));
    }
    setPicked(
      (p) => new Set([...p].filter((x) => changes.some((c) => c.path === x))),
    );
  }, [changes, known]);

  useEffect(() => {
    if (!git.isRepo) return;
    api.log().then(
      (r) => setCommits(r.commits),
      () => setCommits([]),
    );
  }, [git.isRepo, git.head]);

  useEffect(() => {
    if (!diffOf) return;
    api.diff(diffOf).then(
      (r) => setDiff(r.diff || '(no changes)'),
      (e: Error) => setDiff(e.message),
    );
  }, [diffOf, changes]);

  if (!git.isRepo)
    return (
      <aside className="panel" aria-label="Changes">
        <h2>Changes</h2>
        <p>
          This folder is not a Git repository, so edits are saved to disk but
          cannot be committed.
        </p>
        <button type="button" onClick={() => void onGitInit()}>
          Start a Git repository here
        </button>
      </aside>
    );

  const run = async (fn: () => Promise<string>, reloadPage = false) => {
    setBusy(true);
    setNote(undefined);
    try {
      setNote({ ok: true, text: await fn() });
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      await refresh(reloadPage);
    }
  };

  const chosen = [...picked];
  return (
    <aside className="panel" aria-label="Changes">
      <h2>
        Changes <small>on {git.branch}</small>
      </h2>
      {!git.identity && (
        <p role="alert" className="warn">
          Git does not know your name yet. Run{' '}
          <code>git config user.name "Your Name"</code> and{' '}
          <code>git config user.email you@example.com</code>, then commit.
        </p>
      )}
      {changes.length === 0 ? (
        <p className="muted">
          Nothing to commit. Your edits are saved and match the last commit.
        </p>
      ) : (
        <>
          <ul className="changes">
            {changes.map((c) => (
              <li key={c.path}>
                <label>
                  <input
                    type="checkbox"
                    checked={picked.has(c.path)}
                    onChange={(e) =>
                      setPicked((p) => {
                        const n = new Set(p);
                        if (e.target.checked) n.add(c.path);
                        else n.delete(c.path);
                        return n;
                      })
                    }
                  />
                  <span className={`tag tag-${c.status}`}>
                    {LABEL[c.status]}
                  </span>{' '}
                  {name(c.path)}
                </label>
                {c.status !== 'deleted' && (
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      setDiffOf(diffOf === c.path ? undefined : c.path)
                    }
                  >
                    {diffOf === c.path ? 'Hide' : 'Diff'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {diffOf && (
            <pre className="diff" aria-label={`Changes in ${diffOf}`}>
              {diff}
            </pre>
          )}
          <label className="msg">
            Commit message
            <textarea
              rows={2}
              value={message}
              placeholder="Update the docs"
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={busy || chosen.length === 0 || !message.trim()}
              onClick={() =>
                void run(async () => {
                  const r = await api.commit(message.trim(), chosen);
                  setMessage('');
                  return `Committed ${r.committed.length} file${r.committed.length === 1 ? '' : 's'} as ${r.sha.slice(0, 7)}.`;
                })
              }
            >
              Commit{' '}
              {chosen.length > 0
                ? `${chosen.length} file${chosen.length === 1 ? '' : 's'}`
                : ''}
            </button>
            <button
              type="button"
              disabled={busy || chosen.length === 0}
              onClick={() => {
                if (
                  !window.confirm(
                    `Throw away your changes to ${chosen.length} file(s)? This cannot be undone.`,
                  )
                )
                  return;
                void run(async () => {
                  await api.discard(chosen);
                  return 'Changes discarded.';
                }, true);
              }}
            >
              Discard
            </button>
          </div>
        </>
      )}
      {note && (
        <p
          role={note.ok ? 'status' : 'alert'}
          className={note.ok ? 'ok' : 'error'}
        >
          {note.text}
        </p>
      )}
      <h3>History</h3>
      {commits.length === 0 ? (
        <p className="muted">No commits yet.</p>
      ) : (
        <ol className="history">
          {commits.map((c) => (
            <li key={c.sha}>
              <span>{c.subject}</span>
              <small>
                {c.author} · {new Date(c.date).toLocaleString()} ·{' '}
                {c.sha.slice(0, 7)}
              </small>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
