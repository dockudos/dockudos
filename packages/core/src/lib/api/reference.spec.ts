import {
  buildSchema,
  getIntrospectionQuery,
  graphqlSync,
  parse,
  validate,
  type IntrospectionQuery,
} from 'graphql';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateAsyncApi, normalizeAsyncApi } from './asyncapi.ts';
import { parseSpecText } from './bundle.ts';
import { generateGraphql, readGraphqlSchema } from './graphql.ts';
import { detectSpec } from './sources.ts';
import { ApiSpecError } from './types.ts';

const read = (name: string) =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

describe('AsyncAPI', () => {
  it('reads 2.x: servers, channels, publish and subscribe from the application side, messages, parameters', () => {
    const model = normalizeAsyncApi(
      parseSpecText(read('chat-2.yaml'), 'c'),
      'c',
    );
    expect(model.title).toBe('Chat {events}');
    expect(model.servers).toEqual([
      {
        name: 'prod',
        url: 'wss://chat.example.com/{tenant}',
        protocol: 'wss',
        description: 'Production',
      },
    ]);
    const room = model.channels.find(
      (c) => c.address === 'chat/{room}/message',
    );
    expect(room?.parameters).toEqual([
      { name: 'room', description: 'Room id' },
    ]);
    // a client publishes: the application receives
    expect(room?.operations.map((o) => o.action)).toEqual(['receive', 'send']);
    expect(room?.operations[0]?.messages[0]).toMatchObject({
      name: 'ChatMessage',
      title: 'A chat message',
      contentType: 'application/json',
    });
    expect(room?.operations[1]?.messages.map((m) => m.name)).toEqual([
      'ChatMessage',
      'Typing',
    ]);
  });

  it('reads 3.x: operations point at channels and their messages', () => {
    const model = normalizeAsyncApi(
      parseSpecText(read('orders-3.yaml'), 'o'),
      'o',
    );
    expect(model.servers[0]).toMatchObject({
      url: 'mq.example.com:5672',
      protocol: 'amqp',
    });
    const ch = model.channels[0];
    expect(ch?.address).toBe('orders.created');
    expect(ch?.operations).toHaveLength(1);
    expect(ch?.operations[0]).toMatchObject({
      action: 'send',
      summary: 'Announce an order',
    });
    expect(ch?.operations[0]?.messages[0]?.name).toBe('OrderCreated');
  });

  it('survives circular schemas and rejects other versions', () => {
    const model = normalizeAsyncApi(
      parseSpecText(read('chat-2.yaml'), 'c'),
      'c',
    );
    const message = model.channels[0]?.operations[0]?.messages[0];
    expect(JSON.stringify(message?.payload)).toContain('"parent"');
    expect(() =>
      normalizeAsyncApi({ asyncapi: '1.2.0', info: { title: 't' } }, 's'),
    ).toThrow(/only 2\.x and 3\.x/);
    expect(() => normalizeAsyncApi({ hello: 1 }, 's')).toThrow(ApiSpecError);
  });

  it('writes an overview, servers and one page for every channel, with escaped text', () => {
    for (const [name, channels] of [
      ['chat-2.yaml', 2],
      ['orders-3.yaml', 1],
    ] as const) {
      const model = normalizeAsyncApi(parseSpecText(read(name), name), name);
      const { files, pages, operations } = generateAsyncApi(model, {
        name: 'events',
        mount: 'events',
      });
      expect(operations).toBe(channels);
      expect(pages).toBe(channels);
      expect(files.map((f) => f.file)).toEqual(
        expect.arrayContaining([
          'docs/events/index.mdx',
          'docs/events/servers.mdx',
        ]),
      );
      expect(files.filter((f) => f.file.includes('/channels/'))).toHaveLength(
        channels,
      );
    }
    const chat = generateAsyncApi(
      normalizeAsyncApi(parseSpecText(read('chat-2.yaml'), 'c'), 'c'),
      { name: 'e', mount: 'e' },
    );
    const overview =
      chat.files.find((f) => f.file.endsWith('index.mdx'))?.content ?? '';
    expect(overview).toContain('title: "Chat {events}"');
    expect(overview).toContain('Realtime \\<chat\\> events.');
    const page =
      chat.files.find((f) => f.file.includes('chat-room-message'))?.content ??
      '';
    expect(page).toContain('## Receive: Post a message');
    expect(page).toContain('"text": "string"');
  });
});

