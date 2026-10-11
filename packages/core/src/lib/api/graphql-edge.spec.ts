import { buildSchema, getIntrospectionQuery, graphqlSync } from 'graphql';
import { generateGraphql, readGraphqlSchema } from './graphql.ts';
import { ApiSpecError } from './types.ts';

const SDL = `
  scalar Date
  enum Color { RED GREEN }
  enum Empty { ONLY }
  input Deep { a: Deep2! }
  input Deep2 { b: Deep3! }
  input Deep3 { c: Deep4! }
  input Deep4 { d: Int! }
  input Filter { color: Color!, deep: Deep!, n: Int!, f: Float!, b: Boolean!, id: ID!, s: String!, tags: [String!]!, when: Date!, e: Empty! }
  type Leaf { id: ID }
  type Thing { id: ID!, name(upper: Boolean): String, leaf: Leaf, tags: [String!]! }
  type Query {
    thing(filter: Filter!): Thing
    things: [Thing!]!
    scalarList: [Int!]!
    leaf: Leaf
  }
  type Mutation { thing(id: ID!): Thing }
  type Subscription { thing: Thing }
  union Result = Thing | Leaf
  interface Node { id: ID! }
  type Impl implements Node { id: ID!, extra: Int }
`;

describe('readGraphqlSchema', () => {
  it('reads introspection results wrapped in data, and bare ones', () => {
    const result = graphqlSync({
      schema: buildSchema(SDL),
      source: getIntrospectionQuery(),
    });
    const bare = result.data!;
    expect(() =>
      readGraphqlSchema({ text: '', doc: result }, 's'),
    ).not.toThrow();
    expect(() => readGraphqlSchema({ text: '', doc: bare }, 's')).not.toThrow();
  });

  it('refuses JSON that is not an introspection result', () => {
    expect(() =>
      readGraphqlSchema({ text: '', doc: { data: {} } }, 's.json'),
    ).toThrow(ApiSpecError);
    expect(() => readGraphqlSchema({ text: '', doc: {} }, 's.json')).toThrow(
      /__schema/,
    );
  });
});

describe('generateGraphql', () => {
  const out = generateGraphql(readGraphqlSchema({ text: SDL }, 'x.graphql'), {
    name: 'gql',
    mount: 'gql',
  });
  const page = (suffix: string) =>
    out.files.find((f) => f.file.endsWith(suffix))?.content ?? '';

  it('writes pages for operations, with sample values for every kind of input', () => {
    const query = page('queries/thing.mdx');
    expect(query).toContain('color: RED');
    expect(query).toContain('e: ONLY');
    expect(query).toContain('n: 1');
    expect(query).toContain('f: 1.5');
    expect(query).toContain('b: true');
    expect(query).toContain('tags: [');
    // Inputs nested deeper than the sample goes are left empty.
    expect(query).toContain('{}');
  });

  it('numbers operations that share a name, one page each', () => {
    const files = out.files.map((f) => f.file);
    expect(files).toEqual(
      expect.arrayContaining([
        'docs/gql/mutations/thing.mdx',
        'docs/gql/subscriptions/thing.mdx',
      ]),
    );
    const twice = generateGraphql(
      readGraphqlSchema({ text: 'type Query { a: Int, A: Int }' }, 'x.graphql'),
      { name: 'g', mount: 'g' },
    );
    expect(twice.files.map((f) => f.file)).toEqual(
      expect.arrayContaining([
        'docs/g/queries/a.mdx',
        'docs/g/queries/a-2.mdx',
      ]),
    );
  });

  it('selects __typename for a type with nothing to pick, and lists object fields with arguments', () => {
    expect(page('queries/leaf.mdx')).toBeTruthy();
    const types = page('types/objects.mdx');
    expect(types).toContain('name(upper)');
  });

  it('skips the kinds of type a schema does not have', () => {
    const small = generateGraphql(
      readGraphqlSchema({ text: 'type Query { a: Int }' }, 'x.graphql'),
      { name: 'g', mount: 'g' },
    );
    const files = small.files.map((f) => f.file);
    expect(files.some((f) => f.includes('mutations/'))).toBe(false);
    expect(files.some((f) => f.includes('types/enums'))).toBe(false);
  });
});
