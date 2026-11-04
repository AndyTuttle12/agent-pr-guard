import { describe, expect, it } from 'vitest';
import { Cart } from './cart';

describe('Cart', () => {
  it('adds an item', () => {
    const cart = new Cart();
    cart.add({ sku: 'a', price: 300 });
    expect(cart.items).toEqual([{ sku: 'a', price: 300 }]);
    expect(cart.total()).toBe(300);
  });

  it('knows when it is empty', () => {
    expect(new Cart().isEmpty()).toBe(true);
    expect(new Cart().items.length).toBe(0);
  });

  it('counts items', () => {
    const cart = new Cart();
    cart.add({ sku: 'a', price: 1 });
    expect(cart.count()).toBeGreaterThan(0);
  });

  it('rejects a negative price', () => {
    expect(() => new Cart().add({ sku: 'b', price: -1 })).toThrow(RangeError);
  });
});
