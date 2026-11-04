import { expect, it } from 'vitest';
import { Store } from './store';

it('keeps rows in memory', () => {
  expect(new Store().rows()).toEqual([]);
});

it('persists rows to the database', async (context) => {
  const url = process.env.DATABASE_URL;
  if (url === undefined) {
    context.skip('DATABASE_URL is not set');
  }
  const store = await Store.connect(url);
  expect(await store.rows()).toEqual([]);
});
