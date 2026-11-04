// @ts-nocheck -- migrating from JavaScript
export function legacyTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}
