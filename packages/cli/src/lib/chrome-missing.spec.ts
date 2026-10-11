import { vi } from 'vitest';

// A machine with no browser installed at any of the usual places.
vi.mock('node:fs/promises', () => ({
  access: async () => {
    throw new Error('ENOENT');
  },
}));

const { findChrome } = await import('./chrome.ts');

describe('findChrome: nothing installed', () => {
  it('explains how to get a browser', async () => {
    await expect(findChrome(undefined, {})).rejects.toThrow(
      'No Chrome or Chromium found',
    );
  });
});
