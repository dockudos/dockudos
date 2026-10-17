import { posix } from 'node:path';
import { highlightFor } from './code-samples.ts';
import { exampleFromSchema, hasContent, typeLabel } from './schema-view.ts';
import {
  escapeMdx,
  escapeParagraphs,
  fence,
  schemaFileName,
  slugify,
  summarize,
  yamlString,
} from './text.ts';
import type {
  ApiMediaType,
  ApiModel,
  ApiOperation,
  ApiOperationData,
  ApiSchema,
} from './types.ts';

/** A file the generator wants to exist, relative to the project root. */
export interface GeneratedFile {
  file: string;
  content: string;
}

export interface GenerateResult {
  files: GeneratedFile[];
  /** Operations in the spec. */
  operations: number;
  /** Endpoint pages written. Always equals `operations`. */
  pages: number;
  /** Problems in the spec that did not stop generation. */
  warnings?: string[];
}

export interface GenerateOptions {
  /** The source's `name`. */
  name: string;
  /** Where the pages are mounted below the docs folder, like `api-reference`. */
  mount: string;
  groupBy: 'tag' | 'path';
  playground: boolean;
  /** How samples written in the spec (`x-codeSamples`) combine with the generated ones. Default `replace`. */
  samplesMode?: 'replace' | 'append' | 'generated-only';
  /** Send playground requests through the site's proxy route. */
  proxy?: boolean;
  /** Folder with the MDX files, relative to the project root. Default `docs`. */
  docsDir?: string;
  /** `urlPrefix` of the site, for links between generated pages. */
  urlPrefix?: string;
  /** Title of the overview page. Default: the title in the spec. */
  title?: string;
}

export const DATA_ROOT = '.dockudos/api';
export const PUBLIC_ROOT = 'public/_dockudos/api';

/** The URL the browser loads a source's lazily loaded schemas from. */
export const schemasUrl = (name: string): string =>
  `/_dockudos/api/${name}/schemas`;

interface Group {
  name: string;
  slug: string;
  description?: string;
  operations: { op: ApiOperation; order: number; file: string; id: string }[];
}

/** Which group an operation is listed under. */
function groupName(op: ApiOperation, groupBy: 'tag' | 'path'): string {
  if (groupBy === 'path') {
    return op.path.split('/').find((s) => s && !s.startsWith('{')) ?? 'root';
  }
  return op.tags[0] ?? 'Endpoints';
}

/**
 * Pages and data for one OpenAPI source: an overview, one page per operation, and the data they load. Pages are MDX
 * that embed the operation as JSON, so the build compiles them like any other page and the search index, the
 * Markdown twins and the assistant read them like any other page.
 */
