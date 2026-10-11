'use client';

import { use, useState } from 'react';
import { api } from '../../../../lib/api';
import { ErrorBox, StatusBadge, useApi, when } from '../../../../components/ui';

interface Run { id: string; trigger: string; status: string; prUrl?: string; codeRepo?: string; flagged: { path: string; reasons: string[]; outcome: string }[]; error?: string; createdAt: string }

export default function Agent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const cfg = useApi<{ enabled: boolean; codeRepos: { provider: string; repo: string }[]; modelConfigured: boolean }>(`/api/v1/sites/${id}/agent`);
  const runs = useApi<{ runs: Run[] }>(`/api/v1/sites/${id}/agent/runs`);
  const [repo, setRepo] = useState('');
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const run = async (fn: () => Promise<unknown>) => { try { setError(undefined); await fn(); } catch (e) { setError(e); } };
  const save = (body: object) => run(async () => { await api(`/api/v1/sites/${id}/agent`, { method: 'PUT', body }); await cfg.reload(); });
  const c = cfg.data;
  return (
    <>
      <ErrorBox error={error ?? cfg.error} />
      {notice && <div className="alert ok" role="status">{notice}</div>}
      <section className="card" aria-labelledby="a">
        <h2 id="a">Docs agent</h2>
        <p className="muted">Watches your code repositories and opens pull requests that update the docs. It never publishes: a person reviews and merges every change.</p>
        {c && !c.modelConfigured && <div className="alert warn">No model is configured on this instance (<code>DOCKUDOS_LLM_*</code>). The agent will still flag the pages a change affects, but cannot draft edits.</div>}
        <label className="inline"><input type="checkbox" checked={!!c?.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> Turn the agent on for this site</label>
        <h3 style={{ marginTop: '1rem' }}>Code repositories</h3>
        <ul>{c?.codeRepos.map((r) => <li key={r.repo}>{r.provider}:{r.repo} <button className="danger" onClick={() => save({ codeRepos: c.codeRepos.filter((x) => x.repo !== r.repo) })}>Remove</button></li>)}</ul>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (c) void save({ codeRepos: [...c.codeRepos, { provider: 'github', repo }] }).then(() => setRepo('')); }}>
          <input aria-label="Repository" placeholder="owner/name" value={repo} onChange={(e) => setRepo(e.target.value)} required />
          <button type="submit">Watch</button>
        </form>
      </section>
      <section className="card" aria-labelledby="s">
        <h2 id="s">Scheduled checks</h2>
        {(['broken-links', 'outdated-pages'] as const).map((kind) => (
          <div className="row" key={kind} style={{ marginBottom: '.5rem' }}>
            <strong style={{ minWidth: '9rem' }}>{kind === 'broken-links' ? 'Broken links' : 'Outdated pages'}</strong>
            <button onClick={() => run(async () => { await api(`/api/v1/sites/${id}/agent/automations/${kind}`, { method: 'PUT', body: { enabled: true, intervalHours: 168 } }); setNotice(`${kind} will run weekly.`); })}>Run weekly</button>
            <button onClick={() => run(async () => { await api(`/api/v1/sites/${id}/agent/automations/${kind}`, { method: 'PUT', body: { enabled: false } }); setNotice(`${kind} is off.`); })}>Off</button>
            <button onClick={() => run(async () => { await api(`/api/v1/sites/${id}/agent/trigger`, { body: { kind } }); setNotice('Queued. Refresh in a moment.'); })}>Run now</button>
          </div>
        ))}
        <button onClick={() => run(async () => { const r = await api(`/api/v1/sites/${id}/agent/trigger`, { body: { kind: 'watch' } }); setNotice(`${r.queued} code change(s) queued.`); await runs.reload(); })}>Check code repositories now</button>
      </section>
      <section className="card" aria-labelledby="r">
        <h2 id="r">Runs</h2>
        <button onClick={() => runs.reload()}>Refresh</button>
        <table><thead><tr><th>When</th><th>Trigger</th><th>Result</th><th>Pages</th></tr></thead><tbody>
          {runs.data?.runs.map((r) => (
            <tr key={r.id}><td className="small">{when(r.createdAt)}</td><td>{r.trigger}{r.codeRepo && <div className="muted small">{r.codeRepo}</div>}</td>
              <td><StatusBadge status={r.status} />{r.prUrl && <div><a href={r.prUrl} target="_blank" rel="noreferrer">Review the pull request</a></div>}{r.error && <div className="small muted">{r.error}</div>}</td>
              <td className="small">{r.flagged.map((f) => <div key={f.path}><code>{f.path}</code> {f.outcome}</div>)}</td></tr>
          ))}
        </tbody></table>
      </section>
    </>
  );
}
