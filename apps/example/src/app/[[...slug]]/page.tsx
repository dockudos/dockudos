import { getSite, pageMetadata } from '@dockudos/next/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateStaticParams() {
  const site = await getSite();
  return site.tree.pages.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ slug }, site] = await Promise.all([params, getSite()]);
  const page = site.find(slug);
  return page ? pageMetadata(site, page) : {};
}

export default async function DocsPage({ params }: Props) {
  const [{ slug }, site] = await Promise.all([params, getSite()]);
  const page = site.find(slug);
  if (!page) notFound();
  const { default: Content } = await import(`../../../docs/${page.file}`);
  return (
    <main>
      <Content />
    </main>
  );
}
