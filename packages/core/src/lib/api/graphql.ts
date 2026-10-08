import {
  type GraphQLArgument,
  type GraphQLField,
  type GraphQLNamedType,
  type GraphQLSchema,
  type GraphQLType,
  buildClientSchema,
  buildSchema,
  getNamedType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
  isListType,
  type IntrospectionQuery,
} from 'graphql';
import GithubSlugger from 'github-slugger';
import type { GeneratedFile } from './generate-openapi.ts';
import {
  code,
  escapeMdx,
  escapeParagraphs,
  fence,
  markdownPage,
  table,
} from './markdown-pages.ts';
import { slugify, summarize } from './text.ts';
import { ApiSpecError } from './types.ts';

/** A GraphQL schema from SDL text or from the JSON of an introspection query (with or without its `data` wrapper). */
export function readGraphqlSchema(
  spec: { text: string; doc?: unknown },
  source: string,
): GraphQLSchema {
  try {
    if (spec.doc && typeof spec.doc === 'object') {
      const d = spec.doc as { data?: IntrospectionQuery; __schema?: unknown };
      const introspection = (d.data ?? d) as IntrospectionQuery;
      if (!introspection.__schema) throw new Error('no "__schema" in the JSON');
      return buildClientSchema(introspection);
    }
    return buildSchema(spec.text);
  } catch (e) {
    throw new ApiSpecError(
      source,
      `is not a valid GraphQL schema: ${(e as Error).message}`,
    );
  }
}

const typeName = (t: GraphQLType): string => String(t);
const ROOTS = ['Query', 'Mutation', 'Subscription'] as const;

/** A value to put in an example for an argument or field of this type. */
function sampleValue(type: GraphQLType, depth = 0): string {
  if (isNonNullType(type)) return sampleValue(type.ofType, depth);
  if (isListType(type)) return `[${sampleValue(type.ofType, depth)}]`;
  const named = getNamedType(type);
  if (isEnumType(named)) return named.getValues()[0]?.name ?? 'VALUE';
  if (isInputObjectType(named)) {
    if (depth > 2) return '{}';
    const fields = Object.values(named.getFields()).filter((f) =>
      isNonNullType(f.type),
    );
    return `{ ${fields.map((f) => `${f.name}: ${sampleValue(f.type, depth + 1)}`).join(', ')} }`;
  }
  switch (named.name) {
    case 'Int':
      return '1';
    case 'Float':
      return '1.5';
    case 'Boolean':
      return 'true';
    case 'ID':
      return '"1"';
    default:
      return '"string"';
  }
}

/** A selection of scalar fields (and one level of objects) for an example. */
function selection(type: GraphQLType, depth = 0): string {
  const named = getNamedType(type);
  if (!(isObjectType(named) || isInterfaceType(named))) return '';
  const fields = Object.values(named.getFields());
  const scalars = fields.filter(
    (f) =>
      !(
        isObjectType(getNamedType(f.type)) ||
        isInterfaceType(getNamedType(f.type)) ||
        isUnionType(getNamedType(f.type))
      ) && f.args.length === 0,
  );
  const picks = scalars.slice(0, 4).map((f) => f.name);
  if (depth < 1) {
    const nested = fields.find(
      (f) =>
        (isObjectType(getNamedType(f.type)) ||
          isInterfaceType(getNamedType(f.type))) &&
        f.args.length === 0,
    );
    if (nested)
      picks.push(
        `${nested.name} ${selection(nested.type, depth + 1) || '{ __typename }'}`,
      );
  }
  if (!picks.length) picks.push('__typename');
  return `{ ${picks.join(' ')} }`;
}

function exampleOperation(
  kind: string,
  field: GraphQLField<unknown, unknown>,
): string {
  const op = kind.toLowerCase();
  const args = field.args.filter((a) => isNonNullType(a.type));
  const argText = args.length
    ? `(${args.map((a) => `${a.name}: ${sampleValue(a.type)}`).join(', ')})`
    : '';
  const sel = selection(field.type);
  return `${op} {\n  ${field.name}${argText}${sel ? ` ${sel}` : ''}\n}`;
}

const argRows = (args: readonly GraphQLArgument[]) =>
  args.map((a) => [
    a.name,
    typeName(a.type),
    a.defaultValue !== undefined ? JSON.stringify(a.defaultValue) : '',
    a.description ?? '',
  ]);

function fieldPage(
  kind: string,
  field: GraphQLField<unknown, unknown>,
): string {
  const body: string[] = [`${code(`${field.name}: ${typeName(field.type)}`)}`];
  if (field.deprecationReason !== undefined)
    body.push(`**Deprecated.** ${escapeMdx(field.deprecationReason ?? '')}`);
  if (field.description) body.push(escapeParagraphs(field.description));
  if (field.args.length)
    body.push(
      '## Arguments',
      table(['Name', 'Type', 'Default', 'Description'], argRows(field.args)),
    );
  body.push('## Returns', code(typeName(field.type)));
  body.push('## Example', fence(exampleOperation(kind, field), 'graphql'));
  return body.join('\n\n');
}

