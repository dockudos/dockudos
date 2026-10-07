import './global.css';
import { getSite, siteMetadata } from '@dockudos/next/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  return siteMetadata(await getSite());
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
