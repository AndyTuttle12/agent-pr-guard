import { expect, it } from 'vitest';
import { List } from './list';

it('appends', () => {
  expect(new List().append(1).size).toBe(1);
});

it('prepends', () => {
  expect(new List().prepend(1).size).toBe(1);
});
