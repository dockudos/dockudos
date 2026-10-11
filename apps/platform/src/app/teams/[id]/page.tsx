'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { api } from '../../../lib/api';
import { ErrorBox, useApi, when } from '../../../components/ui';

interface Member { userId: string; email?: string; name?: string; role: string }
interface Key { id: string; name: string; prefix: string; role: string; createdAt: string; expiresAt?: string; revokedAt?: string; lastUsedAt?: string }

export default function Team({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const members = useApi<{ members: Member[] }>(`/api/v1/teams/${id}/members`);
  const keys = useApi<{ keys: Key[] }>(`/api/v1/teams/${id}/keys`);
  const sites = useApi<{ sites: { id: string; name: string; repo: string; provider: string }[] }>(`/api/v1/teams/${id}/sites`);
  const [error, setError] = useState<unknown>();
  const [secret, setSecret] = useState<string>();
  const [hook, setHook] = useState<{ url: string; secret: string }>();
  const [member, setMember] = useState({ email: '', role: 'editor' });
  const [key, setKey] = useState({ name: '', role: 'editor' });
  const [site, setSite] = useState({ name: '', provider: 'github', repo: '', docsDir: '' });
  const run = async (fn: () => Promise<unknown>) => { try { setError(undefined); await fn(); } catch (e) { setError(e); } };

  return (
    <main>
      <p className="small"><Link href="/">Teams</Link> / settings</p>
      <ErrorBox error={error ?? members.error} />

      <section className="card" aria-labelledby="sites-h">
        <h2 id="sites-h">Sites</h2>
        <ul>{sites.data?.sites.map((s) => <li key={s.id}><Link href={`/sites/${s.id}`}>{s.name}</Link> <span className="muted small">{s.provider}:{s.repo}</span></li>)}</ul>
        {hook && (
          <div className="alert ok" role="status">
            <strong>Add this webhook to the repository</strong> (content type JSON, push events). The secret is shown once.
            <div>URL <code>{hook.url}</code></div><div>Secret <code>{hook.secret}</code></div>
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => {
          const r = await api(`/api/v1/teams/${id}/sites`, { body: { ...site, docsDir: site.docsDir || undefined } });
          setHook({ url: r.webhookUrl, secret: r.webhookSecret }); setSite({ ...site, name: '', repo: '' }); await sites.reload();
        }); }}>
          <h3>Connect a repository</h3>
          <div className="row">
            <label className="field">Name<input value={site.name} onChange={(e) => setSite({ ...site, name: e.target.value })} required /></label>
            <label className="field">Host<select value={site.provider} onChange={(e) => setSite({ ...site, provider: e.target.value })}><option value="github">GitHub</option><option value="gitlab">GitLab</option></select></label>
            <label className="field">Repository<input value={site.repo} onChange={(e) => setSite({ ...site, repo: e.target.value })} placeholder="owner/name" required /></label>
            <label className="field">Docs folder (optional)<input value={site.docsDir} onChange={(e) => setSite({ ...site, docsDir: e.target.value })} placeholder="repository root" /></label>
          </div>
          <button className="primary" type="submit">Connect</button>
        </form>
      </section>

      <section className="card" aria-labelledby="members-h">
        <h2 id="members-h">Members</h2>
        <table><thead><tr><th>Person</th><th>Role</th><th /></tr></thead><tbody>
          {members.data?.members.map((m) => (
            <tr key={m.userId}><td>{m.name ?? m.email} <span className="muted small">{m.email}</span></td><td>{m.role}</td>
              <td><button className="danger" onClick={() => run(async () => { await api(`/api/v1/teams/${id}/members/${m.userId}`, { method: 'DELETE' }); await members.reload(); })}>Remove</button></td></tr>
          ))}
        </tbody></table>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/v1/teams/${id}/members`, { method: 'PUT', body: member }); setMember({ ...member, email: '' }); await members.reload(); }); }}>
          <label className="inline">Email <input type="email" value={member.email} onChange={(e) => setMember({ ...member, email: e.target.value })} required /></label>
          <select aria-label="Role" value={member.role} onChange={(e) => setMember({ ...member, role: e.target.value })}>{['viewer', 'editor', 'admin', 'owner'].map((r) => <option key={r}>{r}</option>)}</select>
          <button type="submit">Add or change</button>
        </form>
        <p className="muted small">People appear here after they sign in once.</p>
      </section>

      <section className="card" aria-labelledby="keys-h">
        <h2 id="keys-h">API keys</h2>
        {secret && <div className="alert ok" role="status">Copy this key now, it is not shown again: <code>{secret}</code></div>}
        <table><thead><tr><th>Name</th><th>Role</th><th>Last used</th><th /></tr></thead><tbody>
          {keys.data?.keys.map((k) => (
            <tr key={k.id}><td>{k.name} <code>dkd_{k.prefix}_…</code></td><td>{k.role}</td><td>{k.revokedAt ? <span className="badge bad">revoked</span> : when(k.lastUsedAt) || '—'}</td>
              <td>{!k.revokedAt && <button className="danger" onClick={() => run(async () => { await api(`/api/v1/teams/${id}/keys/${k.id}`, { method: 'DELETE' }); await keys.reload(); })}>Revoke</button>}</td></tr>
          ))}
        </tbody></table>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await api(`/api/v1/teams/${id}/keys`, { body: key }); setSecret(r.secret); setKey({ ...key, name: '' }); await keys.reload(); }); }}>
          <label className="inline">Name <input value={key.name} onChange={(e) => setKey({ ...key, name: e.target.value })} required /></label>
          <select aria-label="Key role" value={key.role} onChange={(e) => setKey({ ...key, role: e.target.value })}>{['viewer', 'editor', 'admin'].map((r) => <option key={r}>{r}</option>)}</select>
          <button type="submit">Create key</button>
        </form>
      </section>
    </main>
  );
}
