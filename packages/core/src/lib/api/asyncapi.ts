import { readPointer } from './bundle.ts';
import type { GeneratedFile } from './generate-openapi.ts';
import {
  code,
  escapeMdx,
  escapeParagraphs,
  fence,
  markdownPage,
  table,
} from './markdown-pages.ts';
import { exampleFromSchema } from './schema-view.ts';
import { slugify, summarize } from './text.ts';
import { ApiSpecError, type ApiSchema } from './types.ts';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v ? v : undefined;

export interface AsyncMessage {
  name: string;
  title?: string;
  summary?: string;
  description?: string;
  contentType?: string;
  payload?: unknown;
  headers?: unknown;
}
export interface AsyncOperation {
  /** `send`: the application sends it to the channel. `receive`: the application receives from it. */
  action: 'send' | 'receive';
  summary?: string;
  description?: string;
  messages: AsyncMessage[];
}
export interface AsyncChannel {
  id: string;
  address: string;
  description?: string;
  parameters: { name: string; description?: string }[];
  operations: AsyncOperation[];
  /** Messages that no operation lists (AsyncAPI 3 channels carry messages themselves). */
  messages: AsyncMessage[];
}
export interface AsyncServer {
  name: string;
  url: string;
  protocol: string;
  description?: string;
}
export interface AsyncModel {
  title: string;
  version?: string;
  description?: string;
  servers: AsyncServer[];
  channels: AsyncChannel[];
}

/**
 * Follow `$ref`s inside the document so every part is plain data. A reference that comes back to itself ends in `{}`,
 * so circular payloads are finite.
 */
function inline(doc: unknown, node: unknown, seen: string[] = []): unknown {
  if (Array.isArray(node)) return node.map((n) => inline(doc, n, seen));
  if (!isObject(node)) return node;
  if (typeof node.$ref === 'string') {
    const ref = node.$ref;
    if (!ref.startsWith('#')) return {};
    if (seen.includes(ref)) return {};
    return inline(doc, readPointer(doc, ref) ?? {}, [...seen, ref]);
  }
  return Object.fromEntries(
    Object.entries(node).map(([k, v]) => [k, inline(doc, v, seen)]),
  );
}

