import { resolveVisibility } from './visibility.ts';

const doc = [
  'before',
  '<Visibility for="agents">',
  'call the API',
  '</Visibility>',
  '<Visibility for="humans">',
  'click the button',
  '</Visibility>',
  'after',
].join('\n');

describe('resolveVisibility', () => {
  it('keeps agent content and drops human content for agents', () => {
    expect(resolveVisibility(doc, 'agents')).toBe(
      'before\ncall the API\nafter',
    );
  });

  it('keeps human content and drops agent content for humans', () => {
    expect(resolveVisibility(doc, 'humans')).toBe(
      'before\nclick the button\nafter',
    );
  });

  it('leaves examples inside code fences alone', () => {
    const src = '```mdx\n<Visibility for="agents">\nx\n</Visibility>\n```';
    expect(resolveVisibility(src, 'agents')).toBe(src);
  });

  it('handles an expression-valued audience', () => {
    const src = '<Visibility for={"agents"}>\nhi\n</Visibility>';
    expect(resolveVisibility(src, 'agents')).toBe('hi');
    expect(resolveVisibility(src, 'humans')).toBe('');
  });
});
