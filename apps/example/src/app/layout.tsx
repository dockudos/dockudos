import '@dockudos/ui/styles.css';
import { DocsRoot } from '@dockudos/next/client';
import { getSite, siteCss, siteMetadata } from '@dockudos/next/server';
import { ThemeScript } from '@dockudos/ui';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  return siteMetadata(await getSite());
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const site = await getSite();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript defaultMode={site.config.theme.mode} />
        <style dangerouslySetInnerHTML={{ __html: await siteCss(site) }} />
      </head>
      <body>
        <DocsRoot>{children}</DocsRoot>
      </body>
    </html>
  );
}
