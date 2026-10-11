'use client';

import { use, useState } from 'react';
import { api } from '../../../../lib/api';
import { Bars, ErrorBox, Kpi, useApi } from '../../../../components/ui';

interface Board {
  range: { from: string; to: string };
  series: { day: string; views: number; visitors: number }[];
  traffic: Record<string, number>;
  aiAgents: { agent: string; views: number }[];
  topPages: { path: string; views: number; visitors: number }[];
  topSearches: { query: string; searches: number }[];
  failedSearches: { query: string; searches: number }[];
  feedback: { path: string; up: number; down: number }[];
  assistant: {
    answered: number;
    unanswered: number;
    unansweredTopics: { topic: string; asked: number }[] | null;
  };
  referrers: { host: string; views: number }[];
}

export default function Analytics({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const board = useApi<Board>(`/api/v1/sites/${id}/analytics`);
  const settings = useApi<{
    logConversations: boolean;
    conversationRetentionDays: number;
    retentionDays: number;
  }>(`/api/v1/sites/${id}/analytics/settings`);
  const [error, setError] = useState<unknown>();
  const b = board.data;
  const views = b?.series.reduce((n, d) => n + d.views, 0) ?? 0;
  const visitors = b?.series.reduce((n, d) => n + d.visitors, 0) ?? 0;
  const save = async (patch: object) => {
    try {
      setError(undefined);
      await api(`/api/v1/sites/${id}/analytics/settings`, {
        method: 'PUT',
        body: patch,
      });
      await settings.reload();
      await board.reload();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <>
      <ErrorBox error={error ?? board.error} />
      {b && (
        <>
          <p className="muted small">
            {b.range.from} to {b.range.to}. Counts are cookie-free; visitors are
            counted once per day.
          </p>
          <div className="grid cols-4">
            <Kpi label="Page views (people)" value={views} />
            <Kpi label="Daily visitors" value={visitors} />
            <Kpi label="AI tool views" value={b.traffic['ai'] ?? 0} />
            <Kpi
              label="Failed searches"
              value={b.failedSearches.reduce((n, s) => n + s.searches, 0)}
            />
          </div>
          <section className="card">
            <h2>Views per day</h2>
            <Bars
              values={b.series.map((d) => d.views)}
              label="Page views per day"
            />
          </section>
          <div className="grid cols-2">
            <section className="card">
              <h2>Top pages</h2>
              <table>
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Views</th>
                    <th>Visitors</th>
                  </tr>
                </thead>
                <tbody>
                  {b.topPages.map((p) => (
                    <tr key={p.path}>
                      <td>
                        <code>{p.path}</code>
                      </td>
                      <td>{p.views}</td>
                      <td>{p.visitors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!b.topPages.length && (
                <p className="muted">No views in this range.</p>
              )}
            </section>
            <section className="card">
              <h2>Searches with no results</h2>
              <table>
                <thead>
                  <tr>
                    <th>Query</th>
                    <th>Times</th>
                  </tr>
                </thead>
                <tbody>
                  {b.failedSearches.map((s) => (
                    <tr key={s.query}>
                      <td>{s.query}</td>
                      <td>{s.searches}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!b.failedSearches.length && (
                <p className="muted">
                  Nothing here. Readers found what they searched for.
                </p>
              )}
            </section>
            <section className="card">
              <h2>Feedback</h2>
              <table>
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Helpful</th>
                    <th>Not helpful</th>
                  </tr>
                </thead>
                <tbody>
                  {b.feedback.map((f) => (
                    <tr key={f.path}>
                      <td>
                        <code>{f.path}</code>
                      </td>
                      <td>{f.up}</td>
                      <td>{f.down}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!b.feedback.length && <p className="muted">No feedback yet.</p>}
            </section>
            <section className="card">
              <h2>Assistant</h2>
              <p>
                {b.assistant.answered} answered, {b.assistant.unanswered} not
                answered.
              </p>
              {b.assistant.unansweredTopics ? (
                <table>
                  <thead>
                    <tr>
                      <th>Unanswered question</th>
                      <th>Asked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.assistant.unansweredTopics.map((t) => (
                      <tr key={t.topic}>
                        <td>{t.topic}</td>
                        <td>{t.asked}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted small">
                  Turn on conversation logging below to see which questions went
                  unanswered.
                </p>
              )}
            </section>
            <section className="card">
              <h2>Traffic</h2>
              <p>
                Human {b.traffic['human'] ?? 0} · AI tools{' '}
                {b.traffic['ai'] ?? 0} · Other bots {b.traffic['bot'] ?? 0}
              </p>
              <ul>
                {b.aiAgents.map((a) => (
                  <li key={a.agent}>
                    {a.agent}: {a.views}
                  </li>
                ))}
              </ul>
            </section>
            <section className="card">
              <h2>Referrers</h2>
              <ul>
                {b.referrers.map((r) => (
                  <li key={r.host}>
                    {r.host}: {r.views}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
      <section className="card" aria-labelledby="privacy">
        <h2 id="privacy">Privacy</h2>
        <p className="muted small">
          No personal data is stored: no addresses, no user agents, no cookies.
          Search text is scrubbed of emails and numbers. Conversation text is
          only kept if you turn it on.
        </p>
        {settings.data && (
          <div className="row">
            <label className="inline">
              <input
                type="checkbox"
                checked={settings.data.logConversations}
                onChange={(e) => save({ logConversations: e.target.checked })}
              />{' '}
              Keep assistant conversations
            </label>
            <label className="inline">
              for{' '}
              <input
                type="number"
                min={1}
                max={3650}
                style={{ width: '5rem' }}
                defaultValue={settings.data.conversationRetentionDays}
                onBlur={(e) =>
                  save({ conversationRetentionDays: Number(e.target.value) })
                }
              />{' '}
              days
            </label>
            <label className="inline">
              Keep events{' '}
              <input
                type="number"
                min={1}
                max={3650}
                style={{ width: '5rem' }}
                defaultValue={settings.data.retentionDays}
                onBlur={(e) =>
                  save({ eventRetentionDays: Number(e.target.value) })
                }
              />{' '}
              days
            </label>
          </div>
        )}
      </section>
    </>
  );
}
