'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { use } from 'react';
import { ErrorBox, useApi } from '../../../components/ui';

export default function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const path = usePathname();
  const site = useApi<{
    site: { name: string; repo: string; provider: string; teamId: string };
    url?: string;
  }>(`/api/v1/sites/${id}`);
  const tabs = [
    ['Builds', ''],
    ['Editor', '/editor'],
    ['Analytics', '/analytics'],
    ['Agent', '/agent'],
  ] as const;
  const wide = path.endsWith('/editor');
  return (
    <main className={wide ? 'wide' : undefined}>
      <ErrorBox error={site.error} />
      {site.data && (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1>{site.data.site.name}</h1>
            <p className="muted small">
              <Link href={`/teams/${site.data.site.teamId}`}>
                Team settings
              </Link>{' '}
              · {site.data.site.provider}:{site.data.site.repo}
            </p>
          </div>
          {site.data.url && (
            <a
              className="btn"
              href={site.data.url}
              target="_blank"
              rel="noreferrer"
            >
              Open site
            </a>
          )}
        </div>
      )}
      <nav className="tabs" aria-label="Site sections">
        {tabs.map(([label, suffix]) => {
          const href = `/sites/${id}${suffix}`;
          return (
            <Link
              key={label}
              href={href}
              aria-current={path === href ? 'page' : undefined}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      {children}
    </main>
  );
}
