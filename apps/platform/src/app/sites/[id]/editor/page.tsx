'use client';

import { use, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ApiError, api } from '../../../../lib/api';
import { applyForm, configToForm, initialState, insertBlock, pendingChanges, reducer, wrapSelection } from '../../../../lib/editor-state';
import { ErrorBox } from '../../../../components/ui';

interface Tree { headSha: string; files: { path: string; kind: string }[] }
type Conflict = { headSha: string; conflicts: { path: string; theirs: string | null }[] };

export default function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [tree, setTree] = useState<Tree>();
  const [state, dispatch] = useReducer(reducer, initialState());
  const [error, setError] = useState<unknown>();
  const [result, setResult] = useState<{ prUrl?: string; warnings: string[] }>();
  const [conflict, setConflict] = useState<Conflict>();
  const [message, setMessage] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [dark, setDark] = useState(false);
  const [busy, setBusy] = useState(false);
  const text = useRef<HTMLTextAreaElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);

  const load = useCallback(async () => {
    try {
      const t = await api<Tree>(`/api/v1/sites/${id}/files`);
      setTree(t);
      dispatch({ type: 'load', baseSha: t.headSha });
    } catch (e) { setError(e); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setDark(window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false); }, []);

  const active = state.active ? state.buffers[state.active] : undefined;
  const isConfig = state.active === 'docs.json';

  // Send the text to the sandboxed preview.
  const send = useCallback(() => {
    if (ready.current && active && !isConfig) frame.current?.contentWindow?.postMessage({ type: 'render', source: active.content, dark }, '*');
  }, [active, isConfig, dark]);
  useEffect(() => {
    const on = (e: MessageEvent) => { if (e.source === frame.current?.contentWindow && e.data?.type === 'ready') { ready.current = true; send(); } };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [send]);
  useEffect(() => { const t = setTimeout(send, 150); return () => clearTimeout(t); }, [send]);

  // Validate docs.json as it is typed.
  useEffect(() => {
    if (!isConfig || !active) return setProblems([]);
    const t = setTimeout(() => {
      api(`/api/v1/sites/${id}/validate-config`, { body: { json: active.content } }).then((r) => setProblems(r.ok ? [] : r.problems), () => undefined);
    }, 300);
    return () => clearTimeout(t);
  }, [isConfig, active, id]);

  const open = async (path: string) => {
    if (state.buffers[path]) return dispatch({ type: 'select', path });
    try {
      const f = await api<{ content: string }>(`/api/v1/sites/${id}/file?path=${encodeURIComponent(path)}&ref=${state.baseSha}`);
      dispatch({ type: 'open', path, content: f.content });
    } catch (e) { setError(e); }
  };

  const apply = (r: { text: string; start: number; end: number }) => {
    if (!state.active) return;
    dispatch({ type: 'edit', path: state.active, content: r.text });
    requestAnimationFrame(() => { text.current?.focus(); text.current?.setSelectionRange(r.start, r.end); });
  };
  const sel = () => [text.current?.selectionStart ?? 0, text.current?.selectionEnd ?? 0] as const;
  const tool = (before: string, after = before, placeholder?: string) => active && apply(wrapSelection(active.content, ...sel(), before, after, placeholder));
  const block = (md: string) => active && apply(insertBlock(active.content, sel()[0], md));

  const plan = async (op: object) => {
    try { setError(undefined); const r = await api<{ changes: never[] }>(`/api/v1/sites/${id}/pages`, { body: op }); dispatch({ type: 'apply', changes: r.changes }); } catch (e) { setError(e); }
  };
  const upload = async (file: File) => {
    try {
      setError(undefined);
      const r = await api<{ id: string; markdown: string }>(`/api/v1/sites/${id}/media?filename=${encodeURIComponent(file.name)}`, { raw: file });
      dispatch({ type: 'upload', id: r.id });
      block(r.markdown);
    } catch (e) { setError(e); }
  };

  const changes = pendingChanges(state);
  const save = async (baseSha = state.baseSha) => {
    setBusy(true);
    try {
      setError(undefined);
      const r = await api<{ prUrl?: string; warnings: string[] }>(`/api/v1/sites/${id}/save`, { body: { baseSha, message, changes: pendingChanges(state), uploads: state.uploads } });
      setResult(r); setConflict(undefined); dispatch({ type: 'saved' }); setMessage('');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'edit_conflict') setConflict(e.details as Conflict);
      else setError(e);
    } finally { setBusy(false); }
  };
  const resolve = (keepMine: boolean) => {
    if (!conflict) return;
    const theirs = keepMine ? {} : Object.fromEntries(conflict.conflicts.map((c) => [c.path, c.theirs]));
    dispatch({ type: 'resolve', baseSha: conflict.headSha, theirs });
    setConflict(undefined);
    if (keepMine) void save(conflict.headSha);
  };

  const form = isConfig && active ? configToForm(active.content) : undefined;

  return (
    <>
      <ErrorBox error={error} />
      {result && <div className="alert ok" role="status">Saved. {result.prUrl ? <a href={result.prUrl} target="_blank" rel="noreferrer">Review and merge the pull request</a> : 'Committed.'}{result.warnings.map((w) => <div key={w} className="small">⚠ {w}</div>)}</div>}
      {conflict && (
        <div className="alert warn" role="alert">
          <strong>Someone changed {conflict.conflicts.length === 1 ? 'a file' : 'files'} you edited:</strong> {conflict.conflicts.map((c) => <code key={c.path}>{c.path} </code>)}
          <div className="row" style={{ marginTop: '.5rem' }}>
            <button onClick={() => resolve(true)}>Keep my version and save</button>
            <button onClick={() => resolve(false)}>Use their version (discard mine)</button>
          </div>
        </div>
      )}
      <div className="row" style={{ marginBottom: '.6rem' }}>
        <input aria-label="Commit message" placeholder="Describe your change" value={message} onChange={(e) => setMessage(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        <button disabled={!changes.length || busy} onClick={() => { if (confirm('Discard all unsaved changes?')) { setResult(undefined); void load(); } }}>Discard all</button>
        <button className="primary" disabled={!changes.length || !message.trim() || busy} onClick={() => save()}>Save as pull request ({changes.length})</button>
      </div>
      <div className="editor">
        <aside className="tree" aria-label="Files">
          <div className="row" style={{ marginBottom: '.5rem' }}>
            <button onClick={() => { const idv = prompt('New page id, like guides/webhooks'); const title = idv && prompt('Title'); if (idv && title) void plan({ type: 'create', id: idv, title }); }}>New page</button>
          </div>
          {tree?.files.map((f) => {
            const b = state.buffers[f.path];
            const dirty = b && (b.deleted || b.original === null || b.content !== b.original);
            return (
              <button key={f.path} className="file" aria-current={state.active === f.path} onClick={() => open(f.path)} style={b?.deleted ? { textDecoration: 'line-through' } : undefined}>
                {f.path} {dirty && <span className="dot" aria-label="unsaved">●</span>}
              </button>
            );
          })}
          {Object.keys(state.buffers).filter((p) => !tree?.files.some((f) => f.path === p)).map((p) => (
            <button key={p} className="file" aria-current={state.active === p} onClick={() => dispatch({ type: 'select', path: p })}>{p} <span className="dot">● new</span></button>
          ))}
          {state.active && state.active !== 'docs.json' && (
            <div className="row" style={{ marginTop: '.75rem' }}>
              <button className="small" disabled={state.buffers[state.active]?.original === null} title={state.buffers[state.active]?.original === null ? 'Save this new page first, then rename it' : undefined} onClick={() => { const to = prompt('Rename to (page id)', state.active!.replace(/^docs\//, '').replace(/\.mdx?$/, '')); const from = state.active!.replace(/^docs\//, '').replace(/\.mdx?$/, ''); if (to && to !== from) void plan({ type: 'rename', from, to }); }}>Rename</button>
              <button className="small danger" disabled={state.buffers[state.active]?.original === null} onClick={() => { if (confirm('Delete this page?')) void plan({ type: 'delete', id: state.active!.replace(/^docs\//, '').replace(/\.mdx?$/, '') }); }}>Delete</button>
            </div>
          )}
        </aside>

        <section className="pane" aria-label="Editor">
          {!active && <p className="muted" style={{ padding: '1rem' }}>Choose a page to edit.</p>}
          {active && !isConfig && (
            <>
              <div className="toolbar" role="toolbar" aria-label="Formatting">
                <button onClick={() => block('## Heading')} title="Heading">H2</button>
                <button onClick={() => tool('**')} title="Bold"><b>B</b></button>
                <button onClick={() => tool('_')} title="Italic"><i>I</i></button>
                <button onClick={() => tool('`')} title="Code">{'</>'}</button>
                <button onClick={() => tool('[', '](https://)', 'link text')} title="Link">Link</button>
                <button onClick={() => block('<Callout type="info">\n  Note\n</Callout>')} title="Callout">Callout</button>
                <button onClick={() => block('```bash\nnpm install\n```')} title="Code block">Code block</button>
                <label className="btn small" style={{ cursor: 'pointer' }}>Image
                  <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
                </label>
              </div>
              <textarea ref={text} aria-label="Page source" spellCheck value={active.content} onChange={(e) => dispatch({ type: 'edit', path: state.active!, content: e.target.value })} />
            </>
          )}
          {active && isConfig && form && (
            <div style={{ padding: '.75rem', overflow: 'auto' }}>
              <h3>docs.json</h3>
              {form.ok ? (
                <div className="grid cols-2">
                  <label className="field">Site name<input value={form.name} onChange={(e) => dispatch({ type: 'edit', path: 'docs.json', content: applyForm(active.content, { ...form, name: e.target.value }) })} /></label>
                  <label className="field">Description<input value={form.description} onChange={(e) => dispatch({ type: 'edit', path: 'docs.json', content: applyForm(active.content, { ...form, description: e.target.value }) })} /></label>
                  <label className="field">Primary color<input value={form.primary} placeholder="#3b82f6" onChange={(e) => dispatch({ type: 'edit', path: 'docs.json', content: applyForm(active.content, { ...form, primary: e.target.value }) })} /></label>
                  <label className="inline"><input type="checkbox" checked={form.kudos} onChange={(e) => dispatch({ type: 'edit', path: 'docs.json', content: applyForm(active.content, { ...form, kudos: e.target.checked }) })} /> Reader feedback widget</label>
                </div>
              ) : <div className="alert error">This is not valid JSON yet. Fix it below.</div>}
              {problems.length > 0 && <div className="alert error" role="alert">{problems.map((p) => <div key={p}>{p}</div>)}</div>}
              {problems.length === 0 && form.ok && <div className="alert ok">docs.json is valid.</div>}
              <label className="field">Raw JSON<textarea aria-label="docs.json source" rows={18} className="mono" value={active.content} onChange={(e) => dispatch({ type: 'edit', path: 'docs.json', content: e.target.value })} /></label>
            </div>
          )}
        </section>

        <section aria-label="Preview">
          {!isConfig && <iframe ref={frame} title="Live preview" src="/preview-frame" sandbox="allow-scripts" onLoad={() => { ready.current = false; }} />}
        </section>
      </div>
    </>
  );
}
