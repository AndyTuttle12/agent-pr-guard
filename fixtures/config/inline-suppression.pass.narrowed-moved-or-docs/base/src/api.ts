import { fetchUser } from './client.js';

export async function userName(id: string): Promise<string> {
  const user = await fetchUser(id);
  // @ts-ignore
  return user.displayName;
}

export function logUser(id: string): void {
  console.log(id); // eslint-disable-line no-console
}
