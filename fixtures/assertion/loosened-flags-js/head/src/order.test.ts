import { describe, expect, it } from 'vitest';
import { placeOrder, UnknownSkuError } from './order';

describe('placeOrder', () => {
  it('returns the receipt', () => {
    const receipt = placeOrder({ sku: 'a', qty: 1 });
    expect(receipt).toBeDefined();
    expect(receipt.lines).toBeTruthy();
  });

  it('rejects an unknown sku', () => {
    expect(() => placeOrder({ sku: 'zz', qty: 1 })).toThrow();
  });
});
