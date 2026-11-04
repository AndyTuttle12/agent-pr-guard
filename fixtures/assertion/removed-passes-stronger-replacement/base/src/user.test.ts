import { expect, it } from 'vitest';
import { loadUser } from './user';

it('loads the user', async () => {
  const user = await loadUser(7);
  expect(user).toBeDefined();
});
