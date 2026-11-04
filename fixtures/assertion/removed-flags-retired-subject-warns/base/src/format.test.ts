import { expect, it } from 'vitest';
import { formatDate, formatPrice } from './format';

it('formats a date', () => {
  expect(formatDate(new Date('2026-01-02T00:00:00Z'))).toBe('2026-01-02');
});

it('formats a price', () => {
  expect(formatPrice(1234)).toBe('$12.34');
  expect(formatPrice(5)).toBe('$0.05');
});
