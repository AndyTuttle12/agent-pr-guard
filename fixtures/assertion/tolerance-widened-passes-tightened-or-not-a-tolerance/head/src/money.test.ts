import { expect, test } from 'vitest';
import { convert, scroll } from './money';

const tol = 1e-6;

test('converts', () => {
  expect(convert(10, 'EUR')).toBeCloseTo(10.95, 6);
  expect(Math.abs(convert(1, 'GBP') - 1.27)).toBeLessThan(tol);
});

test('scrolls by a delta', () => {
  const delta = 50;
  expect(scroll({ delta: 10 })).toBe(delta);
});
