import assert, { deepStrictEqual as same } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Cart } from './cart';

describe('Cart', () => {
  it('adds an item', () => {
    const cart = new Cart();
    cart.add({ sku: 'a', price: 300 });
    same(cart.items, [{ sku: 'a', price: 300 }]);
    assert.strict.equal(cart.total(), 300);
  });

  it('knows when it is empty', () => {
    assert.ok(new Cart().isEmpty());
    assert.equal(new Cart().items.length, 0);
  });

  it('counts items', () => {
    const cart = new Cart();
    cart.add({ sku: 'a', price: 1 });
    assert.ok(cart.count() > 0);
  });

  it('rejects a negative price', () => {
    assert.throws(() => new Cart().add({ sku: 'b', price: -1 }), RangeError);
  });
});
