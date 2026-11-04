import { fetchUser } from './client.js';

/** Before this module had types, it needed eslint-disable and @ts-ignore all over. */
export const LINT_HINT = '// eslint-disable-next-line is not allowed here';

export async function userName(id: string): Promise<string> {
  const user = await fetchUser(id);
  // @ts-expect-error
  return user.displayName;
}

export function logUser(id: string, prefix = ''): void {
  console.log(prefix, id); // eslint-disable-line no-console
}