export function generateOpenApi(
  model: ApiModel,
  options: GenerateOptions,
): GenerateResult {
  const { name, mount, groupBy, docsDir = 'docs' } = options;
  const base = posix.join(docsDir, mount);
  const files: GeneratedFile[] = [];

  // Groups in the order of the spec's tags, then in order of first use.
  const groups = new Map<string, Group>();
  const tagOrder = new Map(model.tags.map((t, i) => [t.name, i]));
  const slugs = new Set<string>();
  const groupFor = (n: string): Group => {
    let g = groups.get(n);
    if (!g) {
      let slug = slugify(n);
      for (let i = 2; slugs.has(slug) || slug === 'index'; i++)
        slug = `${slugify(n)}-${i}`;
      slugs.add(slug);
      g = {
        name: n,
        slug,
        description:
          groupBy === 'tag'
            ? model.tags.find((t) => t.name === n)?.description
            : undefined,
        operations: [],
      };
      groups.set(n, g);
    }
    return g;
  };
  model.operations.forEach((op, order) => {
    const g = groupFor(groupName(op, groupBy));
    const id = op.id === 'index' ? 'index-operation' : op.id;
    g.operations.push({
      op,
      order,
      id,
      file: `${posix.join(base, g.slug, id)}.mdx`,
    });
  });
  const ordered = [...groups.values()].sort(
    (a, b) =>
      (tagOrder.get(a.name) ?? 1e6) - (tagOrder.get(b.name) ?? 1e6) ||
      (a.operations[0]?.order ?? 0) - (b.operations[0]?.order ?? 0),
  );

  const lookup = (n: string) => model.schemas[n];
  for (const g of ordered) {
    for (const { op, order, id, file } of g.operations) {
      const dataFile = `${DATA_ROOT}/${name}/ops/${id}.json`;
      files.push({
        file: dataFile,
        content: JSON.stringify(
          operationData(
            model,
            op,
            options.playground,
            lookup,
            options.samplesMode,
          ),
        ),
      });
      files.push({
        file,
        content: operationPage(op, {
          source: name,
          group: g.name,
          order,
          dataImport: posix.relative(posix.dirname(file), dataFile),
          schemas: schemasUrl(name),
          playground: options.playground,
          proxy: !!options.proxy,
        }),
      });
    }
  }

  for (const [schemaName, schema] of Object.entries(model.schemas)) {
    files.push({
      file: `${PUBLIC_ROOT}/${name}/schemas/${schemaFileName(schemaName)}.json`,
      content: JSON.stringify(schema),
    });
  }

  // Where the playground proxy may send requests: the servers of the spec.
  files.push({
    file: `${DATA_ROOT}/${name}/servers.json`,
    content: JSON.stringify([
      ...new Set([
        ...model.servers.map((s) => s.url),
        ...model.operations.flatMap((o) => o.servers?.map((s) => s.url) ?? []),
      ]),
    ]),
  });

  files.push({
    file: `${posix.join(base, 'index')}.mdx`,
    content: overviewPage(model, ordered, options),
  });

  const operations = model.operations.length;
  return {
    files,
    operations,
    pages: ordered.reduce((n, g) => n + g.operations.length, 0),
    ...(model.warnings?.length && { warnings: model.warnings }),
  };
}

// -- operation data ---------------------------------------------------------

function operationData(
  model: ApiModel,
  op: ApiOperation,
  playground: boolean,
  lookup: (name: string) => ApiSchema | undefined,
  samplesMode?: 'replace' | 'append' | 'generated-only',
): ApiOperationData {
  const expanded: ApiOperation = {
    ...op,
    parameters: op.parameters.map((p) =>
      p.schema ? { ...p, schema: expandRoot(p.schema, model) } : p,
    ),
    ...(op.requestBody && {
      requestBody: {
        ...op.requestBody,
        content: mapMedia(op.requestBody.content, model, lookup, 'readOnly'),
      },
    }),
    responses: op.responses.map((r) => ({
      ...r,
      headers: r.headers.map((h) =>
        h.schema ? { ...h, schema: expandRoot(h.schema, model) } : h,
      ),
      content: mapMedia(r.content, model, lookup, 'writeOnly'),
    })),
  };
  const names = new Set(op.security.flatMap((alt) => Object.keys(alt)));
  const servers = op.servers ?? model.servers;
  return {
    operation: expanded,
    servers,
    securitySchemes: Object.fromEntries(
      Object.entries(model.securitySchemes).filter(([n]) => names.has(n)),
    ),
    ...(!playground || op.webhook ? { noPlayground: true } : {}),
    ...(samplesMode && samplesMode !== 'replace' ? { samplesMode } : {}),
  };
}

const isJsonMime = (mime: string) => /json/i.test(mime);

function mapMedia(
  content: Record<string, ApiMediaType>,
  model: ApiModel,
  lookup: (name: string) => ApiSchema | undefined,
  skip: 'readOnly' | 'writeOnly',
): Record<string, ApiMediaType> {
  return Object.fromEntries(
    Object.entries(content).map(([mime, media]) => {
      const examples =
        Object.keys(media.examples).length || !media.schema || !isJsonMime(mime)
          ? media.examples
          : {
              example: {
                summary: 'Example',
                value: exampleFromSchema(media.schema, lookup, { skip }),
              },
            };
      return [
        mime,
        {
          ...(media.schema && { schema: expandRoot(media.schema, model) }),
          examples,
        },
      ];
    }),
  );
}

/**
 * Show a schema's top level in the page itself: a reference becomes the schema it names (its own properties stay
 * references, loaded when the reader opens them), and so do the parts of `allOf`, which are needed to merge it.
 */
