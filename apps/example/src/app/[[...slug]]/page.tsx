import { discoverPages, loadConfig } from '@dockudos/core/node';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { join } from 'node:path';

const docsDir = () => join(process.cwd(), 'docs');

async function findPage(slug: string[] = []) {
  const tree = await discoverPages(docsDir());
  return tree.pages.find((p) => p.slug.join('/') === slug.join('/'));
}

export async function generateStaticParams() {
  const tree = await discoverPages(docsDir());
  return tree.pages.map((p) => ({ slug: p.slug }));
}

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ slug }, config] = await Promise.all([
    params,
    loadConfig(process.cwd()),
  ]);
  const page = await findPage(slug);
  return { title: page ? `${page.title} | ${config.name}` : config.name };
}

export default async function DocsPage({ params }: Props) {
  const { slug } = await params;
  const page = await findPage(slug);
  if (!page) notFound();
  const { default: Content } = await import(`../../../docs/${page.file}`);
  return (
    <main>
      <Content />
    </main>
  );
}
