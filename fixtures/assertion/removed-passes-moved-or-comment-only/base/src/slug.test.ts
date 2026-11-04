import { expect, test } from 'vitest';
import { slug } from './slug';

test('lowercases', () => {
  expect(slug('Hello')).toBe('hello');
  // expect(slug('')).toBe('') once empty input is supported
});

test('joins words with dashes', () => {
  expect(slug('a b c')).toBe('a-b-c');
  expect(slug('  a  ')).toBe('a');
});
