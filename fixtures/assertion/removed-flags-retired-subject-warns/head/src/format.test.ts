import { expect, it } from 'vitest';
import { formatDate } from './dates';

it('formats a date', () => {
  expect(formatDate(new Date('2026-01-02T00:00:00Z'))).toBe('2026-01-02');
});
