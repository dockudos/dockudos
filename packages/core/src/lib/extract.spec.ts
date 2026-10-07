import { extractPage, plainTextOf } from './extract.ts';

const page = `
import { Foo } from './foo'
export const meta = { a: 1 }

Intro with **bold**, _emphasis_ and a [link](/guides/x "t").

{/* a comment */}
<!-- an html comment -->

## Authentication

Send the key in the \`Authorization\` header.

\`\`\`bash title="curl"
curl -H "Authorization: Bearer $KEY" https://api.example.com/v1/users
\`\`\`

### API keys

<Callout type="warning" title="Keep it secret">
  Never commit **keys**.
</Callout>

<Steps>
  <Step title="Create a key">Open the dashboard.</Step>
</Steps>

## Tables

| Name | Type |
| --- | --- |
| \`limit\` | number |
| \`cursor\` | string |

## Authentication

Duplicate heading.
`;

describe('extractPage', () => {
  const out = extractPage(page);

  it('reads headings with the ids the rendered page uses', () => {
    expect(out.headings).toEqual([
      { id: 'authentication', text: 'Authentication', depth: 2 },
      { id: 'api-keys', text: 'API keys', depth: 3 },
      { id: 'tables', text: 'Tables', depth: 2 },
      { id: 'authentication-1', text: 'Authentication', depth: 2 },
    ]);
  });

  it('splits into sections with heading paths and anchors', () => {
    expect(
      out.sections.map((s) => [s.headingPath.join(' > '), s.anchor]),
    ).toEqual([
      ['', ''],
      ['Authentication', 'authentication'],
      ['Authentication > API keys', 'api-keys'],
      ['Tables', 'tables'],
      ['Authentication', 'authentication-1'],
    ]);
  });

  it('turns markup into plain text and drops imports and comments', () => {
    const intro = out.sections[0]?.text ?? '';
    expect(intro).toBe('Intro with bold, emphasis and a link.');
    expect(plainTextOf(page)).not.toMatch(/import|export const|comment|<!--/);
  });

  it('keeps code text so API names are searchable', () => {
    const auth = out.sections[1]?.text ?? '';
    expect(auth).toContain('Send the key in the Authorization header.');
    expect(auth).toContain(
      'curl -H "Authorization: Bearer $KEY" https://api.example.com/v1/users',
    );
    expect(auth).not.toContain('```');
  });

  it('keeps text between JSX tags and the values of text attributes', () => {
    const keys = out.sections[2]?.text ?? '';
    expect(keys).toContain('Keep it secret');
    expect(keys).toContain('Never commit keys.');
    expect(keys).toContain('Create a key');
    expect(keys).toContain('Open the dashboard.');
    expect(keys).not.toMatch(/[<>]/);
  });

  it('reads tables as rows', () => {
    expect(out.sections[3]?.text).toBe(
      'Name | Type\nlimit | number\ncursor | string',
    );
  });

  it('does not treat generics in inline code as tags', () => {
    const t = plainTextOf('Returns `Array<string>` for **all** keys.');
    expect(t).toBe('Returns Array<string> for all keys.');
  });

  it('handles tags spanning several lines', () => {
    const t = plainTextOf(
      '<Card\n  title="Billing"\n  href="/billing"\n  icon="card"\n>\n  Pay invoices.\n</Card>',
    );
    expect(t).toContain('Billing');
    expect(t).toContain('Pay invoices.');
    expect(t).not.toContain('href');
  });

  it('keeps inline tags inside a sentence on one line', () => {
    expect(plainTextOf('Press <Kbd>Ctrl</Kbd> to start.')).toBe(
      'Press Ctrl to start.',
    );
  });

  it('keeps text after the last heading and uses the first h1 as title', () => {
    const r = extractPage('# My title\n\nText.\n\n## A\n\nMore.');
    expect(r.title).toBe('My title');
    expect(r.sections.map((s) => s.text)).toEqual(['Text.', 'More.']);
  });

  it('leaves headings inside code fences alone', () => {
    const r = extractPage('## A\n\n```md\n## not a heading\n```\n');
    expect(r.headings.map((h) => h.text)).toEqual(['A']);
    expect(r.sections[0]?.text).toBe('## not a heading');
  });

  it('keeps deeper headings as text of their section', () => {
    const r = extractPage('## A\n\n##### Deep\n\nBody.');
    expect(r.headings).toHaveLength(1);
    expect(r.sections[0]?.text).toBe('Deep\n\nBody.');
  });

  it('is empty for an empty page', () => {
    expect(extractPage('')).toEqual({ headings: [], sections: [] });
  });
});
