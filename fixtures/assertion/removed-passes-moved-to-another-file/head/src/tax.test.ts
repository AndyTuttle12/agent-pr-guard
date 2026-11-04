import { describe, expect, it } from 'vitest';
import { tax } from './price';

describe('tax', () => {
  it('computes tax alone', () => {
    expect(tax(100, 'NY')).toBe(8.875);
    expect(tax(100, 'OR')).toBe(0);
  });
});
