import { expect, it } from 'vitest';
import { parseFlags } from './flags';

it('parses flags', () => {
  const flags = parseFlags(['--verbose']);
  expect(flags).toEqual({ verbose: true });
  expect(flags.verbose).toBeTruthy();
});
