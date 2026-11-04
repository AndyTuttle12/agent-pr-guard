import { expect, test } from 'vitest';
import { area, hypot } from './geometry';

const EPSILON = 1e-9;

test('circle area', () => {
  expect(area(1)).toBeCloseTo(Math.PI, 10);
});

test('hypotenuse', () => {
  expect(Math.abs(hypot(3, 4) - 5)).toBeLessThan(EPSILON);
});
