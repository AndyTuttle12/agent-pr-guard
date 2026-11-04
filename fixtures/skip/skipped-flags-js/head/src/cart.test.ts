import { describe, expect, it, test } from 'vitest';
import { Cart } from './cart';

describe('cart', () => {
  it.skip('starts empty', () => {
    expect(new Cart().size).toBe(0);
  });

  xit('adds items', () => {
    expect(new Cart().add('a').size).toBe(1);
  });

  test.skipIf(process.env.CI)('totals', () => {
    expect(new Cart().add('a', 2).total).toBe(2);
  });
});

describe.skip('discounts', () => {
  it('applies a coupon', () => {
    expect(new Cart().coupon('TEN').discount).toBe(0.1);
  });
});
