import { expect, test } from 'vitest';
import { convert, scroll } from './money';

const tol = 1e-2;

test('converts', () => {
  expect(convert(10, 'EUR')).toBeCloseTo(10.9, 2);
  expect(Math.abs(convert(1, 'GBP') - 1.27)).toBeLessThan(tol);
});

test('scrolls by a delta', () => {
  const delta = 5;
  expect(scroll({ delta: 1 })).toBe(delta);
});
