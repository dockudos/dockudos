import './global.css';
import { loadConfig } from '@dockudos/core/node';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const config = await loadConfig(process.cwd());
  return { title: config.name };
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
