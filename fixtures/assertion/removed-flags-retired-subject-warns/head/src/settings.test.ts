import { expect, it } from 'vitest';
import { normalize } from './settings';

it('drops duplicates', () => {
  expect(normalize({ order: ['a', 'a'] })).toEqual({ order: ['a'] });
});
