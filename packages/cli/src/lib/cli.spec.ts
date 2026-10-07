import { cli } from './cli.ts';

describe('cli', () => {
  it('should work', () => {
    expect(cli()).toEqual('cli');
  });
});
