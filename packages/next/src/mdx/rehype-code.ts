import rehypeShiki from '@shikijs/rehype';
import {
  transformerMetaHighlight,
  transformerNotationDiff,
  transformerNotationFocus,
  transformerNotationHighlight,
} from '@shikijs/transformers';
import type { Root } from 'hast';
import type { Plugin } from 'unified';

export interface RehypeCodeOptions {
  /** Run Twoslash on fences marked `twoslash`. Default true; needs `typescript`. */
  twoslash?: boolean;
}

type Transformer = NonNullable<
  NonNullable<Parameters<typeof rehypeShiki>[0]>['transformers']
>[number];

/**
 * Twoslash needs `typescript`, which is large, so it is optional: without it
 * `twoslash` fences are simply highlighted like any other code. Shiki's
 * transformer hooks are synchronous, so the import happens once, up front.
 */
const twoslashTransformer: Transformer | undefined = await (async () => {
  try {
    const [{ transformerTwoslash, rendererRich }, { createTwoslasher }] =
      await Promise.all([import('@shikijs/twoslash'), import('twoslash')]);
    // `explicitTrigger` limits it to fences that say `twoslash`.
    return transformerTwoslash({
      explicitTrigger: true,
      renderer: rendererRich(),
      twoslasher: createTwoslasher(),
    });
  } catch {
    return undefined;
  }
})();

const TITLE = /(?:^|\s)title=(?:"([^"]*)"|'([^']*)')/;

/**
 * Syntax highlighting with Shiki, light and dark themes at once through CSS
 * variables (so switching theme needs no re-render). Fence meta understood:
 * `title="a.ts"`, `{1,3-5}` line highlight, `showLineNumbers`, `twoslash`.
 * Comment notations `// [!code highlight]`, `[!code ++]`, `[!code --]`,
 * `[!code focus]` work too.
 */
const rehypeCode: Plugin<[RehypeCodeOptions?], Root> = ({
  twoslash = true,
} = {}) => {
  const transformers: Transformer[] = [
    transformerMetaHighlight(),
    transformerNotationHighlight(),
    transformerNotationDiff(),
    transformerNotationFocus(),
    {
      name: 'dockudos:meta',
      pre(node) {
        const raw = String(this.options.meta?.__raw ?? '');
        const title = TITLE.exec(raw);
        if (title) node.properties['data-title'] = title[1] ?? title[2];
        if (/(?:^|\s)showLineNumbers(?:\s|$)/.test(raw))
          node.properties['data-line-numbers'] = '';
        node.properties['data-language'] = this.options.lang;
      },
    },
  ];
  if (twoslash && twoslashTransformer) transformers.push(twoslashTransformer);

  const shiki = rehypeShiki as unknown as (
    this: unknown,
    o: unknown,
  ) => unknown;
  return shiki.call(this, {
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
    // Unknown languages fall back to plain text instead of failing the build.
    fallbackLanguage: 'text',
    transformers,
  }) as never;
};

export default rehypeCode;
