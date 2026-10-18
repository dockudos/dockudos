import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CLIENT_LIMITS,
  type Collection,
  type SavedRequest,
  type StoredRequest,
  newId,
} from './client.ts';
import {
  type Imported,
  decodeSharedRequest,
  detectFormat,
  encodeSharedRequest,
  fromBruFile,
  importText,
  neededVariables,
  parseCurl,
  sharedRequestUrl,
  splitCommand,
  toBruno,
  toCurl,
  toDockudosFile,
  toPostman,
} from './client-transfer.ts';

const fixture = (name: string) =>
  readFile(join(import.meta.dirname, 'fixtures', name), 'utf8');

const request = (over: Partial<StoredRequest> = {}): StoredRequest => ({
  method: 'GET',
  url: 'https://api.test/pets',
  headers: [],
  ...over,
});

const collection = (over: Partial<Collection> = {}): Collection => ({
  id: 'c1',
  name: 'Petstore',
  order: 1,
  createdAt: 1,
  v: 1,
  ...over,
});

const saved = (over: Partial<SavedRequest> = {}): SavedRequest => ({
  id: newId(),
  collectionId: 'c1',
  name: 'List pets',
  order: 1,
  createdAt: 1,
  updatedAt: 1,
  request: request(),
  v: 1,
  ...over,
});

const names = (result: Imported) => result.requests.map((r) => r.name);
const byName = (result: Imported, name: string) =>
  result.requests.find((r) => r.name === name);

describe('what a file is', () => {
  it('recognises each format by what is in it', async () => {
    expect(detectFormat('curl https://api.test')).toBe('curl');
    expect(detectFormat('  CURL.exe -X POST https://api.test ')).toBe('curl');
    expect(detectFormat(await fixture('postman-petstore.json'))).toBe('postman');
    expect(detectFormat(await fixture('bruno-petstore.json'))).toBe('bruno');
    expect(detectFormat(await fixture('find-pet.bru'))).toBe('bru');
    expect(
      detectFormat(JSON.stringify({ dockudos: 'api-client', version: 1 })),
    ).toBe('dockudos');
    expect(detectFormat(JSON.stringify({ item: [] }))).toBe('postman');
  });

  it('says nothing for text it does not know, and never throws on damaged JSON', () => {
    expect(detectFormat('hello')).toBeUndefined();
    expect(detectFormat('{ not json')).toBeUndefined();
    expect(detectFormat('[1,2]')).toBeUndefined();
    expect(detectFormat(JSON.stringify({ a: 1 }))).toBeUndefined();
    expect(importText('hello').warnings[0]).toMatch(/not recognised/);
    expect(importText('{ not json', 'postman').warnings[0]).toMatch(/not valid JSON/);
    expect(importText('[1,2]', 'postman').warnings[0]).toMatch(/does not hold a collection/);
  });
});

