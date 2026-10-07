import { getSite, pageMetadata } from '@dockudos/next/server';
import { DocsLayout } from '@dockudos/ui';
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
  const [{ default: Content }, toc, lastModified, graph] = await Promise.all([
    import(`../../../docs/${page.file}`),
    site.toc(page),
    site.lastModified(page),
    site.graph(),
  ]);
  return (
    <DocsLayout
      config={site.config}
      nav={site.nav}
      page={page}
      toc={toc}
      lastModified={lastModified}
      graph={graph}
    >
      <Content />
    </DocsLayout>
  );
}
