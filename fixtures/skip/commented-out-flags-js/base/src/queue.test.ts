import { expect, it } from 'vitest';
import { Queue } from './queue';

it('enqueues', () => {
  expect(new Queue().push(1).length).toBe(1);
});

it('dequeues in order', () => {
  const q = new Queue().push(1).push(2);
  expect(q.pop()).toBe(1);
});
