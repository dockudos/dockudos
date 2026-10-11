import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MdxPreview, compile } from '../src/components/mdx-preview';

describe('MdxPreview', () => {
  it('renders the page with the real dockudos components', async () => {
    render(
      <MdxPreview
        source={
          '---\ntitle: Webhooks\n---\n\n## Setup\n\n<Callout type="warning">Keep the secret safe</Callout>\n\n<Steps>\n<Step title="One">First</Step>\n</Steps>\n\n```bash\nnpm install\n```\n'
        }
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Webhooks' })).toBeTruthy(),
    );
    expect(screen.getByText('Keep the secret safe')).toBeTruthy();
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('npm install')).toBeTruthy();
  });

  it('shows the MDX error instead of crashing while someone is mid-edit', async () => {
    render(<MdxPreview source={'# Hi\n\n<Callout>unclosed'} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(
      /Callout|closing|Expected/i,
    );
  });

  it('reports bad front matter', async () => {
    const r = await compile('---\ntitle: [oops\n---\nbody');
    expect(r.ok).toBe(false);
  });

  it('shows nothing before the first message arrives', () => {
    const { container } = render(<MdxPreview source="" />);
    expect(container.textContent).toBe('');
  });
});