/** AsyncAPI 2.x and 3.x into one model of servers, channels, operations and messages. */
export function normalizeAsyncApi(doc: unknown, source: string): AsyncModel {
  if (!isObject(doc) || typeof doc.asyncapi !== 'string')
    throw new ApiSpecError(source, 'has no "asyncapi" version field');
  const major = Number.parseInt(doc.asyncapi, 10);
  if (major !== 2 && major !== 3)
    throw new ApiSpecError(
      source,
      `is AsyncAPI ${doc.asyncapi}; only 2.x and 3.x are supported`,
    );
  const info = isObject(doc.info) ? doc.info : {};
  if (!str(info.title)) throw new ApiSpecError(source, 'has no "info.title"');

  const message = (raw: unknown, fallback: string): AsyncMessage => {
    const m = inline(doc, raw);
    const o = isObject(m) ? m : {};
    return {
      name: str(o.name) ?? str(o.messageId) ?? str(o.title) ?? fallback,
      ...(str(o.title) && { title: str(o.title) }),
      ...(str(o.summary) && { summary: str(o.summary) }),
      ...(str(o.description) && { description: str(o.description) }),
      ...(str(o.contentType) && { contentType: str(o.contentType) }),
      ...(o.payload !== undefined && { payload: o.payload }),
      ...(o.headers !== undefined && { headers: o.headers }),
    };
  };
  const messagesOf = (raw: unknown, prefix: string): AsyncMessage[] => {
    const resolved = inline(doc, raw);
    if (isObject(resolved) && Array.isArray(resolved.oneOf))
      return resolved.oneOf.map((m, i) => message(m, `${prefix} ${i + 1}`));
    if (Array.isArray(raw))
      return raw.map((m, i) => message(m, `${prefix} ${i + 1}`));
    return raw === undefined ? [] : [message(raw, prefix)];
  };
  const parameters = (raw: unknown) =>
    isObject(raw)
      ? Object.entries(raw).map(([name, p]) => {
          const o = inline(doc, p);
          return {
            name,
            ...(isObject(o) &&
              str(o.description) && { description: str(o.description) }),
          };
        })
      : [];

  const servers: AsyncServer[] = [];
  for (const [name, s] of Object.entries(
    isObject(doc.servers) ? doc.servers : {},
  )) {
    const o = inline(doc, s);
    if (!isObject(o)) continue;
    const url =
      major === 3
        ? `${str(o.host) ?? ''}${str(o.pathname) ?? ''}`
        : (str(o.url) ?? '');
    servers.push({
      name,
      url,
      protocol: str(o.protocol) ?? '',
      ...(str(o.description) && { description: str(o.description) }),
    });
  }

  const channels: AsyncChannel[] = [];
  if (major === 2) {
    for (const [address, c] of Object.entries(
      isObject(doc.channels) ? doc.channels : {},
    )) {
      const o = inline(doc, c);
      if (!isObject(o)) continue;
      const operations: AsyncOperation[] = [];
      // v2 names the operation from the application's side the other way round: `publish` is what clients publish,
      // so the application receives it.
      for (const [key, action] of [
        ['publish', 'receive'],
        ['subscribe', 'send'],
      ] as const) {
        const op = o[key];
        if (!isObject(op)) continue;
        operations.push({
          action,
          ...(str(op.summary) && { summary: str(op.summary) }),
          ...(str(op.description) && { description: str(op.description) }),
          messages: messagesOf(
            op.message,
            str(op.operationId) ?? `${key} message`,
          ),
        });
      }
      channels.push({
        id: address,
        address,
        ...(str(o.description) && { description: str(o.description) }),
        parameters: parameters(o.parameters),
        operations,
        messages: [],
      });
    }
  } else {
    const ops = isObject(doc.operations) ? doc.operations : {};
    for (const [id, c] of Object.entries(
      isObject(doc.channels) ? doc.channels : {},
    )) {
      const o = inline(doc, c);
      if (!isObject(o)) continue;
      const channelRef = (name: string) =>
        `#/channels/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      const operations: AsyncOperation[] = [];
      for (const op of Object.values(ops)) {
        if (
          !isObject(op) ||
          !isObject(op.channel) ||
          op.channel.$ref !== channelRef(id)
        )
          continue;
        const resolvedOp = inline(doc, op) as Json;
        const msgs = Array.isArray(op.messages)
          ? op.messages.map((m, i) => message(m, `message ${i + 1}`))
          : Object.entries(isObject(o.messages) ? o.messages : {}).map(
              ([n, m]) => message(m, n),
            );
        operations.push({
          action: op.action === 'send' ? 'send' : 'receive',
          ...(str(resolvedOp.summary) && { summary: str(resolvedOp.summary) }),
          ...(str(resolvedOp.description) && {
            description: str(resolvedOp.description),
          }),
          messages: msgs,
        });
      }
      const own = Object.entries(isObject(o.messages) ? o.messages : {}).map(
        ([n, m]) => message(m, n),
      );
      channels.push({
        id,
        address: str(o.address) ?? id,
        ...(str(o.description) && { description: str(o.description) }),
        parameters: parameters(o.parameters),
        operations,
        messages: operations.length ? [] : own,
      });
    }
  }

  return {
    title: info.title as string,
    ...(str(info.version) && { version: str(info.version) }),
    ...(str(info.description) && { description: str(info.description) }),
    servers,
    channels,
  };
}

function messageSection(m: AsyncMessage): string {
  const out = [`#### ${escapeMdx(m.title ?? m.name)}`];
  const facts = [
    m.name !== (m.title ?? m.name) ? `Name ${code(m.name)}` : '',
    m.contentType ? `Content type ${code(m.contentType)}` : '',
  ].filter(Boolean);
  if (facts.length) out.push(facts.join(' · '));
  if (m.summary) out.push(escapeParagraphs(m.summary));
  if (m.description) out.push(escapeParagraphs(m.description));
  if (m.payload !== undefined) {
    out.push('**Payload**', fence(JSON.stringify(m.payload, null, 2), 'json'));
    const example = exampleFromSchema(m.payload as ApiSchema, () => undefined);
    out.push('**Example**', fence(JSON.stringify(example, null, 2), 'json'));
  }
  if (m.headers !== undefined)
    out.push('**Headers**', fence(JSON.stringify(m.headers, null, 2), 'json'));
  return out.join('\n\n');
}

export interface AsyncGenerateOptions {
  name: string;
  mount: string;
  docsDir?: string;
  title?: string;
}

/** An overview, a page for the servers and one page for each channel. */
export function generateAsyncApi(
  model: AsyncModel,
  { name, mount, docsDir = 'docs', title }: AsyncGenerateOptions,
): { files: GeneratedFile[]; operations: number; pages: number } {
  const base = `${docsDir}/${mount}`;
  const files: GeneratedFile[] = [];
  const slugs = new Set<string>();
  const slugFor = (id: string) => {
    let slug = slugify(id);
    for (
      let i = 2;
      slugs.has(slug) || slug === 'index' || slug === 'servers';
      i++
    )
      slug = `${slugify(id)}-${i}`;
    slugs.add(slug);
    return slug;
  };

  const overview: string[] = [];
  if (model.description) overview.push(escapeParagraphs(model.description));
  if (model.version) overview.push(`**Version:** ${escapeMdx(model.version)}`);
  overview.push(
    '## Channels',
    table(
      ['Address', 'Operations'],
      model.channels.map((c) => [
        c.address,
        c.operations.map((o) => o.action).join(', ') || 'messages',
      ]),
    ),
  );
  files.push({
    file: `${base}/index.mdx`,
    content: markdownPage(
      {
        title: title ?? model.title,
        description: summarize(model.description),
        source: name,
        kind: 'overview',
        order: -2,
      },
      overview.join('\n\n'),
    ),
  });

  files.push({
    file: `${base}/servers.mdx`,
    content: markdownPage(
      { title: 'Servers', source: name, kind: 'servers', order: -1 },
      model.servers.length
        ? table(
            ['Name', 'URL', 'Protocol', 'Description'],
            model.servers.map((s) => [
              s.name,
              s.url,
              s.protocol,
              s.description ?? '',
            ]),
          )
        : 'The spec lists no servers.',
    ),
  });

  model.channels.forEach((c, order) => {
    const body: string[] = [`Address: ${code(c.address)}`];
    if (c.description) body.push(escapeParagraphs(c.description));
    if (c.parameters.length)
      body.push(
        '## Parameters',
        table(
          ['Name', 'Description'],
          c.parameters.map((p) => [p.name, p.description ?? '']),
        ),
      );
    for (const op of c.operations) {
      body.push(
        `## ${op.action === 'send' ? 'Send' : 'Receive'}${op.summary ? `: ${escapeMdx(op.summary)}` : ''}`,
      );
      body.push(
        op.action === 'send'
          ? 'The application sends these messages to the channel.'
          : 'The application receives these messages from the channel.',
      );
      if (op.description) body.push(escapeParagraphs(op.description));
      body.push(...op.messages.map(messageSection));
    }
    if (c.messages.length)
      body.push('## Messages', ...c.messages.map(messageSection));
    files.push({
      file: `${base}/channels/${slugFor(c.id)}.mdx`,
      content: markdownPage(
        {
          title: c.address,
          description: summarize(c.description),
          source: name,
          kind: 'channel',
          group: 'Channels',
          order,
        },
        body.join('\n\n'),
      ),
    });
  });

  return {
    files,
    operations: model.channels.length,
    pages: model.channels.length,
  };
}
