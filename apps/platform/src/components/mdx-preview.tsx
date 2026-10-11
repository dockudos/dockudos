'use client';

import { defineMdxComponents, DocsProvider } from '@dockudos/ui';
import { parseFrontmatter } from '@dockudos/core';
import { evaluate } from '@mdx-js/mdx';
import { type ComponentType, useEffect, useState } from 'react';
import * as runtime from 'react/jsx-runtime';

type Rendered =
  | {
      ok: true;
      Content: ComponentType<{ components?: Record<string, unknown> }>;
      title?: string;
    }
  | { ok: false; message: string };

/** Compile MDX the way the site does and keep the result. Syntax errors become a message, not a crash. */
export async function compile(source: string): Promise<Rendered> {
  try {
    let body = source;
    let title: string | undefined;
    try {
      const parsed = parseFrontmatter(source, 'page.mdx');
      body = parsed.body;
      title = parsed.data.title;
    } catch (e) {
      return {
        ok: false,
        message: (e as Error).message.split('\n')[0] ?? 'Invalid front matter',
      };
    }
    const mod = await evaluate(body, {
      ...(runtime as object),
      baseUrl: 'about:blank',
    } as never);
    return { ok: true, Content: mod.default as never, ...(title && { title }) };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

const components = defineMdxComponents();

/** The page as readers see it: the real dockudos components, driven by the MDX in the editor. */
export function MdxPreview({ source }: { source: string }) {
  const [rendered, setRendered] = useState<Rendered>();
  useEffect(() => {
    let live = true;
    void compile(source).then((r) => live && setRendered(r));
    return () => {
      live = false;
    };
  }, [source]);
  if (!rendered) return null;
  if (!rendered.ok)
    return (
      <pre
        role="alert"
        style={{ color: '#b91c1c', whiteSpace: 'pre-wrap', padding: 16 }}
      >
        {rendered.message}
      </pre>
    );
  const { Content, title } = rendered;
  return (
    <DocsProvider>
      <article className="prose" style={{ padding: '16px 20px' }}>
        {title && <h1>{title}</h1>}
        <Content components={components as never} />
      </article>
    </DocsProvider>
  );
}
