import { expect, it } from 'vitest';
import { parseFlags } from './flags';

it('parses flags', () => {
  const flags = parseFlags(['--verbose']);
  expect(flags).toBeDefined();
  expect(flags).toStrictEqual({ verbose: true });
  expect(flags.verbose).toBe(true);
});