describe('Postman v2.1', () => {
  it('reads a collection Postman wrote: folders, disabled headers, URL parts, bodies', async () => {
    const result = importText(await fixture('postman-petstore.json'));
    expect(result.collections).toHaveLength(1);
    expect(result.collections[0]?.name).toBe('Petstore');
    expect(names(result)).toEqual([
      'pet / Find pet by ID',
      'pet / Add a pet',
      'pet / Upload an image',
      'Log in',
      'Server status',
    ]);

    const find = byName(result, 'pet / Find pet by ID');
    expect(find?.request).toEqual({
      method: 'GET',
      url: '{{baseUrl}}/pet/10?verbose=true',
      headers: [['Accept', 'application/json']],
      body: undefined,
    });

    expect(byName(result, 'pet / Add a pet')?.request.body).toEqual({
      contentType: 'application/json',
      text: '{\n  "name": "Rex",\n  "status": "available"\n}',
    });

    // A URL given in parts is put back together, query included.
    expect(byName(result, 'Log in')?.request).toMatchObject({
      url: 'https://petstore3.swagger.io/api/v3/user/login',
      body: {
        contentType: 'application/x-www-form-urlencoded',
        text: 'username=me&password=%7B%7Bpassword%7D%7D',
      },
    });
    // A request that is only a URL string.
    expect(byName(result, 'Server status')?.request.url).toBe(
      'https://petstore3.swagger.io/api/v3/status',
    );
  });

  it('never runs a script, and says what it dropped', async () => {
    const result = importText(await fixture('postman-petstore.json'));
    expect(result.warnings).toEqual([
      'pet / Find pet by ID: the authentication saved in the file was not imported; add it as a secret variable.',
      'pet / Upload an image: a formdata body cannot be imported and was left out',
      'Scripts in the file were ignored and never run (Find pet by ID).',
    ]);
    expect(byName(result, 'pet / Upload an image')?.request.body).toBeUndefined();
  });

  it("turns the collection's variables into an environment", async () => {
    const result = importText(await fixture('postman-petstore.json'));
    expect(result.environments).toHaveLength(1);
    expect(result.environments[0]).toMatchObject({
      name: 'Petstore variables',
      variables: [
        { name: 'baseUrl', value: 'https://petstore3.swagger.io/api/v3' },
        { name: 'apiKey', value: '' },
      ],
    });
  });

  it('writes a collection Postman can read, with no credential in it', () => {
    const file = toPostman(collection(), [
      saved({
        order: 2,
        name: 'Add a pet',
        request: request({
          method: 'POST',
          url: 'https://api.test/pets',
          headers: [
            ['Authorization', 'Bearer sk-live-1'],
            ['X-Key', 'Bearer {{token}}'],
          ],
          body: { contentType: 'application/json', text: '{"name":"Rex"}' },
        }),
      }),
      saved({ order: 1, name: 'List pets' }),
    ]) as {
      info: Record<string, string>;
      item: {
        name: string;
        request: {
          method: string;
          header: { key: string; value: string }[];
          body?: { mode: string; raw: string; options: { raw: { language: string } } };
          url: { raw: string };
        };
      }[];
    };
    expect(file.info.schema).toContain('v2.1.0');
    expect(file.item.map((i) => i.name)).toEqual(['List pets', 'Add a pet']);
    const post = file.item[1]!;
    expect(post.request.header).toEqual([
      { key: 'Authorization', value: '' },
      { key: 'X-Key', value: 'Bearer {{token}}' },
    ]);
    expect(post.request.body?.options.raw.language).toBe('json');
    expect(JSON.stringify(file)).not.toContain('sk-live-1');
  });

  it('labels a body by its content type', () => {
    const language = (contentType: string) => {
      const file = toPostman(collection(), [
        saved({ request: request({ body: { contentType, text: 'x' } }) }),
      ]) as { item: { request: { body: { options: { raw: { language: string } } } } }[] };
      return file.item[0]!.request.body.options.raw.language;
    };
    expect(language('application/json')).toBe('json');
    expect(language('application/xml')).toBe('xml');
    expect(language('text/html')).toBe('html');
    expect(language('text/csv')).toBe('text');
  });

  it('comes back unchanged through its own export', () => {
    const exported = toPostman(collection(), [
      saved({ request: request({ url: 'https://api.test/pets?status=sold' }) }),
    ]);
    const back = importText(JSON.stringify(exported));
    expect(back.requests[0]?.request.url).toBe('https://api.test/pets?status=sold');
    expect(back.collections[0]?.name).toBe('Petstore');
  });
});