function typeSection(type: GraphQLNamedType): string {
  const out: string[] = [`## ${escapeMdx(type.name)}`];
  if (type.description) out.push(escapeParagraphs(type.description));
  if (isObjectType(type) || isInterfaceType(type)) {
    const implemented = type.getInterfaces().map((i) => i.name);
    if (implemented.length)
      out.push(`Implements ${implemented.map(code).join(', ')}`);
    out.push(
      table(
        ['Field', 'Type', 'Description'],
        Object.values(type.getFields()).map((f) => [
          f.args.length
            ? `${f.name}(${f.args.map((a) => a.name).join(', ')})`
            : f.name,
          typeName(f.type),
          [
            f.description,
            f.deprecationReason !== undefined ? 'Deprecated.' : '',
          ]
            .filter(Boolean)
            .join(' '),
        ]),
      ),
    );
  } else if (isInputObjectType(type)) {
    out.push(
      table(
        ['Field', 'Type', 'Description'],
        Object.values(type.getFields()).map((f) => [
          f.name,
          typeName(f.type),
          f.description ?? '',
        ]),
      ),
    );
  } else if (isEnumType(type)) {
    out.push(
      table(
        ['Value', 'Description'],
        type
          .getValues()
          .map((v) => [
            v.name,
            [
              v.description,
              v.deprecationReason !== undefined ? 'Deprecated.' : '',
            ]
              .filter(Boolean)
              .join(' '),
          ]),
      ),
    );
  } else if (isUnionType(type)) {
    out.push(
      `One of ${type
        .getTypes()
        .map((t) => code(t.name))
        .join(', ')}`,
    );
  }
  return out.join('\n\n');
}

export interface GraphqlGenerateOptions {
  name: string;
  mount: string;
  docsDir?: string;
  title?: string;
  /** `urlPrefix` of the site, for links between generated pages. */
  urlPrefix?: string;
}

/**
 * One page for each query, mutation and subscription (arguments, result, an example), and one page for each kind of
 * type (objects, inputs, enums, interfaces, unions, scalars) so a large schema is not thousands of pages.
 */
export function generateGraphql(
  schema: GraphQLSchema,
  {
    name,
    mount,
    docsDir = 'docs',
    title,
    urlPrefix = '',
  }: GraphqlGenerateOptions,
): { files: GeneratedFile[]; operations: number; pages: number } {
  const base = `${docsDir}/${mount}`;
  const files: GeneratedFile[] = [];
  let order = 0;
  let operations = 0;
  const roots = {
    Query: schema.getQueryType(),
    Mutation: schema.getMutationType(),
    Subscription: schema.getSubscriptionType(),
  };
  const rootNames = new Set(
    Object.values(roots).flatMap((r) => (r ? [r.name] : [])),
  );

  const overview: string[] = [];
  for (const kind of ROOTS) {
    const root = roots[kind];
    if (!root) continue;
    const slugs = new Set<string>();
    const fields = Object.values(root.getFields());
    overview.push(
      `## ${kind === 'Query' ? 'Queries' : `${kind}s`}`,
      table(
        ['Field', 'Returns', 'Description'],
        fields.map((f) => [
          f.name,
          typeName(f.type),
          summarize(f.description ?? undefined, 120) ?? '',
        ]),
      ),
    );
    for (const field of fields) {
      let slug = slugify(field.name);
      for (let i = 2; slugs.has(slug); i++)
        slug = `${slugify(field.name)}-${i}`;
      slugs.add(slug);
      operations++;
      files.push({
        file: `${base}/${kind === 'Query' ? 'queries' : `${kind.toLowerCase()}s`}/${slug}.mdx`,
        content: markdownPage(
          {
            title: field.name,
            description: summarize(field.description ?? undefined),
            source: name,
            kind: 'operation',
            group: kind === 'Query' ? 'Queries' : `${kind}s`,
            order: order++,
            sidebarTitle: field.name,
          },
          fieldPage(kind, field),
        ),
      });
    }
  }

  const kinds: { label: string; test: (t: GraphQLNamedType) => boolean }[] = [
    {
      label: 'Objects',
      test: (t) => isObjectType(t) && !rootNames.has(t.name),
    },
    { label: 'Inputs', test: isInputObjectType },
    { label: 'Enums', test: isEnumType },
    { label: 'Interfaces', test: isInterfaceType },
    { label: 'Unions', test: isUnionType },
    { label: 'Scalars', test: (t) => isScalarType(t) },
  ];
  const all = Object.values(schema.getTypeMap()).filter(
    (t) => !t.name.startsWith('__'),
  );
  for (const { label, test } of kinds) {
    const types = all
      .filter(
        (t) =>
          test(t) &&
          !(
            isScalarType(t) &&
            ['String', 'Int', 'Float', 'Boolean', 'ID'].includes(t.name)
          ),
      )
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    if (!types.length) continue;
    overview.push(
      `## ${label}`,
      types
        .map(
          (t) =>
            `- [${escapeMdx(t.name)}](${urlPrefix}/${mount}/types/${slugify(label)}#${new GithubSlugger().slug(t.name)})`,
        )
        .join('\n'),
    );
    files.push({
      file: `${base}/types/${slugify(label)}.mdx`,
      content: markdownPage(
        {
          title: label,
          source: name,
          kind: 'types',
          group: 'Types',
          order: order++,
        },
        types.map(typeSection).join('\n\n'),
      ),
    });
  }

  files.push({
    file: `${base}/index.mdx`,
    content: markdownPage(
      {
        title: title ?? 'GraphQL API',
        description: summarize(schema.description ?? undefined),
        source: name,
        kind: 'overview',
        order: -1,
      },
      overview.join('\n\n'),
    ),
  });
  return { files, operations, pages: operations };
}
