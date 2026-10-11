import { generateAsyncApi, normalizeAsyncApi } from './asyncapi.ts';
import { ApiSpecError } from './types.ts';

const info = { title: 'Events', version: '2' };

describe('normalizeAsyncApi: refusals', () => {
  it('needs a version field, a supported major version and a title', () => {
    expect(() => normalizeAsyncApi('x', 's')).toThrow('no "asyncapi" version');
    expect(() => normalizeAsyncApi({ asyncapi: '1.0.0' }, 's')).toThrow(
      ApiSpecError,
    );
    expect(() => normalizeAsyncApi({ asyncapi: '3.0.0' }, 's')).toThrow(
      'info.title',
    );
    expect(() =>
      normalizeAsyncApi({ asyncapi: '3.0.0', info: {} }, 's'),
    ).toThrow('info.title');
  });
});

describe('normalizeAsyncApi: 3.x', () => {
  const doc = {
    asyncapi: '3.0.0',
    info,
    servers: {
      main: { host: 'mq.test:5672', pathname: '/v1', protocol: 'amqp' },
      bare: { host: 'h.test' },
      junk: 'x',
    },
    channels: {
      'user/signup': {
        address: 'user.signup',
        description: 'Signups',
        parameters: { id: { description: 'User id' }, plain: 'x' },
        messages: {
          Signed: {
            name: 'Signed',
            payload: { type: 'object' },
            headers: { type: 'object' },
          },
          ref: { $ref: '#/components/messages/Ref' },
        },
      },
      'user/delete': { messages: { Gone: { messageId: 'gone' } } },
      'weird~chan': {},
      junk: 'x',
    },
    operations: {
      onSignup: {
        action: 'send',
        channel: { $ref: '#/channels/user~1signup' },
        summary: 'Announce',
        description: 'Tells others',
        messages: [
          { $ref: '#/channels/user~1signup/messages/Signed' },
          { title: 'T' },
        ],
      },
      onDelete: {
        action: 'receive',
        channel: { $ref: '#/channels/user~1delete' },
      },
      other: { action: 'send', channel: { $ref: '#/channels/elsewhere' } },
      noChannel: { action: 'send' },
      junk: 'x',
    },
    components: {
      messages: { Ref: { name: 'Ref', summary: 'S', contentType: 'x/y' } },
    },
  };

  it('reads servers, channels, their operations and their messages', () => {
    const model = normalizeAsyncApi(doc, 's');
    expect(model.servers.map((s) => [s.name, s.url, s.protocol])).toEqual([
      ['main', 'mq.test:5672/v1', 'amqp'],
      ['bare', 'h.test', ''],
    ]);
    const signup = model.channels.find((c) => c.id === 'user/signup')!;
    expect(signup.address).toBe('user.signup');
    expect(signup.parameters).toEqual([
      { name: 'id', description: 'User id' },
      { name: 'plain' },
    ]);
    expect(signup.operations).toHaveLength(1);
    expect(signup.operations[0]).toMatchObject({
      action: 'send',
      summary: 'Announce',
    });
    expect(signup.operations[0]!.messages.map((m) => m.name)).toEqual([
      'Signed',
      'T',
    ]);
    // Channels with no operation of their own show the messages they declare.
    expect(signup.messages).toEqual([]);
    const gone = model.channels.find((c) => c.id === 'user/delete')!;
    expect(gone.operations[0]!.action).toBe('receive');
    // An operation that lists no messages shows the ones its channel declares.
    expect(gone.operations[0]!.messages.map((m) => m.name)).toEqual(['gone']);
    const orphan = model.channels.find((c) => c.id === 'weird~chan')!;
    expect(orphan.operations).toEqual([]);
    expect(orphan.messages).toEqual([]);
    expect(model.channels.map((c) => c.id)).not.toContain('junk');
  });

  it('shows the messages of a channel nobody operates on', () => {
    const model = normalizeAsyncApi(
      {
        asyncapi: '3.0.0',
        info,
        channels: {
          c: { messages: { A: { name: 'A' }, B: { $ref: '#/nope' } } },
        },
      },
      's',
    );
    expect(model.channels[0]!.messages.map((m) => m.name)).toEqual(['A', 'B']);
  });
});

describe('normalizeAsyncApi: 2.x', () => {
  it('follows references, stops loops and external references, and numbers lists of messages', () => {
    const model = normalizeAsyncApi(
      {
        asyncapi: '2.6.0',
        info,
        servers: { s: { url: 'ws://x', protocol: 'ws' }, junk: 1 },
        channels: {
          a: {
            publish: {
              operationId: 'op',
              message: [{ payload: { type: 'string' } }, { name: 'second' }],
            },
            subscribe: {
              message: {
                oneOf: [
                  { payload: { $ref: '#/components/schemas/Loop' } },
                  { $ref: 'other.json#/x' },
                ],
              },
            },
          },
          b: { publish: { message: { $ref: '#/components/messages/Loop' } } },
          junk: 'x',
        },
        components: {
          schemas: {
            Loop: {
              type: 'object',
              properties: { next: { $ref: '#/components/schemas/Loop' } },
            },
          },
          messages: {
            Loop: { payload: { $ref: '#/components/schemas/Loop' } },
          },
        },
      },
      's',
    );
    const a = model.channels.find((c) => c.id === 'a')!;
    expect(a.operations[0]!.messages.map((m) => m.name)).toEqual([
      'op 1',
      'second',
    ]);
    expect(a.operations[1]!.messages).toHaveLength(2);
    expect(model.channels.map((c) => c.id)).toEqual(['a', 'b']);
    expect(model.servers).toHaveLength(1);
  });
});

describe('generateAsyncApi', () => {
  it('gives every channel its own page, avoids reserved and repeated names, and writes messages out', () => {
    const channel = (id: string, extra = {}) => ({
      id,
      address: id,
      parameters: [],
      operations: [],
      messages: [],
      ...extra,
    });
    const msg = {
      name: 'M',
      title: 'Title',
      summary: 'Sum',
      description: 'Desc',
      contentType: 'application/json',
      payload: { type: 'object' },
      headers: { type: 'object' },
    };
    const out = generateAsyncApi(
      {
        title: 'Events',
        servers: [],
        channels: [
          channel('index'),
          channel('servers'),
          channel('Same'),
          channel('same'),
          channel('with-ops', {
            operations: [
              { action: 'send', description: 'Sends it', messages: [msg] },
              { action: 'receive', messages: [] },
            ],
          }),
          channel('own', { messages: [msg] }),
        ],
      },
      { name: 'ev', mount: 'ev' },
    );
    const files = out.files.map((f) => f.file);
    expect(files).toEqual(
      expect.arrayContaining([
        'docs/ev/index.mdx',
        'docs/ev/channels/index-2.mdx',
        'docs/ev/channels/servers-2.mdx',
        'docs/ev/channels/same.mdx',
        'docs/ev/channels/same-2.mdx',
      ]),
    );
    const withOps = out.files.find((f) =>
      f.file.endsWith('with-ops.mdx'),
    )!.content;
    expect(withOps).toContain('Sends it');
    expect(withOps).toContain('**Payload**');
    expect(withOps).toContain('**Headers**');
    expect(withOps).toContain('Desc');
    const own = out.files.find((f) => f.file.endsWith('own.mdx'))!.content;
    expect(own).toContain('## Messages');
  });
});
