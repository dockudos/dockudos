import '@testing-library/jest-dom/vitest';
import { ICON_NAMES } from '@dockudos/ui';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { IconGallery } from '../src/icon-gallery';

afterEach(cleanup);

describe('IconGallery', () => {
  it('lists every icon, each as a button that names what it copies', () => {
    render(<IconGallery />);
    expect(screen.getAllByRole('button')).toHaveLength(ICON_NAMES.length);
    expect(
      screen.getByRole('button', { name: `Copy icon name ${ICON_NAMES[0]}` }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(`Filter ${ICON_NAMES.length} icons…`),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Click an icon to copy its name.',
    );
  });

  it('filters by name, ignoring case and surrounding spaces', async () => {
    render(<IconGallery />);
    const target = ICON_NAMES[0]!;
    await userEvent.type(
      screen.getByRole('searchbox'),
      `  ${target.toUpperCase()}  `,
    );
    const shown = screen.getAllByRole('button').map((b) => b.textContent);
    expect(shown).toContain(target);
    expect(shown.every((n) => n!.includes(target))).toBe(true);
  });

  it('says so when nothing matches, and shows the icons again when the filter is cleared', async () => {
    render(<IconGallery />);
    const box = screen.getByRole('searchbox');
    await userEvent.type(box, 'zzzz-no-such-icon');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(
      screen.getByText(/No icon matches “zzzz-no-such-icon”\./),
    ).toBeInTheDocument();
    await userEvent.clear(box);
    expect(screen.getAllByRole('button')).toHaveLength(ICON_NAMES.length);
    expect(screen.queryByText(/No icon matches/)).toBeNull();
  });

  it('copies the name of the icon clicked and announces it', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (t: string) => void written.push(t) },
      configurable: true,
    });
    render(<IconGallery />);
    const name = ICON_NAMES[1]!;
    await userEvent.click(
      screen.getByRole('button', { name: `Copy icon name ${name}` }),
    );
    expect(written).toEqual([name]);
    expect(screen.getByRole('status')).toHaveTextContent(`Copied “${name}”`);
  });
});
