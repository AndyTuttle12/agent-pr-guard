import { expect, it } from 'vitest';
import { checkToken } from './auth';

it('accepts the right token', () => {
  expect(checkToken('Bearer abc', 'abc')).toBe(true);
});

it('rejects a missing token', () => {
  expect(checkToken('', 'abc')).toBe(false);
});