describe('Bruno', () => {
  it('reads a collection Bruno exported, with its folders, bodies and environment', async () => {
    const result = importText(await fixture('bruno-petstore.json'));
    expect(names(result)).toEqual([
      'pet / Find pet by ID',
      'pet / Add a pet',
      'Upload an image',
    ]);
    expect(byName(result, 'pet / Find pet by ID')?.request.headers).toEqual([
      ['Accept', 'application/json'],
    ]);
    expect(byName(result, 'pet / Add a pet')?.request.body).toEqual({
      contentType: 'application/json',
      text: '{\n  "name": "Rex"\n}',
    });
    expect(result.environments[0]).toMatchObject({
      name: 'Sandbox',
      variables: [
        { name: 'baseUrl', value: 'https://petstore3.swagger.io/api/v3' },
        { name: 'token', value: '', secret: true },
      ],
    });
    expect(result.warnings).toEqual([
      'Upload an image: a multipartForm body cannot be imported and was left out',
      'Scripts and tests in the file were ignored and never run.',
    ]);
  });

  it('reads a .bru file from a repository and leaves its scripts out', async () => {
    const result = fromBruFile(await fixture('find-pet.bru'));
    expect(result.collections[0]?.name).toBe('Find pet by ID');
    expect(result.requests[0]?.request).toEqual({
      method: 'GET',
      url: '{{baseUrl}}/pet/10?verbose=true',
      headers: [['Accept', 'application/json']],
      body: {
        contentType: 'application/json',
        text: '{\n    "note": "a body on a GET is unusual but legal"\n  }',
      },
    });
    expect(result.warnings).toEqual([
      'Scripts and tests in the .bru file were ignored and never run.',
    ]);
  });

  it('says what is wrong with a .bru file it cannot use', () => {
    expect(fromBruFile('meta {\n  name: x\n}').warnings).toEqual([
      'No request found in the .bru file.',
    ]);
    expect(fromBruFile('get {\n  body: none\n}').warnings).toEqual([
      'The .bru file has no URL.',
    ]);
    expect(importText('post {\n  url: https://api.test/pets\n}').requests).toHaveLength(1);
  });

  it('writes a collection Bruno can read and takes it back', () => {
    const file = toBruno(collection(), [
      saved({
        name: 'Add a pet',
        request: request({
          method: 'POST',
          headers: [['Authorization', 'Bearer sk-live-1']],
          body: { contentType: 'application/json', text: '{"name":"Rex"}' },
        }),
      }),
      saved({ order: 2, name: 'Plain text', request: request({ body: { contentType: 'text/csv', text: 'a,b' } }) }),
    ]);
    expect(JSON.stringify(file)).not.toContain('sk-live-1');
    const back = importText(JSON.stringify(file));
    expect(names(back)).toEqual(['Add a pet', 'Plain text']);
    expect(back.requests[0]?.request.body).toEqual({
      contentType: 'application/json',
      text: '{"name":"Rex"}',
    });
    expect(back.requests[1]?.request.body).toEqual({
      contentType: 'text/plain',
      text: 'a,b',
    });
    expect(back.requests[0]?.request.headers).toEqual([['Authorization', '']]);
  });

  it('writes a request without a body as one', () => {
    const file = toBruno(collection(), [saved()]) as {
      items: { request: { body: { mode: string } } }[];
    };
    expect(file.items[0]!.request.body).toEqual({ mode: 'none' });
  });
});

describe("this project's own file", () => {
  it('carries the collections and the environments, with no secret value in them', () => {
    const file = toDockudosFile({
      collections: [collection(), collection({ id: 'c2', name: 'Other', order: 2 })],
      requests: [
        saved({ order: 2, name: 'Second' }),
        saved({ order: 1, name: 'First' }),
        saved({ collectionId: 'c2', name: 'Elsewhere' }),
      ],
      environments: [
        {
          id: 'e1',
          name: 'Sandbox',
          order: 1,
          variables: [
            { name: 'baseUrl', value: 'https://api.test' },
            { name: 'token', value: 'sk-live-1', secret: true },
          ],
          v: 1,
        },
      ],
    });
    expect(file.collections.map((c) => c.name)).toEqual(['Petstore', 'Other']);
    expect(file.collections[0]?.requests.map((r) => r.name)).toEqual(['First', 'Second']);
    expect(file.environments[0]?.variables).toEqual([
      { name: 'baseUrl', value: 'https://api.test' },
      { name: 'token', value: '', secret: true },
    ]);
    expect(JSON.stringify(file)).not.toContain('sk-live-1');

    const back = importText(JSON.stringify(file));
    expect(back.collections.map((c) => c.name)).toEqual(['Petstore', 'Other']);
    expect(names(back)).toEqual(['First', 'Second', 'Elsewhere']);
    expect(back.environments[0]?.variables[1]).toEqual({
      name: 'token',
      value: '',
      secret: true,
    });
    expect(back.warnings).toEqual([]);
  });

  it('warns when the file came from a newer version, and skips what it cannot read', () => {
    const result = importText(
      JSON.stringify({
        dockudos: 'api-client',
        version: 99,
        collections: [
          'nope',
          { name: 'Kept', requests: ['nope', { name: 'No URL', request: {} }, { name: 'Fine', request: { url: 'https://api.test' } }] },
        ],
        environments: ['nope', { name: 'Env', variables: [{ name: 'a', value: '1' }] }],
      }),
    );
    expect(result.warnings[0]).toMatch(/newer version \(99\)/);
    expect(names(result)).toEqual(['Fine']);
    expect(result.environments.map((e) => e.name)).toEqual(['Env']);
  });

  it('writes a file without environments when there are none', () => {
    expect(toDockudosFile({ collections: [], requests: [] }).environments).toEqual([]);
  });
});

