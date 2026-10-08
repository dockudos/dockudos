import { readPointer } from './bundle.ts';
import {
  type ApiExample,
  type ApiMediaType,
  type ApiMethod,
  type ApiModel,
  type ApiOperation,
  type ApiParameter,
  type ApiRequestBody,
  type ApiResponse,
  type ApiSchema,
  type ApiSecurityScheme,
  type ApiServer,
  ApiSpecError,
  HTTP_METHODS,
  type ParameterLocation,
  type SchemaType,
} from './types.ts';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const SCHEMA_TYPES = new Set<string>([
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
  'null',
]);

/** Is this a document we can read: OpenAPI 3.0 or 3.1? Swagger 2.0 gets its own message. */
export function openApiVersion(
  doc: unknown,
): '3.0' | '3.1' | '2.0' | undefined {
  if (!isObject(doc)) return undefined;
  if (typeof doc.openapi === 'string') {
    if (/^3\.0\./.test(doc.openapi)) return '3.0';
    if (/^3\.1\./.test(doc.openapi)) return '3.1';
    return undefined;
  }
  if (doc.swagger === '2.0') return '2.0';
  return undefined;
}

/**
 * Turn a parsed OpenAPI document, whose references are all inside it (see `bundleExternalRefs`), into the normalised
 * model. 3.0 and 3.1 give the same result for the same API.
 */
export function normalizeOpenApi(doc: unknown, source: string): ApiModel {
  const version = openApiVersion(doc);
  if (version === '2.0') {
    throw new ApiSpecError(
      source,
      'is a Swagger 2.0 document, which is not supported. Convert it to OpenAPI 3 first (for example with swagger2openapi).',
    );
  }
  if (!version || !isObject(doc)) {
    throw new ApiSpecError(
      source,
      'is not an OpenAPI 3.0 or 3.1 document (no "openapi: 3.x" field)',
    );
  }
  if (!isObject(doc.info) || typeof doc.info.title !== 'string') {
    throw new ApiSpecError(source, 'has no "info.title"');
  }
  if (!isObject(doc.paths) && !isObject(doc.webhooks)) {
    throw new ApiSpecError(source, 'has no "paths"');
  }
  return new Normalizer(doc, source).run();
}

class Normalizer {
  /** pointer -> name of the schema in `schemas` */
  private readonly names = new Map<string, string>();
  private readonly taken = new Set<string>();
  private readonly queue: { name: string; node: unknown }[] = [];
  private readonly schemas: Record<string, ApiSchema> = {};
  private readonly ids = new Set<string>();

  private readonly doc: Json;
  private readonly source: string;

  constructor(doc: Json, source: string) {
    this.doc = doc;
    this.source = source;
  }

  run(): ApiModel {
    const { doc } = this;
    const info = doc.info as Json;
    const operations: ApiOperation[] = [];

    const pathItems = isObject(doc.paths) ? doc.paths : {};
    for (const [path, rawItem] of Object.entries(pathItems)) {
      const item = this.deref(rawItem);
      if (!isObject(item)) continue;
      operations.push(...this.pathItem(path, item, false));
    }
    const hooks = isObject(doc.webhooks) ? doc.webhooks : {};
    for (const [name, rawItem] of Object.entries(hooks)) {
      const item = this.deref(rawItem);
      if (!isObject(item)) continue;
      operations.push(...this.pathItem(name, item, true));
    }

    // Named schemas are normalised after the operations, in the order they were first referenced.
    while (this.queue.length) {
      const { name, node } = this.queue.shift() as {
        name: string;
        node: unknown;
      };
      this.schemas[name] = this.schema(node);
    }

    const components = isObject(doc.components) ? doc.components : {};
    const securitySchemes: Record<string, ApiSecurityScheme> = {};
    for (const [name, raw] of Object.entries(
      isObject(components.securitySchemes) ? components.securitySchemes : {},
    )) {
      const scheme = this.securityScheme(this.deref(raw));
      if (scheme) securitySchemes[name] = scheme;
    }

    return {
      title: info.title as string,
      ...(str(info.version) && { version: str(info.version) }),
      ...(str(info.description) && { description: str(info.description) }),
      servers: this.servers(doc.servers),
      tags: list(doc.tags).flatMap((t) =>
        isObject(t) && str(t.name)
          ? [
              {
                name: t.name as string,
                ...(str(t.description) && { description: str(t.description) }),
              },
            ]
          : [],
      ),
      operations,
      schemas: this.schemas,
      securitySchemes,
    };
  }

  // -- references ---------------------------------------------------------

