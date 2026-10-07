import { DocsConfigError, parseConfig } from './config.ts';

const messageOf = (input: unknown) => {
  try {
    parseConfig(input, 'docs.json');
  } catch (e) {
    expect(e).toBeInstanceOf(DocsConfigError);
    return (e as Error).message;
  }
  throw new Error('expected parseConfig to throw');
};

describe('parseConfig', () => {
  it('accepts a minimal config and defaults navigation', () => {
    expect(parseConfig({ name: 'Acme Docs' })).toEqual({
      name: 'Acme Docs',
      navigation: [],
    });
  });

  it('accepts tabs, groups and pages', () => {
    const config = {
      name: 'Acme',
      navigation: [
        {
          tab: 'Guides',
          groups: [{ group: 'Start', pages: ['index', 'a/b'] }],
        },
      ],
    };
    expect(parseConfig(config)).toEqual(config);
  });

  it('names the key when `name` is missing', () => {
    expect(messageOf({})).toContain('name:');
  });

  it('names the source file', () => {
    expect(messageOf({})).toContain('in docs.json');
  });

  it('rejects an empty name', () => {
    expect(messageOf({ name: '' })).toContain('name:');
  });

  it('rejects unknown keys by name (strict)', () => {
    expect(messageOf({ name: 'x', nav: [] })).toContain('unknown key nav');
  });

  it('gives a nested path for bad navigation entries', () => {
    const msg = messageOf({
      name: 'x',
      navigation: [{ tab: 'T', groups: [{ group: 'G', pages: [1] }] }],
    });
    expect(msg).toContain('navigation[0].groups[0].pages[0]');
  });

  it('reports every problem, not only the first', () => {
    const e = new DocsConfigError(['a', 'b']);
    expect(e.issues).toEqual(['a', 'b']);
    expect(() => parseConfig({ name: 1, extra: true })).toThrow(
      /name:[\s\S]*unknown key extra/,
    );
  });

  it('rejects non-object input', () => {
    expect(messageOf('nope')).toContain('(root)');
  });
});
