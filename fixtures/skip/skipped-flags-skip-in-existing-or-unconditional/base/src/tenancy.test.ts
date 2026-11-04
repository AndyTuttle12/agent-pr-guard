import { expect, it } from 'vitest';
import { client } from './client';

it('rejects writes into another organization', async () => {
  const insert = await client('org-a').insert({ org: 'org-b' });
  expect(insert.error).not.toBeNull();
});
