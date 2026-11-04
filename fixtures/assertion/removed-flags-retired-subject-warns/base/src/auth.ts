const TOKEN_PREFIX = 'Bearer ';

export function checkToken(header: string, token: string): boolean {
  const expected = `${TOKEN_PREFIX}${token}`;
  return header.length === expected.length && header === expected;
}
