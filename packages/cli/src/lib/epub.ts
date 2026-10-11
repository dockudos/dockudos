import {
  type Page,
  buildNavigation,
  expandAccessRules,
  findAccessRule,
  flattenSidebar,
  isRtl,
  pageMount,
  resolveDocLink,
  resolveScope,
  versionInfos,
} from '@dockudos/core';
import { readPageMarkdown } from '@dockudos/core/node';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { CliError, type Env } from './io.ts';
import { escapeXml, markdownToXhtml } from './markdown-xhtml.ts';
import { siteComponents } from './mcp.ts';
import { loadProject } from './project.ts';
import { createZip } from './zip.ts';

export interface EpubChapter {
  /** The page's address, so links between chapters can be found. */
  path: string;
  title: string;
  /** The navigation group the chapter belongs to, for the table of contents. */
  section?: string;
  markdown: string;
  /** The page's file inside its version and language, and its mount point: what its relative links resolve against. */
  file: string;
  mount: string;
  /** The page's file in the docs folder, for the images next to it. Default: `file`. */
  diskFile?: string;
}

export interface EpubImage {
  /** Name in the book, like `images/ab12cd.png`. */
  name: string;
  mediaType: string;
  data: Uint8Array;
}

export interface EpubOptions {
  title: string;
  /** Language tag, like `en` or `fr`. */
  language: string;
  rtl?: boolean;
  /** A stable identifier; the same book keeps the same one. */
  identifier: string;
  modified: Date;
  chapters: readonly EpubChapter[];
  /** An image a chapter refers to, found by the address written in it. */
  image?: (src: string, chapter: EpubChapter) => EpubImage | undefined;
}

const MEDIA: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};
export const imageType = (path: string): string | undefined =>
  MEDIA[extname(path).toLowerCase()];

const CSS = `body { font-family: serif; line-height: 1.5; margin: 1em; }
h1, h2, h3, h4, h5, h6 { font-family: sans-serif; line-height: 1.2; }
pre { white-space: pre-wrap; background: #f4f4f4; padding: 0.6em; font-size: 0.85em; }
code { font-family: monospace; font-size: 0.9em; }
blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #bbb; color: #444; }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid #bbb; padding: 0.25em 0.5em; text-align: start; }
img { max-width: 100%; }
`;

const fileOf = (n: number) => `chapter-${String(n + 1).padStart(3, '0')}.xhtml`;

