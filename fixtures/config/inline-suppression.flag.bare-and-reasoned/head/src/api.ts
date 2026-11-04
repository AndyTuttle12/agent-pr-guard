import { fetchUser } from './client.js';

export async function userName(id: string): Promise<string> {
  const user = await fetchUser(id);
  // @ts-ignore
  return user.displayName;
}

export function logUser(id: string): void {
  // eslint-disable-next-line no-console -- CLI output, not a leftover debug log
  console.log(id);
}
