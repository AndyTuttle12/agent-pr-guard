import { expect, it } from 'vitest';
import { add } from './math.js';

it('adds', () => {
  expect(add(1, 2)).toBe(3);
});
