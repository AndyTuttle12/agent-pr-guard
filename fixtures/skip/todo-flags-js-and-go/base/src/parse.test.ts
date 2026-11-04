import { expect, it, test } from 'vitest';
import { parse } from './parse';

it('parses numbers', () => {
  expect(parse('1')).toBe(1);
});

test('parses lists', () => {
  expect(parse('[1]')).toEqual([1]);
});

it('parses strings', () => {
  expect(parse('"a"')).toBe('a');
});
