import { bookRequest, getSite } from '@dockudos/next/server';
import { DocsBook } from '@dockudos/ui';
import type { Metadata } from 'next';

// Every page in one document. Open /print and use the browser's Print, or run `dockudos pdf`.
export async function generateMetadata(): Promise<Metadata> {
  const { config } = await getSite();
  // The title becomes the PDF's document title.
  return {
    title: { absolute: `${config.name} documentation` },
    robots: { index: false, follow: false },
  };
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PrintPage({ searchParams }: Props) {
  const site = await getSite();
  // `?version=`, `?locale=` and `?path=` print one version, language or section; `dockudos pdf` sets them.
  const { scope, under, nav } = await bookRequest(site, searchParams);
  const book = await site.book({ scope, under });
  const sections = await Promise.all(
    book.map(async ({ page, toc }) => {
      const { default: Content } = await import(`../../../docs/${page.file}`);
      return { page, toc, node: <Content /> };
    }),
  );
  return (
    <DocsBook
      config={site.config}
      nav={nav}
      sections={sections}
      generatedAt={new Date()}
    />
  );
}
