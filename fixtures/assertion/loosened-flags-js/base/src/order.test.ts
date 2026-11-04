import { describe, expect, it } from 'vitest';
import { placeOrder, UnknownSkuError } from './order';

describe('placeOrder', () => {
  it('returns the receipt', () => {
    const receipt = placeOrder({ sku: 'a', qty: 1 });
    expect(receipt).toEqual({ id: 1, total: 300 });
    expect(receipt.lines).toStrictEqual([{ sku: 'a', qty: 1 }]);
  });

  it('rejects an unknown sku', () => {
    expect(() => placeOrder({ sku: 'zz', qty: 1 })).toThrow(UnknownSkuError);
  });
});
