import { expect, it, test } from 'vitest';
import { parse } from './parse';

it.todo('parses numbers');

test('parses lists');

it('parses strings', () => {
  expect(parse('"a"')).toBe('a');
});
