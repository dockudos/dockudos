import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { imageSize } from 'image-size';
import type { Image, Root } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import { defaultImport, identifierAttribute } from './jsx.ts';

export interface RemarkImagesOptions {
  /** Absolute path of the project's `public` folder. */
  publicDir: string;
}

const isRelative = (url: string) => /^\.{1,2}\//.test(url);

/**
 * - `![](./pic.png)` becomes an import, so the bundler hashes the file and the
 *   `<img>` gets its real width and height (no layout shift).
 * - `![](/pic.png)` is looked up in `public/` and given width and height.
 * - Other URLs (remote, data:) are left alone.
 */
const remarkImages: Plugin<[RemarkImagesOptions], Root> =
  ({ publicDir }) =>
  (tree) => {
    const imports: ReturnType<typeof defaultImport>[] = [];

    visit(tree, 'image', (node: Image, index, parent) => {
      if (!parent || index === undefined) return;
      const url = decodeURI(node.url);

      if (isRelative(url)) {
        const local = `__dockudosImage${imports.length}`;
        imports.push(defaultImport(local, url));
        parent.children.splice(index, 1, {
          type: 'mdxJsxTextElement',
          name: 'img',
          attributes: [
            identifierAttribute('src', local),
            { type: 'mdxJsxAttribute', name: 'alt', value: node.alt ?? '' },
            ...(node.title
              ? [
                  {
                    type: 'mdxJsxAttribute' as const,
                    name: 'title',
                    value: node.title,
                  },
                ]
              : []),
          ],
          children: [],
        });
        return;
      }

      if (url.startsWith('/') && !url.startsWith('//')) {
        const file = join(publicDir, url.split(/[?#]/)[0] as string);
        if (!existsSync(file)) return;
        try {
          const { width, height } = imageSize(readFileSync(file));
          if (width && height) {
            node.data = {
              ...node.data,
              hProperties: {
                ...(node.data?.hProperties as object),
                width,
                height,
              },
            };
          }
        } catch {
          // unreadable or unsupported image: render without dimensions
        }
      }
    });

    tree.children.unshift(...imports);
  };

export default remarkImages;