export function expandRoot(
  schema: ApiSchema,
  model: Pick<ApiModel, 'schemas'>,
  depth = 0,
  seen: ReadonlySet<string> = new Set(),
): ApiSchema {
  if (schema.ref && !hasContent(schema)) {
    const target = model.schemas[schema.ref];
    if (!target || seen.has(schema.ref) || depth > 3) return schema;
    const next = new Set(seen).add(schema.ref);
    return expandRoot(
      {
        ...target,
        ref: schema.ref,
        ...(schema.description && { description: schema.description }),
      },
      model,
      depth,
      next,
    );
  }
  const out: ApiSchema = { ...schema };
  if (out.items) out.items = expandRoot(out.items, model, depth, seen);
  if (out.allOf)
    out.allOf = out.allOf.map((s) => expandRoot(s, model, depth, seen));
  for (const key of ['oneOf', 'anyOf'] as const) {
    if (out[key])
      out[key] = out[key].map((s) => expandRoot(s, model, depth + 2, seen));
  }
  return out;
}

// -- pages ------------------------------------------------------------------

const METHOD_LABEL = (m: string) => m.toUpperCase();

function operationPage(
  op: ApiOperation,
  ctx: {
    source: string;
    group: string;
    order: number;
    dataImport: string;
    schemas: string;
    playground: boolean;
    proxy: boolean;
  },
): string {
  const title = op.summary ?? `${METHOD_LABEL(op.method)} ${op.path}`;
  const description = summarize(op.description);
  const sections: string[] = [];
  const hasParams = op.parameters.length > 0;
  const hasBody =
    !!op.requestBody && Object.keys(op.requestBody.content).length > 0;
  if (hasParams) sections.push('## Parameters\n\n<ApiParameters />');
  if (hasBody) sections.push('## Request body\n\n<ApiRequestBody />');
  if (op.responses.length) sections.push('## Responses\n\n<ApiResponses />');
  if (!op.webhook) {
    sections.push(
      `## ${ctx.playground ? 'Try it' : 'Code samples'}\n\n<ApiPlayground />`,
    );
  }

  return `---
title: ${yamlString(title)}
${description ? `description: ${yamlString(description)}\n` : ''}${op.summary ? `sidebarTitle: ${yamlString(op.summary)}\n` : ''}api:
  source: ${yamlString(ctx.source)}
  kind: ${op.webhook ? 'webhook' : 'operation'}
  method: ${op.method}
  endpoint: ${yamlString(op.path)}
  group: ${yamlString(ctx.group)}
  order: ${ctx.order}
---

{/* Generated by \`dockudos generate\` from the OpenAPI source "${escapeComment(ctx.source)}". Changes are overwritten. */}

import data from ${JSON.stringify(ctx.dataImport)}

<Endpoint method=${JSON.stringify(METHOD_LABEL(op.method))} path=${JSON.stringify(op.path)} />

<ApiOperation data={data} schemasUrl=${JSON.stringify(ctx.schemas)}${ctx.proxy ? ' proxy' : ''}>

${sections.join('\n\n')}

</ApiOperation>

<Visibility for="agents">

${agentMarkdown(op)}

</Visibility>
`;
}

