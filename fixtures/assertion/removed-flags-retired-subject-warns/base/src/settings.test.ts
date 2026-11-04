import { expect, it } from 'vitest';
import { migrateLegacy, normalize } from './settings';

it('drops duplicates', () => {
  expect(normalize({ order: ['a', 'a'] })).toEqual({ order: ['a'] });
});

it('renames the legacy id', () => {
  expect(migrateLegacy({ order: ['old', 'b'] })).toEqual({ order: ['new', 'b'] });
});
