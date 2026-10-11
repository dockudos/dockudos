import './globals.css';
import type { Metadata } from 'next';
import { Shell } from '../components/shell';

export const metadata: Metadata = {
  title: 'dockudos platform',
  description: 'Edit, build and watch your docs.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
