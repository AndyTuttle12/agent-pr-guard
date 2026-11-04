import { describe, expect, it } from 'vitest';
import { price } from './price';

describe('price', () => {
  it('adds tax', () => {
    expect(price(100, 'NY')).toBe(108.875);
  });
});