/** The EPUB 3 package as bytes. Every chapter is well-formed XHTML; images that cannot be embedded show their alt text. */
export function buildEpub(o: EpubOptions): Uint8Array {
  const encoder = new TextEncoder();
  const text = (s: string) => encoder.encode(s);
  const lang = escapeXml(o.language);
  const dir = o.rtl ? ' dir="rtl"' : '';
  const chapterFile = new Map(o.chapters.map((c, i) => [c.path, fileOf(i)]));
  const images = new Map<string, EpubImage>();

  const chapters = o.chapters.map((chapter, i) => {
    const body = markdownToXhtml(chapter.markdown, {
      link(href) {
        const link = resolveDocLink(chapter.file, href, {
          prefix: chapter.mount,
        });
        if (link.kind === 'external')
          return /^(https?:|mailto:)/i.test(link.href) ? link.href : undefined;
        if (link.kind === 'anchor') return `#${link.hash}`;
        if (link.kind === 'internal') {
          const file = chapterFile.get(link.path);
          return file
            ? `${file}${link.hash ? `#${link.hash}` : ''}`
            : undefined;
        }
        return undefined;
      },
      image(src) {
        const found = o.image?.(src, chapter);
        if (!found) return undefined;
        images.set(found.name, found);
        return found.name;
      },
    });
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}"${dir}>
<head>
<meta charset="utf-8"/>
<title>${escapeXml(chapter.title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>
`;
    return { file: fileOf(i), id: `ch${i + 1}`, xhtml, chapter };
  });

  // Contents: chapters of one navigation group sit under the group's name.
  const toc: string[] = [];
  let open: string | undefined;
  for (const { file, chapter } of chapters) {
    if (chapter.section !== open) {
      if (open !== undefined) toc.push('</ol></li>');
      if (chapter.section !== undefined)
        toc.push(`<li><span>${escapeXml(chapter.section)}</span><ol>`);
      open = chapter.section;
    }
    toc.push(`<li><a href="${file}">${escapeXml(chapter.title)}</a></li>`);
  }
  if (open !== undefined) toc.push('</ol></li>');
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}"${dir}>
<head><meta charset="utf-8"/><title>${escapeXml(o.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<nav epub:type="toc" id="toc"><h1>${escapeXml(o.title)}</h1><ol>
${toc.join('\n')}
</ol></nav>
</body>
</html>
`;

  const imageList = [...images.values()];
  const modified = o.modified.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="pub-id">${escapeXml(o.identifier)}</dc:identifier>
<dc:title>${escapeXml(o.title)}</dc:title>
<dc:language>${lang}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
${chapters.map((c) => `<item id="${c.id}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('\n')}
${imageList.map((im, n) => `<item id="img${n + 1}" href="${escapeXml(im.name)}" media-type="${im.mediaType}"/>`).join('\n')}
</manifest>
<spine${o.rtl ? ' page-progression-direction="rtl"' : ''}>
<itemref idref="nav" linear="no"/>
${chapters.map((c) => `<itemref idref="${c.id}"/>`).join('\n')}
</spine>
</package>
`;

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;
  return createZip(
    [
      // The first file, stored, exactly this: how readers recognize an EPUB.
      { name: 'mimetype', data: text('application/epub+zip'), compress: false },
      { name: 'META-INF/container.xml', data: text(container) },
      { name: 'OEBPS/content.opf', data: text(opf) },
      { name: 'OEBPS/nav.xhtml', data: text(nav) },
      { name: 'OEBPS/style.css', data: text(CSS) },
      ...chapters.map((c) => ({
        name: `OEBPS/${c.file}`,
        data: text(c.xhtml),
      })),
      ...imageList.map((im) => ({ name: `OEBPS/${im.name}`, data: im.data })),
    ],
    o.modified,
  );
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'docs';

/** A repeatable id: the same site, version and language always get the same one. */
export const bookIdentifier = (name: string, scope: string): string => {
  const h = createHash('sha1').update(`${name}\0${scope}`).digest('hex');
  return `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/**
 * `dockudos epub`: write the docs as an EPUB book. Needs no server and no browser. `--version` and `--locale` pick a
 * version and language, `--path /guides` a section. Pages behind an `access` rule and untranslated stand-ins are
 * left out, and the command says how many.
 */
export async function epub(env: Env, args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      out: { type: 'string', short: 'o' },
      path: { type: 'string' },
      version: { type: 'string' },
      locale: { type: 'string' },
    },
  });
  const project = await loadProject(env.cwd);
  const { config } = project;
  const { scope, error } = resolveScope(config, {
    version: values.version,
    locale: values.locale,
  });
  if (error || !scope)
    throw new CliError(
      `${error} Check --version and --locale against docs.json.`,
    );
  if (values.path !== undefined && !/^\/[^\s?#]*$/.test(values.path))
    throw new CliError(
      '--path must be an address like /guides (starting with /).',
    );
  const view = project.views.find(
    (v) =>
      (v.variant.version ?? undefined) === scope.version &&
      (v.variant.locale ?? undefined) === scope.locale,
  );
  if (!view) throw new CliError('That version and language has no pages.');

  // The same navigation the site shows, so the book reads in the order of the sidebar.
  const own = versionInfos(config).find(
    (v) => v.name === scope.version,
  )?.navigation;
  const nav = buildNavigation(
    { navigation: own ?? config.navigation },
    view.tree,
    {
      lenient: view !== project.views[0],
    },
  );
  const rules = expandAccessRules(config.access.rules, config);
  const under =
    values.path && values.path !== '/'
      ? values.path.replace(/\/+$/, '')
      : undefined;
  const sections = new Map<Page, string | undefined>();
  for (const tab of nav.tabs)
    for (const item of tab.sidebar) {
      const group = item.type === 'group' ? item.title : undefined;
      for (const page of item.type === 'group'
        ? flattenSidebar(item.items)
        : item.type === 'page'
          ? [item.page]
          : [])
        if (!sections.has(page)) sections.set(page, group);
    }
  for (const page of nav.unlisted)
    if (!sections.has(page)) sections.set(page, undefined);

  let skippedProtected = 0;
  let skippedStandIn = 0;
  const pages = [...sections.keys()].filter((page) => {
    if (under && page.rel !== under && !page.rel.startsWith(`${under}/`))
      return false;
    if (findAccessRule(rules, page.path)) return !!(skippedProtected++, false);
    if (page.fallbackLocale) return !!(skippedStandIn++, false);
    return true;
  });
  if (pages.length === 0)
    throw new CliError(
      `No pages to put in the book${under ? ` below ${under}` : ''}.`,
    );

  const components = await siteComponents(env.cwd);
  const chapters: EpubChapter[] = await Promise.all(
    pages.map(async (page) => ({
      path: page.path,
      title: page.title,
      section: sections.get(page),
      markdown: await readPageMarkdown(project.docsDir, page, { components }),
      file: page.contentFile,
      diskFile: page.file,
      mount: pageMount(page),
    })),
  );

  const language = scope.locale ?? 'en';
  // The title names the version unless it is the latest, and the section when the book is one.
  const version = versionInfos(config).find((v) => v.name === scope.version);
  const title = [
    config.name,
    version && !version.isDefault ? version.label : '',
    under ? chapters[0]?.title : '',
  ]
    .filter(Boolean)
    .join(' – ');
  const bytes = buildEpub({
    title,
    language,
    rtl: isRtl(language),
    identifier: bookIdentifier(
      config.name,
      `${scope.version ?? ''}/${scope.locale ?? ''}${under ?? ''}`,
    ),
    modified: env.vars['SOURCE_DATE_EPOCH']
      ? new Date(Number(env.vars['SOURCE_DATE_EPOCH']) * 1000)
      : new Date(),
    chapters,
    image: (src, chapter) => {
      // Only pictures that are files of this project; addresses elsewhere are not fetched.
      if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src)) return undefined;
      const type = imageType(src.split(/[?#]/)[0] as string);
      if (!type) return undefined;
      const clean = decodeURI(src.split(/[?#]/)[0] as string);
      const file = clean.startsWith('/')
        ? join(env.cwd, 'public', clean)
        : resolve(
            project.docsDir,
            dirname(chapter.diskFile ?? chapter.file),
            clean,
          );
      try {
        // Inside the project only: a link or a `../` must not carry a file from elsewhere into the book.
        const real = realpathSync(file);
        const home = realpathSync(env.cwd);
        if (!real.startsWith(home + sep)) return undefined;
        const data = new Uint8Array(readFileSync(real));
        return {
          name: `images/${createHash('sha1').update(data).digest('hex').slice(0, 12)}${extname(clean).toLowerCase()}`,
          mediaType: type,
          data,
        };
      } catch {
        return undefined;
      }
    },
  });

  const out = resolve(
    env.cwd,
    values.out ??
      `${[slug(config.name), scope.version, scope.locale, under && slug(under)].filter(Boolean).join('-')}.epub`,
  );
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, bytes);
  const skipped = [
    skippedProtected && `${skippedProtected} protected`,
    skippedStandIn && `${skippedStandIn} untranslated`,
  ].filter(Boolean);
  env.out(
    `Wrote ${out} (${chapters.length} pages${skipped.length ? `; left out ${skipped.join(' and ')}` : ''}, ${Math.max(1, Math.round(bytes.length / 1024))} kB).\n`,
  );
  return 0;
}