describe('limits', () => {
  it('cuts a file that holds more than a reader should store, and says so', () => {
    const many = {
      dockudos: 'api-client',
      version: 1,
      collections: Array.from({ length: CLIENT_LIMITS.collections + 2 }, (_, i) => ({
        name: `C${i}`,
        requests: [{ name: 'r', request: { url: 'https://api.test' } }],
      })),
    };
    const result = importText(JSON.stringify(many));
    expect(result.collections).toHaveLength(CLIENT_LIMITS.collections);
    expect(result.requests).toHaveLength(CLIENT_LIMITS.collections);
    expect(result.warnings).toContain(
      `Only the first ${CLIENT_LIMITS.collections} collections of the file were imported.`,
    );
  });

  it('cuts a collection with too many requests in it', () => {
    const result = importText(
      JSON.stringify({
        dockudos: 'api-client',
        version: 1,
        collections: [
          {
            name: 'Big',
            requests: Array.from(
              { length: CLIENT_LIMITS.requestsPerCollection + 3 },
              (_, i) => ({ name: `r${i}`, request: { url: 'https://api.test' } }),
            ),
          },
        ],
      }),
    );
    expect(result.requests).toHaveLength(CLIENT_LIMITS.requestsPerCollection);
    expect(result.warnings.join(' ')).toMatch(/may hold \d+ requests/);
  });
});

describe('a curl command', () => {
  it('splits a command the way a shell would, without running anything', () => {
    expect(splitCommand(`curl -X POST 'https://api.test/a b' --data "{\\"a\\":1}"`)).toEqual([
      'curl',
      '-X',
      'POST',
      'https://api.test/a b',
      '--data',
      '{"a":1}',
    ]);
    expect(splitCommand('curl \\\n  --url https://api.test')).toEqual([
      'curl',
      '--url',
      'https://api.test',
    ]);
    expect(splitCommand('curl ^\n https://api.test')).toEqual(['curl', 'https://api.test']);
    expect(splitCommand("curl -d ''")).toEqual(['curl', '-d', '']);
    expect(splitCommand('curl a\\ b')).toEqual(['curl', 'a b']);
  });

  it('reads the command the playground itself shows', () => {
    const { request: parsed, warnings } = parseCurl(
      [
        'curl --request POST \\',
        "  --url 'https://api.test/pets?dry=1' \\",
        "  --header 'Content-Type: application/json' \\",
        "  --header 'api_key: sk-live-1' \\",
        `  --data '{"name":"Rex"}'`,
      ].join('\n'),
    );
    expect(warnings).toEqual([]);
    expect(parsed).toEqual({
      method: 'POST',
      url: 'https://api.test/pets?dry=1',
      headers: [
        ['Content-Type', 'application/json'],
        ['api_key', 'sk-live-1'],
      ],
      body: { contentType: 'application/json', text: '{"name":"Rex"}' },
    });
  });

  it('guesses the method and the content type from the data', () => {
    expect(parseCurl('curl -d name=Rex https://api.test/pets').request).toMatchObject({
      method: 'POST',
      body: { contentType: 'application/x-www-form-urlencoded', text: 'name=Rex' },
    });
    expect(
      parseCurl('curl --data-urlencode a=1 --data-urlencode b=2 https://api.test').request?.body,
    ).toEqual({ contentType: 'application/x-www-form-urlencoded', text: 'a=1&b=2' });
    expect(parseCurl(`curl --json '{"a":1}' https://api.test`).request).toMatchObject({
      headers: [['Content-Type', 'application/json']],
      body: { contentType: 'application/json', text: '{"a":1}' },
    });
    expect(parseCurl('curl https://api.test/pets').request?.method).toBe('GET');
  });

  it('turns -u into a Basic header and keeps a cookie and a user agent', () => {
    expect(parseCurl('curl -u me:pass -b s=1 -A Mine https://api.test').request?.headers).toEqual([
      ['Authorization', `Basic ${Buffer.from('me:pass').toString('base64')}`],
      ['Cookie', 's=1'],
      ['User-Agent', 'Mine'],
    ]);
  });

  it('refuses to read a file or send a form, and says why', () => {
    const file = parseCurl('curl -d @payload.json https://api.test');
    expect(file.warnings[0]).toMatch(/reads a file/);
    expect(file.request?.body).toBeUndefined();
    const form = parseCurl('curl -F file=@rex.png https://api.test');
    expect(form.warnings[0]).toMatch(/form upload/);
    expect(form.request?.body).toBeUndefined();
  });

  it('ignores the flags that are about how curl runs, and the ones with no value', () => {
    const result = parseCurl(
      'curl -sSL --compressed -k --max-time 30 -o out.json https://api.test/pets',
    );
    expect(result.request).toMatchObject({ method: 'GET', url: 'https://api.test/pets' });
    expect(result.warnings).toEqual([
      '--max-time is about how curl runs and was ignored.',
      '-o is about how curl runs and was ignored.',
    ]);
  });

  it('says what is wrong instead of guessing', () => {
    expect(parseCurl('wget https://api.test').warnings[0]).toMatch(/starts with `curl`/);
    expect(parseCurl('').warnings[0]).toMatch(/starts with `curl`/);
    expect(parseCurl('curl -X').warnings).toEqual([
      '-X needs a value; it was ignored.',
      'The command has no URL.',
    ]);
    expect(parseCurl('curl --header').request).toBeUndefined();
    expect(parseCurl('curl -%% https://api.test').warnings).toEqual(['-%% was ignored.']);
    expect(importText('curl -X POST').requests).toEqual([]);
  });

  it('writes a command back, quoting what the shell would eat', () => {
    expect(
      toCurl({
        method: 'POST',
        url: "https://api.test/pets?name=o'brien",
        headers: [['Content-Type', 'application/json']],
        body: { contentType: 'application/json', text: '{"a":1}' },
      }),
    ).toBe(
      [
        'curl --request POST \\',
        `  --url 'https://api.test/pets?name=o'\\''brien' \\`,
        `  --header 'Content-Type: application/json' \\`,
        `  --data '{"a":1}'`,
      ].join('\n'),
    );
    expect(toCurl(request())).toBe(
      "curl --request GET \\\n  --url 'https://api.test/pets'",
    );
  });

  it('imports a command as a collection of one', () => {
    const result = importText('curl -X DELETE https://api.test/pets/1');
    expect(result.collections).toHaveLength(1);
    expect(result.requests[0]).toMatchObject({
      name: 'DELETE /pets/1',
      request: { method: 'DELETE' },
    });
  });
});

