import { withDocs } from './with-docs.ts';

describe('withDocs', () => {
  it('adds md and mdx page extensions to the defaults', () => {
    expect(withDocs().pageExtensions).toEqual([
      'js',
      'jsx',
      'ts',
      'tsx',
      'md',
      'mdx',
    ]);
  });

  it('extends, not replaces, user page extensions without duplicating', () => {
    expect(withDocs({ pageExtensions: ['tsx', 'mdx'] }).pageExtensions).toEqual(
      ['tsx', 'mdx', 'md'],
    );
  });

  it('preserves the user config fields', () => {
    const config = withDocs({
      reactStrictMode: true,
      images: { unoptimized: true },
      env: { A: '1' },
    });
    expect(config.reactStrictMode).toBe(true);
    expect(config.images).toEqual({ unoptimized: true });
    expect(config.env).toEqual({ A: '1' });
  });

  it('does not mutate the input', () => {
    const input = { pageExtensions: ['tsx'] };
    withDocs(input);
    expect(input.pageExtensions).toEqual(['tsx']);
  });

  it('wires an MDX loader into webpack', () => {
    expect(typeof withDocs().webpack).toBe('function');
  });

  it('wires an MDX loader into Turbopack when it is active', () => {
    vi.stubEnv('TURBOPACK', '1');
    try {
      expect(JSON.stringify(withDocs().turbopack?.rules)).toContain('mdx');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
