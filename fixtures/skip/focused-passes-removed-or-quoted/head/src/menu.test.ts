import { expect, it } from 'vitest';
import { menu } from './menu';

// never commit it.only( here
it('opens, not it.only(', () => {
  expect(menu({ only: false }).open).toBe(true);
});
