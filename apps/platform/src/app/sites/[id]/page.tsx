'use client';

import { use, useState } from 'react';
import { api } from '../../../lib/api';
import { ErrorBox, StatusBadge, useApi, when } from '../../../components/ui';

interface Build {
  id: string;
  commitSha: string;
  trigger: string;
  status: string;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

export default function Builds({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const site = useApi<{
    webhookUrl: string;
    site: { defaultBranch: string; liveBuildId?: string };
  }>(`/api/v1/sites/${id}`);
  const builds = useApi<{ builds: Build[] }>(`/api/v1/sites/${id}/builds`);
  const [log, setLog] = useState<{ id: string; text: string }>();
  const [error, setError] = useState<unknown>();
  const [secret, setSecret] = useState<string>();
  const run = async (fn: () => Promise<unknown>) => {
    try {
      setError(undefined);
      await fn();
    } catch (e) {
      setError(e);
    }
  };
  const active = builds.data?.builds.some(
    (b) => b.status === 'queued' || b.status === 'running',
  );

  return (
    <>
      <ErrorBox error={error ?? builds.error} />
      <section className="card">
        <div className="row">
          <button
            className="primary"
            onClick={() =>
              run(async () => {
                await api(`/api/v1/sites/${id}/builds`, { method: 'POST' });
                await builds.reload();
              })
            }
          >
            Rebuild {site.data?.site.defaultBranch}
          </button>
          {active && (
            <button
              onClick={() => void Promise.all([builds.reload(), site.reload()])}
            >
              Refresh
            </button>
          )}
          <span className="muted small">
            Pushing to <code>{site.data?.site.defaultBranch}</code> rebuilds
            automatically.
          </span>
        </div>
        <p className="small">
          Webhook URL: <code>{site.data?.webhookUrl}</code>{' '}
          <button
            className="small"
            onClick={() =>
              run(async () =>
                setSecret(
                  (
                    await api(`/api/v1/sites/${id}/webhook-secret`, {
                      method: 'POST',
                    })
                  ).webhookSecret,
                ),
              )
            }
          >
            Rotate secret
          </button>
        </p>
        {secret && (
          <div className="alert ok" role="status">
            New webhook secret (shown once): <code>{secret}</code>
          </div>
        )}
      </section>
      <section className="card" aria-labelledby="b">
        <h2 id="b">Builds</h2>
        <table>
          <thead>
            <tr>
              <th>Commit</th>
              <th>Trigger</th>
              <th>Status</th>
              <th>Started</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {builds.data?.builds.map((b) => (
              <tr key={b.id}>
                <td>
                  <code>{b.commitSha.slice(0, 8)}</code>{' '}
                  {site.data?.site.liveBuildId === b.id && (
                    <span className="badge ok">live</span>
                  )}
                </td>
                <td>{b.trigger.startsWith('manual') ? 'manual' : b.trigger}</td>
                <td>
                  <StatusBadge status={b.status} />
                  {b.error && <div className="small muted">{b.error}</div>}
                </td>
                <td className="small">{when(b.createdAt)}</td>
                <td>
                  <button
                    onClick={() =>
                      run(async () =>
                        setLog({
                          id: b.id,
                          text: (await api(`/api/v1/builds/${b.id}`)).build.log,
                        }),
                      )
                    }
                  >
                    Log
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {builds.data?.builds.length === 0 && (
          <p className="muted">No builds yet.</p>
        )}
        {log && (
          <pre className="log" aria-label="Build log">
            {log.text || '(empty)'}
          </pre>
        )}
      </section>
    </>
  );
}
