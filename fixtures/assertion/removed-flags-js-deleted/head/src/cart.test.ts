import { describe, expect, it } from 'vitest';
import { Cart } from './cart';

describe('Cart', () => {
  it('totals line items', () => {
    const cart = new Cart();
    cart.add({ sku: 'a', price: 300, qty: 2 });
    expect(cart.total()).toBe(600);
  });

  it('rejects a negative quantity', () => {
    const cart = new Cart();
    expect(() => cart.add({ sku: 'a', price: 1, qty: -1 })).toThrow(RangeError);
  });
});
