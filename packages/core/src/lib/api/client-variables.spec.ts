import {
  applyVariables,
  substitute,
  usedVariables,
  variableValues,
} from './client-variables.ts';

describe('substitute', () => {
  const vars = {
    baseUrl: 'https://api.test',
    token: 'sk-live-1',
    petId: '42',
  };

  it('replaces a reference, with or without spaces inside the braces', () => {
    expect(substitute('{{baseUrl}}/pet/{{ petId }}', vars)).toEqual({
      text: 'https://api.test/pet/42',
      missing: [],
      cyclic: [],
    });
  });

  it('resolves a variable that uses other variables', () => {
    const nested = {
      scheme: 'https',
      host: 'api.test',
      base: '{{scheme}}://{{host}}',
      url: '{{base}}/v1',
    };
    expect(substitute('{{url}}/pets', nested).text).toBe(
      'https://api.test/v1/pets',
    );
  });

  it('leaves a name with no value as it is written and reports it once', () => {
    const result = substitute(
      '{{baseUrl}}/pet/{{missing}}?a={{missing}}',
      vars,
    );
    expect(result.text).toBe('https://api.test/pet/{{missing}}?a={{missing}}');
    expect(result.missing).toEqual(['missing']);
  });

  it('reports a loop instead of following it', () => {
    const result = substitute('{{a}}', { a: 'x{{b}}', b: 'y{{a}}' });
    expect(result.text).toBe('xy{{a}}');
    expect(result.cyclic).toEqual(['a']);
    expect(result.missing).toEqual([]);
  });

  it('stops at a depth that is not a loop but is deep enough to be one', () => {
    const chain: Record<string, string> = {};
    for (let i = 0; i < 20; i += 1) chain[`v${i}`] = `{{v${i + 1}}}`;
    chain.v20 = 'end';
    const result = substitute('{{v0}}', chain);
    expect(result.cyclic).toHaveLength(1);
    expect(result.text).toMatch(/\{\{v\d+\}\}/);
  });

  it('sends the braces themselves when a reference is escaped', () => {
    expect(substitute('\\{{token}} and {{token}}', vars).text).toBe(
      '{{token}} and sk-live-1',
    );
    expect(usedVariables('\\{{token}} {{petId}}')).toEqual(['petId']);
  });

  it('leaves the names the caller asks it to keep, which is how a code sample hides a secret', () => {
    expect(
      substitute('{{baseUrl}}/pets?key={{token}}', vars, { keep: ['token'] }),
    ).toEqual({
      text: 'https://api.test/pets?key={{token}}',
      missing: [],
      cyclic: [],
    });
  });

  it('ignores braces that are not a reference', () => {
    expect(substitute('{ "a": 1 } {{}} {{ }}', vars).text).toBe(
      '{ "a": 1 } {{}} {{ }}',
    );
  });

  it('lists the names a text uses, each one once', () => {
    expect(usedVariables('{{a}}/{{b}}/{{a}}')).toEqual(['a', 'b']);
    expect(usedVariables('nothing here')).toEqual([]);
  });
});

describe('applyVariables', () => {
  const vars = {
    baseUrl: 'https://api.test',
    token: 'sk-live-1',
    header: 'X-Key',
  };

  it('resolves the URL, both halves of a header, and the body', () => {
    const result = applyVariables(
      {
        method: 'POST',
        url: '{{baseUrl}}/pets',
        headers: [['{{header}}', 'Bearer {{token}}']],
        body: {
          contentType: 'application/json',
          text: '{"owner":"{{owner}}"}',
        },
      },
      vars,
    );
    expect(result.request).toEqual({
      method: 'POST',
      url: 'https://api.test/pets',
      headers: [['X-Key', 'Bearer sk-live-1']],
      body: { contentType: 'application/json', text: '{"owner":"{{owner}}"}' },
    });
    expect(result.missing).toEqual(['owner']);
    expect(result.cyclic).toEqual([]);
  });

  it('collects every missing and looping name across the request, each one once', () => {
    const result = applyVariables(
      {
        method: 'GET',
        url: '{{host}}/{{host}}',
        headers: [['X-A', '{{loop}}']],
      },
      { loop: '{{loop}}' },
    );
    expect(result.missing).toEqual(['host']);
    expect(result.cyclic).toEqual(['loop']);
  });

  it('leaves a request without a body without one', () => {
    expect(
      applyVariables({ method: 'GET', url: '{{baseUrl}}', headers: [] }, vars)
        .request.body,
    ).toBeUndefined();
  });

  it('reads an environment as a plain record, the last of a name winning', () => {
    expect(
      variableValues([
        { name: 'a', value: '1' },
        { name: 'b', value: '2' },
        { name: 'a', value: '3' },
      ]),
    ).toEqual({ a: '3', b: '2' });
  });
});
