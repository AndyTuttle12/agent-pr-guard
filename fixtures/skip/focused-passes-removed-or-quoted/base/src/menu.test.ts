import { expect, it } from 'vitest';
import { menu } from './menu';

it.only('opens', () => {
  expect(menu().open).toBe(true);
});
