const assert = require('node:assert');
const { test } = require('node:test');
const { parse } = require('../src/parser');

test('parses an empty object', () => {
  assert.deepStrictEqual(parse('{}'), {});
});

test('parses nested arrays', () => {
  const out = parse('[[1], [2, 3]]');
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out[1], [2, 3]);
});
