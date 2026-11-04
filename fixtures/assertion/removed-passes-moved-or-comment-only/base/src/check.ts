import assert from 'node:assert';

export function check(value: number): number {
  assert(value >= 0);
  assert.ok(Number.isFinite(value));
  return value;
}
