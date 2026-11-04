import { expect, it } from 'vitest';

it.skip('handles the unicode edge case', () => {
  expect('e'.length).toBe(1);
});
