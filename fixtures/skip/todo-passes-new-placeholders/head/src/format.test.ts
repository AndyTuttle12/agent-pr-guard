import { expect, it, test } from 'vitest';
import { format } from './format';

it('formats dates', () => {
  expect(format(new Date(0))).toBe('1970-01-01');
});

it.todo('formats times');
it.todo('formats durations');
test('formats weeks', { todo: true });
