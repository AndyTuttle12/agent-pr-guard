import { expect, it } from 'vitest';
import { loadProfile } from './profile';

it('loads the profile', async () => {
  const profile = await loadProfile(7);
  expect(profile).toEqual({ id: 7, name: 'Ada', active: true });
});
