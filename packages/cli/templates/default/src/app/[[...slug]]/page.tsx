import { getSite, pageMetadata, staticParams } from '@dockudos/next/server';
import { DocsLayout } from '@dockudos/ui';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateStaticParams() {
  const site = await getSite();
  return staticParams(site);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ slug }, site] = await Promise.all([params, getSite()]);
  const page = site.find(slug);
  return page ? pageMetadata(site, page) : {};
}

export default async function DocsPage({ params }: Props) {
  const [{ slug }, site] = await Promise.all([params, getSite()]);
  const page = site.find(slug);
  if (!page) {
    // `/en/guides/a` and `/v2/guides/a` are the same page as `/guides/a`: send the reader to the short address.
    const short = site.redirectFor(slug ?? []);
    if (short) redirect(short);
    notFound();
  }
  const [{ default: Content }, toc, lastModified, graph] = await Promise.all([
    import(`../../../docs/${page.file}`),
    site.toc(page),
    site.lastModified(page),
    site.graph(page),
  ]);
  const multiple = site.views.length > 1;
  return (
    <DocsLayout
      config={site.config}
      // The sidebar of the page's own version and language, without links to pages the reader may not open.
      nav={site.navFor(page)}
      page={page}
      toc={toc}
      lastModified={lastModified}
      graph={graph}
      variant={multiple ? site.variantUi(page) : undefined}
      messages={multiple ? site.messages(page) : undefined}
    >
      <Content />
    </DocsLayout>
  );
}
