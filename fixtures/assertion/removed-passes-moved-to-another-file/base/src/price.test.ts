import { describe, expect, it } from 'vitest';
import { price, tax } from './price';

describe('price', () => {
  it('adds tax', () => {
    expect(price(100, 'NY')).toBe(108.875);
  });

  it('computes tax alone', () => {
    expect(tax(100, 'NY')).toBe(8.875);
    expect(tax(100, 'OR')).toBe(0);
  });
});
