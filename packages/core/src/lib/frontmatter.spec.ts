import {
  firstHeading,
  FrontmatterError,
  parseFrontmatter,
} from './frontmatter.ts';

describe('parseFrontmatter', () => {
  it('reads known keys and keeps unknown ones', () => {
    const { data, body } = parseFrontmatter(
      '---\ntitle: Hello\ndescription: A page\nicon: rocket\ncustom: 1\n---\n# Body\n',
    );
    expect(data).toMatchObject({
      title: 'Hello',
      description: 'A page',
      icon: 'rocket',
      custom: 1,
      hidden: false,
    });
    expect(body).toBe('# Body\n');
  });

  it('returns defaults when there is no frontmatter', () => {
    const { data, body, bodyOffset } = parseFrontmatter('# Just content');
    expect(data.title).toBeUndefined();
    expect(data.hidden).toBe(false);
    expect(body).toBe('# Just content');
    expect(bodyOffset).toBe(0);
  });

  it('handles CRLF and an empty block', () => {
    expect(parseFrontmatter('---\r\ntitle: A\r\n---\r\nbody').data.title).toBe(
      'A',
    );
    expect(parseFrontmatter('---\n\n---\nbody').body).toBe('body');
  });

  it('reports how many lines the block took', () => {
    expect(parseFrontmatter('---\ntitle: A\n---\nbody').bodyOffset).toBe(3);
  });

  it('names the file and key for a wrong type', () => {
    expect(() =>
      parseFrontmatter('---\nhidden: "yes"\n---\n', 'a/b.mdx'),
    ).toThrow(/a\/b\.mdx[\s\S]*hidden/);
  });

  it('rejects an empty title', () => {
    expect(() => parseFrontmatter('---\ntitle: ""\n---\n', 'x.mdx')).toThrow(
      /title/,
    );
  });

  it('reports invalid YAML as a FrontmatterError', () => {
    expect(() => parseFrontmatter('---\ntitle: [oops\n---\n', 'x.mdx')).toThrow(
      FrontmatterError,
    );
  });
});

describe('firstHeading', () => {
  it('finds the first h1', () => {
    expect(firstHeading('intro\n\n# The `Title` *here*\n## sub')).toBe(
      'The Title here',
    );
  });

  it('ignores headings inside code fences', () => {
    expect(firstHeading('```md\n# not me\n```\n\n# real')).toBe('real');
  });

  it('ignores headings inside an indented fence', () => {
    expect(
      firstHeading('<Step>\n    ```md\n    # not me\n    ```\n</Step>\n# real'),
    ).toBe('real');
  });

  it('returns undefined when there is no h1', () => {
    expect(firstHeading('## only h2')).toBeUndefined();
  });
});