const escapeComment = (s: string) => s.replace(/[*/{}\\`]/g, '');

/** The operation as Markdown for AI tools: everything the page shows, with text from the spec escaped. */
function agentMarkdown(op: ApiOperation): string {
  const out: string[] = [];
  out.push(`\`${METHOD_LABEL(op.method)} ${op.path.replaceAll('`', '')}\``);
  if (op.deprecated) out.push('**Deprecated.**');
  if (op.description) out.push(escapeParagraphs(op.description));
  if (op.parameters.length) {
    out.push(
      '### Parameters',
      [
        '| Name | In | Type | Required | Description |',
        '| --- | --- | --- | --- | --- |',
        ...op.parameters.map(
          (p) =>
            `| ${escapeMdx(p.name)} | ${p.in} | ${escapeMdx(typeLabel(p.schema))} | ${p.required ? 'yes' : 'no'} | ${escapeMdx(p.description ?? '')} |`,
        ),
      ].join('\n'),
    );
  }
  if (op.requestBody) {
    out.push('### Request body');
    if (op.requestBody.description)
      out.push(escapeParagraphs(op.requestBody.description));
    for (const [mime, media] of Object.entries(op.requestBody.content)) {
      out.push(`Content type: \`${mime.replaceAll('`', '')}\``);
      out.push(...exampleBlocks(media));
    }
  }
  if (op.responses.length) {
    out.push('### Responses');
    for (const r of op.responses) {
      out.push(
        `**${escapeMdx(r.status)}**${r.description ? `: ${escapeMdx(r.description)}` : ''}`,
      );
      for (const [mime, media] of Object.entries(r.content)) {
        out.push(
          `Content type: \`${mime.replaceAll('`', '')}\``,
          ...exampleBlocks(media),
        );
      }
    }
  }
  if (op.codeSamples?.length) {
    out.push('### Code samples');
    for (const s of op.codeSamples) {
      out.push(
        `**${escapeMdx(s.label)}**`,
        fence(s.source, highlightFor(s.lang)),
      );
    }
  }
  return out.join('\n\n');
}

function exampleBlocks(media: ApiMediaType): string[] {
  const first = Object.values(media.examples)[0];
  if (!first) return [];
  const text =
    typeof first.value === 'string'
      ? first.value
      : JSON.stringify(first.value, null, 2);
  return [fence(text ?? '', typeof first.value === 'string' ? '' : 'json')];
}

function overviewPage(
  model: ApiModel,
  groups: Group[],
  options: GenerateOptions,
): string {
  const prefix = options.urlPrefix ?? '';
  const out: string[] = [];
  if (model.description) out.push(escapeParagraphs(model.description));
  const meta: string[] = [];
  if (model.version) meta.push(`**Version:** ${escapeMdx(model.version)}`);
  if (model.servers.length) {
    meta.push(
      '**Servers**',
      ...model.servers.map(
        (s) =>
          `- \`${s.url.replaceAll('`', '')}\`${s.description ? ` ${escapeMdx(s.description)}` : ''}`,
      ),
    );
  }
  if (meta.length) out.push(meta.join('\n\n'));
  const schemes = Object.entries(model.securitySchemes);
  if (schemes.length) {
    out.push(
      '## Authentication',
      schemes
        .map(
          ([n, s]) => `- **${escapeMdx(n)}**: ${escapeMdx(describeScheme(s))}`,
        )
        .join('\n'),
    );
  }
  for (const g of groups) {
    out.push(`## ${escapeMdx(g.name)}`);
    if (g.description) out.push(escapeParagraphs(g.description));
    out.push(
      [
        '| Method | Path | Summary |',
        '| --- | --- | --- |',
        ...g.operations.map(({ op, id }) => {
          const href = `${prefix}/${posix.join(options.mount, g.slug, id)}`;
          const label = escapeMdx(op.summary ?? op.path);
          return `| ${METHOD_LABEL(op.method)} | ${escapeMdx(op.path)} | [${label}](${href.replace(/[()\s]/g, encodeURIComponent)}) |`;
        }),
      ].join('\n'),
    );
  }
  return `---
title: ${yamlString(options.title ?? model.title)}
description: ${yamlString(summarize(model.description) ?? `Reference for the ${model.title} API.`)}
api:
  source: ${yamlString(options.name)}
  kind: overview
  order: -1
---

{/* Generated by \`dockudos generate\`. Changes are overwritten. */}

${out.join('\n\n')}
`;
}

function describeScheme(s: ApiModel['securitySchemes'][string]): string {
  switch (s.type) {
    case 'apiKey':
      return `API key in the ${s.in} \`${s.name}\``;
    case 'http':
      return `HTTP ${s.scheme}${s.bearerFormat ? ` (${s.bearerFormat})` : ''}`;
    case 'oauth2':
      return `OAuth 2.0 (${Object.keys(s.flows).join(', ') || 'no flows'})`;
    case 'openIdConnect':
      return 'OpenID Connect';
    case 'mutualTLS':
      return 'Mutual TLS';
  }
}
