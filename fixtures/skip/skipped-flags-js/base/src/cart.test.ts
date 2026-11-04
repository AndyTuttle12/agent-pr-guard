import { describe, expect, it, test } from 'vitest';
import { Cart } from './cart';

describe('cart', () => {
  it('starts empty', () => {
    expect(new Cart().size).toBe(0);
  });

  it('adds items', () => {
    expect(new Cart().add('a').size).toBe(1);
  });

  test('totals', () => {
    expect(new Cart().add('a', 2).total).toBe(2);
  });
});

describe('discounts', () => {
  it('applies a coupon', () => {
    expect(new Cart().coupon('TEN').discount).toBe(0.1);
  });
});
