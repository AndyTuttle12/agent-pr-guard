import { expect, it } from 'vitest';
import { Store } from './store';

it('keeps rows in memory', () => {
  expect(new Store().rows()).toEqual([]);
});
