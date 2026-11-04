import { fetchUser } from './client.js';

export async function userName(id: string): Promise<string> {
  const user = await fetchUser(id);
  return user.name;
}