describe('a request as a link', () => {
  it('goes into a fragment and comes back out', () => {
    const { text, tooLong, redacted } = encodeSharedRequest(
      request({
        method: 'POST',
        headers: [['X-Key', 'plain']],
        body: { contentType: 'application/json', text: '{"a":1}' },
      }),
      'Add a pet',
    );
    expect(tooLong).toBe(false);
    expect(redacted).toEqual([]);
    expect(text).not.toMatch(/[+/=]/);
    const url = sharedRequestUrl('https://docs.test/api-client#old', text);
    expect(url).toBe(`https://docs.test/api-client#request=${text}`);
    expect(decodeSharedRequest(new URL(url).hash)).toEqual({
      name: 'Add a pet',
      request: {
        method: 'POST',
        url: 'https://api.test/pets',
        headers: [['X-Key', 'plain']],
        body: { contentType: 'application/json', text: '{"a":1}' },
      },
    });
  });

  it('leaves the credential behind', () => {
    const { text, redacted } = encodeSharedRequest(
      request({ headers: [['Authorization', 'Bearer sk-live-1']] }),
    );
    expect(redacted).toEqual(['Authorization']);
    expect(decodeSharedRequest(text)?.request.headers).toEqual([['Authorization', '']]);
    expect(decodeSharedRequest(text)?.name).toBeUndefined();
  });

  it('says when a link would be too long to survive being pasted', () => {
    const big = encodeSharedRequest(
      request({ body: { contentType: 'text/plain', text: 'x'.repeat(9000) } }),
    );
    expect(big.tooLong).toBe(true);
  });

  it('gives nothing back for a damaged or empty link', () => {
    expect(decodeSharedRequest('')).toBeUndefined();
    expect(decodeSharedRequest('#request=')).toBeUndefined();
    expect(decodeSharedRequest('#request=not-base64!!')).toBeUndefined();
    expect(decodeSharedRequest(btoa('[1,2]'))).toBeUndefined();
    expect(decodeSharedRequest(btoa('{"request":{}}'))).toBeUndefined();
  });
});

describe('the variables an import still needs', () => {
  it('names the ones no environment has', () => {
    const requests = [
      saved({
        request: request({
          url: '{{baseUrl}}/pet/{{petId}}',
          headers: [['X-Key', '{{token}}']],
          body: { contentType: 'application/json', text: '{"owner":"{{owner}}"}' },
        }),
      }),
      saved({ request: request({ url: '\\{{literal}}/x' }) }),
    ];
    expect(neededVariables(requests, [{ name: 'baseUrl', value: 'https://api.test' }])).toEqual([
      'petId',
      'token',
      'owner',
    ]);
    expect(neededVariables([])).toEqual([]);
  });
});
