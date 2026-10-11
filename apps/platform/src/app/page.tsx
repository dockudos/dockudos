'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '../lib/api';
import { ErrorBox, useApi } from '../components/ui';

interface Team { id: string; name: string; slug: string; role: string }
interface Site { id: string; name: string; slug: string; repo: string; provider: string; liveBuildId?: string }

function TeamSites({ team }: { team: Team }) {
  const { data } = useApi<{ sites: Site[] }>(`/api/v1/teams/${team.id}/sites`);
  return (
    <div className="card">
      <div className="row"><h2 style={{ margin: 0 }}><Link href={`/teams/${team.id}`}>{team.name}</Link></h2><span className="badge">{team.role}</span></div>
      {data?.sites.length === 0 && <p className="muted">No sites yet. <Link href={`/teams/${team.id}`}>Connect a repository</Link>.</p>}
      <ul>
        {data?.sites.map((s) => (
          <li key={s.id}><Link href={`/sites/${s.id}`}>{s.name}</Link> <span className="muted small">{s.provider}:{s.repo}</span> {s.liveBuildId ? <span className="badge ok">live</span> : <span className="badge">not built</span>}</li>
        ))}
      </ul>
    </div>
  );
}

export default function Home() {
  const me = useApi<{ type: string; teams: Team[] }>('/api/v1/me');
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>();
  if (me.error?.status === 401)
    return (
      <main>
        <div className="card"><h1>Welcome to dockudos</h1><p className="muted">Sign in to edit your docs, watch builds and see how readers use them.</p><a className="btn primary" href="/auth/login?returnTo=/">Sign in</a></div>
      </main>
    );
  return (
    <main>
      <h1>Your teams</h1>
      <ErrorBox error={me.error ?? error} />
      {me.data?.teams.map((t) => <TeamSites key={t.id} team={t} />)}
      {me.data && me.data.teams.length === 0 && <p className="muted">You are not in a team yet. Create one to connect your first repository.</p>}
      <form className="card row" onSubmit={async (e) => {
        e.preventDefault();
        try { await api('/api/v1/teams', { body: { name } }); setName(''); await me.reload(); } catch (err) { setError(err); }
      }}>
        <label className="inline">New team <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} /></label>
        <button className="primary" type="submit">Create team</button>
      </form>
    </main>
  );
}
