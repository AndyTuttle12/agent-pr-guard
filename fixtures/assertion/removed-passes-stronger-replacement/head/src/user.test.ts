import { expect, it } from 'vitest';
import { loadUser } from './user';

it('loads the user', async () => {
  const user = await loadUser(7);
  expect(user).toEqual({ id: 7, name: 'Ada', roles: ['admin'] });
});