describe('GraphQL', () => {
  const sdl = read('shop.graphql');
  const pageOf = (files: { file: string; content: string }[], end: string) =>
    files.find((f) => f.file.endsWith(end))?.content ?? '';

  it('writes a page for every query, mutation and subscription and for each kind of type', () => {
    const { files, operations, pages } = generateGraphql(
      readGraphqlSchema({ text: sdl }, 'shop.graphql'),
      { name: 'shop', mount: 'graphql' },
    );
    expect(operations).toBe(5);
    expect(pages).toBe(5);
    expect(files.map((f) => f.file).sort()).toEqual(
      [
        'docs/graphql/index.mdx',
        'docs/graphql/queries/product.mdx',
        'docs/graphql/queries/products.mdx',
        'docs/graphql/queries/oldthing.mdx',
        'docs/graphql/mutations/addproduct.mdx',
        'docs/graphql/subscriptions/pricechanged.mdx',
        'docs/graphql/types/objects.mdx',
        'docs/graphql/types/inputs.mdx',
        'docs/graphql/types/enums.mdx',
        'docs/graphql/types/interfaces.mdx',
        'docs/graphql/types/unions.mdx',
        'docs/graphql/types/scalars.mdx',
      ].sort(),
    );
  });

  it('shows arguments, defaults, deprecation and a runnable example', () => {
    const { files } = generateGraphql(readGraphqlSchema({ text: sdl }, 's'), {
      name: 'shop',
      mount: 'graphql',
    });
    const product = pageOf(files, 'queries/product.mdx');
    expect(product).toContain('| id | ID! |');
    expect(product).toContain('| locale | Locale | "EN"');
    expect(product).toMatch(
      /```graphql\nquery \{\n {2}product\(id: "1"\) \{ id name/,
    );
    expect(pageOf(files, 'queries/oldthing.mdx')).toContain(
      '**Deprecated.** Use product',
    );
    expect(pageOf(files, 'mutations/addproduct.mdx')).toContain(
      'mutation {\n  addProduct(input: { name: "string" })',
    );
    expect(pageOf(files, 'types/objects.mdx')).toContain('Implements `Node`');
    expect(pageOf(files, 'types/enums.mdx')).toContain('| DE | Deprecated. |');
    expect(pageOf(files, 'types/unions.mdx')).toContain(
      'One of `Product`, `Price`',
    );
  });

  it('generated example queries are valid against the schema', () => {
    const schema = buildSchema(sdl);
    const { files } = generateGraphql(schema, { name: 'shop', mount: 'g' });
    const examples = files.flatMap((f) =>
      [...f.content.matchAll(/```graphql\n([\s\S]*?)\n```/g)].map(
        (m) => m[1] as string,
      ),
    );
    expect(examples.length).toBe(5);
    for (const query of examples) {
      expect(
        validate(schema, parse(query)).map((e) => e.message),
        query,
      ).toEqual([]);
    }
  });

  it('reads an introspection result as well as SDL', () => {
    const introspection = graphqlSync({
      schema: buildSchema(sdl),
      source: getIntrospectionQuery(),
    }).data as unknown as IntrospectionQuery;
    for (const doc of [introspection, { data: introspection }]) {
      const schema = readGraphqlSchema(
        { text: JSON.stringify(doc), doc },
        'i.json',
      );
      expect(
        generateGraphql(schema, { name: 's', mount: 'g' }).operations,
      ).toBe(5);
    }
    expect(
      detectSpec(JSON.stringify({ data: introspection }), 'schema.json').kind,
    ).toBe('graphql');
  });

  it('names the source when the schema is not valid', () => {
    expect(() =>
      readGraphqlSchema({ text: 'type Query {' }, 'bad.graphql'),
    ).toThrow(/bad\.graphql: is not a valid GraphQL schema/);
  });
});
