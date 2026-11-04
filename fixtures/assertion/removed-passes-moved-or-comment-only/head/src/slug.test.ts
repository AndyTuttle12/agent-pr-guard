import { expect, test } from 'vitest';
import { slug } from './slug';

test('joins words with dashes', () => {
  expect(slug('a b c')).toBe('a-b-c');
  expect(slug('  a  ')).toBe('a');
});

test('lowercases, expect(slug) style', () => {
  expect(slug('Hello')).toBe('hello');
});
