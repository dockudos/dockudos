import { embedContextFromParams } from '@dockudos/core';
import { getSite } from '@dockudos/next/server';
import { EmbeddedAssistant } from '@dockudos/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

// The assistant on a page of its own, for the embeddable widget (see "Embed the assistant" in the docs).
// Only sites listed in `ai.allowedOrigins` in docs.json may show it in a frame.
export const metadata: Metadata = {
  title: 'Ask the docs',
  robots: { index: false, follow: false },
};

export default async function EmbedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [site, params] = await Promise.all([getSite(), searchParams]);
  const { ai } = site.config;
  if (!ai.enabled) notFound();
  return (
    <EmbeddedAssistant
      name={site.config.name}
      endpoint={ai.endpoint}
      maxQuestionLength={ai.limits.maxQuestionLength}
      context={embedContextFromParams(params)}
    />
  );
}
