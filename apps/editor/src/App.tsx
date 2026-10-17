import { useCallback, useEffect, useRef, useState } from 'react';
import { type Change, type Project, api, pageId } from './api.ts';
import { ChangesPanel } from './components/ChangesPanel.tsx';
import { PageEditor } from './components/PageEditor.tsx';
import { Sidebar } from './components/Sidebar.tsx';

export function App() {
  const [project, setProject] = useState<Project>();
  const [error, setError] = useState<string>();
  const [current, setCurrent] = useState<string>();
  const [changes, setChanges] = useState<Change[]>([]);
  const [rev, setRev] = useState(0); // bumps to remount the editor after a rename or discard
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const loadProject = useCallback(async () => {
    const p = await api.project();
    setProject(p);
    return p;
  }, []);

  const loadChanges = useCallback(async () => {
    try {
      setChanges((await api.status()).changes);
    } catch {
      setChanges([]);
    }
  }, []);

  const refresh = useCallback(async () => {
    const p = await loadProject();
    if (p.git.isRepo) await loadChanges();
    else setChanges([]);
  }, [loadProject, loadChanges]);

  useEffect(() => {
    refresh().then(
      () => undefined,
      (e: Error) => setError(e.message),
    );
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  // Open the first page once the project is known.
  useEffect(() => {
    if (project && !current)
      setCurrent(
        project.files.find((f) => f.startsWith('docs/')) ?? project.files[0],
      );
  }, [project, current]);

  /** A page was saved to disk: look at Git soon (not on every keystroke's save). */
  const saved = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void refresh(), 400);
  }, [refresh]);

  if (error)
    return (
      <p role="alert" className="error pad">
        {error}
      </p>
    );
  if (!project) return <p className="muted pad">Opening…</p>;

  const dirty = new Set(
    changes.flatMap((c) => [c.path, ...(c.from ? [c.from] : [])]),
  );
  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      window.alert((e as Error).message);
    }
  };

  return (
    <div className="app">
      <header className="top">
        <strong>{project.name}</strong>
        <span className="muted" title={project.dir}>
          {project.dir}
        </span>
      </header>
      <Sidebar
        files={project.files}
        current={current}
        dirty={dirty}
        onOpen={setCurrent}
        onCreate={async (id, title) => {
          const r = await api.createPage(id, title);
          await refresh();
          setCurrent(r.path);
        }}
        onRename={(id) =>
          void guard(async () => {
            const to = window.prompt('New address for this page', id)?.trim();
            if (!to || to === id) return;
            const r = await api.movePage(id, to);
            await refresh();
            setCurrent(r.path);
            setRev((n) => n + 1);
          })
        }
        onDelete={(path) =>
          void guard(async () => {
            if (
              !window.confirm(
                `Delete ${pageId(path)}? You can still get it back from Git once it is committed.`,
              )
            )
              return;
            await api.remove(path);
            if (current === path) setCurrent(undefined);
            await refresh();
          })
        }
      />
      <main>
        {current ? (
          <PageEditor
            key={`${current}:${rev}`}
            path={current}
            onSaved={saved}
          />
        ) : (
          <p className="muted pad">Choose a page, or create one.</p>
        )}
      </main>
      <ChangesPanel
        git={project.git}
        changes={changes}
        refresh={async (reloadPage) => {
          await refresh();
          if (reloadPage) setRev((n) => n + 1);
        }}
        onGitInit={async () => {
          setProject(await api.gitInit());
          await refresh();
        }}
      />
    </div>
  );
}
