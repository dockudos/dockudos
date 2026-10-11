'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function Shell({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<{ email?: string; name?: string } | null | undefined>(undefined);
  const path = usePathname();
  useEffect(() => {
    api<{ user?: { email?: string; name?: string } }>('/api/v1/me').then((r) => setMe(r.user ?? null), () => setMe(null));
  }, []);
  // The preview frame is a bare page.
  if (path === '/preview-frame') return <>{children}</>;
  return (
    <>
      <header className="top">
        <Link href="/" className="brand">dockudos</Link>
        <span className="muted small">platform</span>
        <span className="spacer" />
        {me ? (
          <>
            <span className="small">{me.name ?? me.email}</span>
            <form action="/auth/logout" method="post"><button type="submit" className="small">Sign out</button></form>
          </>
        ) : me === null ? (
          <a href="/auth/login?returnTo=/">Sign in</a>
        ) : null}
      </header>
      {children}
    </>
  );
}
