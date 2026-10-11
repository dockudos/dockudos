'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';

/** Load JSON once and again on demand. A 401 is reported as `unauthorized` so pages can offer sign-in. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<ApiError | undefined>();
  const [loading, setLoading] = useState(!!path);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(undefined);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load };
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  if (e.status === 401) return <div className="alert warn" role="alert">You are signed out. <a href="/auth/login?returnTo=/">Sign in</a></div>;
  return <div className="alert error" role="alert">{e.message}</div>;
}

export function StatusBadge({ status }: { status: string }) {
  const cls = status === 'succeeded' || status === 'opened' ? 'ok' : status === 'failed' ? 'bad' : status === 'running' || status === 'flagged' ? 'warn' : '';
  return <span className={`badge ${cls}`}>{status}</span>;
}

export function Kpi({ label, value }: { label: string; value: string | number }) {
  return <div className="card kpi"><div className="value">{value}</div><div className="label">{label}</div></div>;
}

export function Bars({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="bars" role="img" aria-label={label}>
      {values.map((v, i) => <div key={i} style={{ height: `${Math.max(2, (v / max) * 100)}%` }} title={String(v)} />)}
    </div>
  );
}

export const when = (d?: string) => (d ? new Date(d).toLocaleString() : '');