  /** Follow `$ref`s that point to something other than a schema (parameters, responses, path items, examples). */
  private deref(node: unknown): unknown {
    const seen = new Set<string>();
    while (isObject(node) && typeof node.$ref === 'string') {
      const ref = node.$ref;
      if (seen.has(ref)) {
        throw new ApiSpecError(
          this.source,
          `the reference "${ref}" refers to itself`,
        );
      }
      seen.add(ref);
      if (!ref.startsWith('#')) {
        throw new ApiSpecError(
          this.source,
          `the reference "${ref}" was not resolved (external references must be bundled first)`,
        );
      }
      const target = readPointer(this.doc, ref);
      if (target === undefined) {
        throw new ApiSpecError(
          this.source,
          `the reference "${ref}" points to something that does not exist`,
        );
      }
      node = target;
    }
    return node;
  }

  /** The name a schema pointer goes by in `schemas`, queueing it to be normalised the first time. */
  private nameFor(ref: string): string {
    const known = this.names.get(ref);
    if (known) return known;
    const m = /^#\/(?:components\/schemas|x-dockudos-external)\/(.+)$/.exec(
      ref,
    );
    const wanted = m
      ? decodeURIComponent(
          (m[1] as string).replaceAll('~1', '/').replaceAll('~0', '~'),
        )
      : ref
          .split('/')
          .slice(-2)
          .join('_')
          .replace(/[^A-Za-z0-9_.-]+/g, '_') || 'Schema';
    let name = wanted;
    for (let i = 2; this.taken.has(name); i++) name = `${wanted}${i}`;
    this.taken.add(name);
    this.names.set(ref, name);
    const target = readPointer(this.doc, ref);
    if (target === undefined) {
      throw new ApiSpecError(
        this.source,
        `the reference "${ref}" points to something that does not exist`,
      );
    }
    this.queue.push({ name, node: target });
    return name;
  }

  // -- schemas ------------------------------------------------------------

  private schema(node: unknown): ApiSchema {
    if (node === true) return {};
    if (node === false) return { not: {} };
    if (!isObject(node)) return {};

    if (typeof node.$ref === 'string') {
      const stub: ApiSchema = { ref: this.nameFor(node.$ref) };
      // 3.1 allows siblings of $ref; keep the description since it is about this use.
      if (str(node.description)) stub.description = str(node.description);
      return stub;
    }

    const out: ApiSchema = {};
    let nullable = node.nullable === true;
    const t = node.type;
    if (typeof t === 'string' && SCHEMA_TYPES.has(t)) {
      if (t === 'null') nullable = true;
      else out.type = t as SchemaType;
    } else if (Array.isArray(t)) {
      const types = t.filter(
        (x): x is SchemaType => typeof x === 'string' && SCHEMA_TYPES.has(x),
      );
      if (types.includes('null')) nullable = true;
      const real = types.filter((x) => x !== 'null');
      if (real.length === 1) out.type = real[0];
      else if (real.length > 1) out.types = real;
    }
    if (nullable) out.nullable = true;

    for (const key of ['format', 'title', 'description', 'pattern'] as const) {
      if (str(node[key])) out[key] = str(node[key]);
    }
    if (Array.isArray(node.enum)) out.enum = node.enum;
    if ('const' in node) out.const = node.const;
    if ('default' in node) out.default = node.default;
    const examples = [
      ...('example' in node ? [node.example] : []),
      ...list(node.examples),
    ];
    if (examples.length) out.examples = examples;

    if (isObject(node.properties)) {
      out.properties = {};
      for (const [k, v] of Object.entries(node.properties)) {
        out.properties[k] = this.schema(v);
      }
    }
    const required = list(node.required).filter(
      (r): r is string => typeof r === 'string',
    );
    if (required.length) out.required = required;
    if (node.items !== undefined) out.items = this.schema(node.items);
    if (typeof node.additionalProperties === 'boolean') {
      out.additionalProperties = node.additionalProperties;
    } else if (isObject(node.additionalProperties)) {
      out.additionalProperties = this.schema(node.additionalProperties);
    }
    for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
      if (Array.isArray(node[key]))
        out[key] = node[key].map((s) => this.schema(s));
    }
    if (isObject(node.not)) out.not = this.schema(node.not);
    if (isObject(node.discriminator) && str(node.discriminator.propertyName)) {
      const mapping = isObject(node.discriminator.mapping)
        ? Object.fromEntries(
            Object.entries(node.discriminator.mapping).flatMap(([k, v]) =>
              typeof v === 'string' ? [[k, v]] : [],
            ),
          )
        : undefined;
      out.discriminator = {
        propertyName: node.discriminator.propertyName as string,
        ...(mapping && Object.keys(mapping).length && { mapping }),
      };
    }

    for (const key of [
      'minimum',
      'maximum',
      'multipleOf',
      'minLength',
      'maxLength',
      'minItems',
      'maxItems',
    ] as const) {
      if (num(node[key]) !== undefined) out[key] = num(node[key]);
    }
    // 3.0: exclusiveMinimum is a flag that turns `minimum` into an exclusive bound. 3.1: it is the bound.
    for (const [exclusive, bound] of [
      ['exclusiveMinimum', 'minimum'],
      ['exclusiveMaximum', 'maximum'],
    ] as const) {
      const v = node[exclusive];
      if (typeof v === 'number') out[exclusive] = v;
      else if (v === true && out[bound] !== undefined) {
        out[exclusive] = out[bound];
        delete out[bound];
      }
    }
    if (node.uniqueItems === true) out.uniqueItems = true;
    if (node.readOnly === true) out.readOnly = true;
    if (node.writeOnly === true) out.writeOnly = true;
    if (node.deprecated === true) out.deprecated = true;
    return out;
  }

  // -- operations ---------------------------------------------------------

  private pathItem(path: string, item: Json, webhook: boolean): ApiOperation[] {
    const shared = this.parameters(item.parameters);
    const out: ApiOperation[] = [];
    for (const method of HTTP_METHODS) {
      const raw = item[method];
      if (!isObject(raw)) continue;
      out.push(this.operation(path, method, raw, shared, webhook, item));
    }
    return out;
  }

  private operation(
    path: string,
    method: ApiMethod,
    op: Json,
    shared: ApiParameter[],
    webhook: boolean,
    item: Json,
  ): ApiOperation {
    const own = this.parameters(op.parameters);
    const parameters = [
      ...shared.filter(
        (p) => !own.some((o) => o.name === p.name && o.in === p.in),
      ),
      ...own,
    ];
    const requestBody = this.requestBody(op.requestBody);
    const servers = this.servers(op.servers ?? item.servers);
    const security = Array.isArray(op.security)
      ? this.security(op.security)
      : this.security(this.doc.security);
    return {
      id: this.operationId(op.operationId, method, path),
      method,
      path,
      ...(webhook && { webhook: true }),
      ...(str(op.summary) && { summary: str(op.summary) }),
      ...(str(op.description) && { description: str(op.description) }),
      tags: list(op.tags).filter((t): t is string => typeof t === 'string'),
      ...(op.deprecated === true && { deprecated: true }),
      parameters,
      ...(requestBody && { requestBody }),
      responses: this.responses(op.responses),
      security,
      ...(servers.length && { servers }),
    };
  }

  private operationId(given: unknown, method: string, path: string): string {
    const base =
      (str(given) ?? `${method}-${path}`)
        .replace(/[{}]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || method;
    let id = base;
    for (let i = 2; this.ids.has(id); i++) id = `${base}-${i}`;
    this.ids.add(id);
    return id;
  }

  private parameters(raw: unknown): ApiParameter[] {
    const out: ApiParameter[] = [];
    for (const r of list(raw)) {
      const p = this.deref(r);
      if (!isObject(p) || !str(p.name)) continue;
      const where = p.in as ParameterLocation;
      if (!['path', 'query', 'header', 'cookie'].includes(where)) continue;
      const schema =
        p.schema !== undefined
          ? this.schema(p.schema)
          : isObject(p.content)
            ? this.firstMedia(p.content)?.schema
            : undefined;
      out.push({
        name: p.name as string,
        in: where,
        required: where === 'path' || p.required === true,
        ...(str(p.description) && { description: str(p.description) }),
        ...(p.deprecated === true && { deprecated: true }),
        ...(schema && { schema }),
        ...('example' in p && { example: p.example }),
        ...(str(p.style) && { style: str(p.style) }),
        ...(typeof p.explode === 'boolean' && { explode: p.explode }),
      });
    }
    return out;
  }

  private firstMedia(content: Json): ApiMediaType | undefined {
    const first = Object.values(content)[0];
    return first === undefined ? undefined : this.mediaType(first);
  }

  private mediaType(raw: unknown): ApiMediaType {
    const media = isObject(raw) ? raw : {};
    const examples: Record<string, ApiExample> = {};
    if (isObject(media.examples)) {
      for (const [name, e] of Object.entries(media.examples)) {
        const ex = this.deref(e);
        if (isObject(ex) && 'value' in ex) {
          examples[name] = {
            value: ex.value,
            ...(str(ex.summary) && { summary: str(ex.summary) }),
            ...(str(ex.description) && { description: str(ex.description) }),
          };
        }
      }
    } else if ('example' in media) {
      examples.example = { value: media.example };
    }
    return {
      ...(media.schema !== undefined && { schema: this.schema(media.schema) }),
      examples,
    };
  }

  private content(raw: unknown): Record<string, ApiMediaType> {
    if (!isObject(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).map(([mime, m]) => [mime, this.mediaType(m)]),
    );
  }

  private requestBody(raw: unknown): ApiRequestBody | undefined {
    const body = this.deref(raw);
    if (!isObject(body)) return undefined;
    return {
      ...(str(body.description) && { description: str(body.description) }),
      required: body.required === true,
      content: this.content(body.content),
    };
  }

  private responses(raw: unknown): ApiResponse[] {
    if (!isObject(raw)) return [];
    const out = Object.entries(raw).map(([status, r]): ApiResponse => {
      const res = this.deref(r);
      const response = isObject(res) ? res : {};
      const headers = isObject(response.headers)
        ? Object.entries(response.headers).flatMap(([name, h]) => {
            const header = this.deref(h);
            if (!isObject(header)) return [];
            return [
              {
                name,
                ...(str(header.description) && {
                  description: str(header.description),
                }),
                ...(header.schema !== undefined && {
                  schema: this.schema(header.schema),
                }),
              },
            ];
          })
        : [];
      return {
        status,
        ...(str(response.description) && {
          description: str(response.description),
        }),
        headers,
        content: this.content(response.content),
      };
    });
    // `200` before `404`, `default` last.
    return out.sort((a, b) => rank(a.status) - rank(b.status));
  }

  // -- servers and security ----------------------------------------------

  private servers(raw: unknown): ApiServer[] {
    return list(raw).flatMap((s) => {
      if (!isObject(s) || !str(s.url)) return [];
      const variables = isObject(s.variables)
        ? Object.fromEntries(
            Object.entries(s.variables).flatMap(([name, v]) =>
              isObject(v) && v.default !== undefined
                ? [
                    [
                      name,
                      {
                        default: String(v.default),
                        ...(Array.isArray(v.enum) && {
                          enum: v.enum.map(String),
                        }),
                        ...(str(v.description) && {
                          description: str(v.description),
                        }),
                      },
                    ],
                  ]
                : [],
            ),
          )
        : undefined;
      return [
        {
          url: s.url as string,
          ...(str(s.description) && { description: str(s.description) }),
          ...(variables && Object.keys(variables).length && { variables }),
        },
      ];
    });
  }

  private security(raw: unknown): Record<string, string[]>[] {
    // `{}` in the list means "no authentication is also fine": the operation is open, so there is nothing to ask for.
    const alternatives = list(raw).flatMap((r) =>
      isObject(r)
        ? [
            Object.fromEntries(
              Object.entries(r).map(([name, scopes]) => [
                name,
                list(scopes).filter((s): s is string => typeof s === 'string'),
              ]),
            ),
          ]
        : [],
    );
    return alternatives.some((a) => Object.keys(a).length === 0)
      ? []
      : alternatives;
  }

  private securityScheme(raw: unknown): ApiSecurityScheme | undefined {
    if (!isObject(raw)) return undefined;
    const description = str(raw.description);
    const d = description ? { description } : {};
    switch (raw.type) {
      case 'apiKey':
        if (
          str(raw.name) &&
          (raw.in === 'header' || raw.in === 'query' || raw.in === 'cookie')
        ) {
          return { type: 'apiKey', in: raw.in, name: raw.name as string, ...d };
        }
        return undefined;
      case 'http':
        return str(raw.scheme)
          ? {
              type: 'http',
              scheme: (raw.scheme as string).toLowerCase(),
              ...(str(raw.bearerFormat) && {
                bearerFormat: str(raw.bearerFormat),
              }),
              ...d,
            }
          : undefined;
      case 'oauth2': {
        const flows: Extract<ApiSecurityScheme, { type: 'oauth2' }>['flows'] =
          {};
        for (const [name, f] of Object.entries(
          isObject(raw.flows) ? raw.flows : {},
        )) {
          if (!isObject(f)) continue;
          flows[name] = {
            ...(str(f.authorizationUrl) && {
              authorizationUrl: str(f.authorizationUrl),
            }),
            ...(str(f.tokenUrl) && { tokenUrl: str(f.tokenUrl) }),
            ...(str(f.refreshUrl) && { refreshUrl: str(f.refreshUrl) }),
            scopes: isObject(f.scopes)
              ? Object.fromEntries(
                  Object.entries(f.scopes).map(([k, v]) => [k, String(v)]),
                )
              : {},
          };
        }
        return { type: 'oauth2', flows, ...d };
      }
      case 'openIdConnect':
        return str(raw.openIdConnectUrl)
          ? {
              type: 'openIdConnect',
              url: raw.openIdConnectUrl as string,
              ...d,
            }
          : undefined;
      case 'mutualTLS':
        return { type: 'mutualTLS', ...d };
      default:
        return undefined;
    }
  }
}

function rank(status: string): number {
  if (status === 'default') return 1000;
  const n = Number(status);
  if (Number.isFinite(n)) return n;
  // `2XX` sorts after the exact codes of the same class.
  const m = /^([1-5])XX$/i.exec(status);
  return m ? Number(m[1]) * 100 + 99 : 999;
}
