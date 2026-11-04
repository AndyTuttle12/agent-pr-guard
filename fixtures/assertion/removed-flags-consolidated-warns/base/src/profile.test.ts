import { expect, it } from 'vitest';
import { loadProfile } from './profile';

it('loads the profile', async () => {
  const profile = await loadProfile(7);
  expect(profile.id).toBe(7);
  expect(profile.name).toBe('Ada');
  expect(profile.active).toBe(true);
});
