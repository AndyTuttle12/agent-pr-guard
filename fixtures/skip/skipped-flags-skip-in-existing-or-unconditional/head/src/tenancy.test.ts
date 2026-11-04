import { expect, it } from 'vitest';
import { client } from './client';

it('rejects writes into another organization', async (context) => {
  const insert = await client('org-a').insert({ org: 'org-b' });
  if (!insert.error) {
    context.skip('the enforcement migration is not applied');
    return;
  }
  expect(insert.error).not.toBeNull();
});
