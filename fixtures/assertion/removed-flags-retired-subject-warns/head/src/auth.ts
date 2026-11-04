export function checkToken(header: string, token: string): boolean {
  return header === `Bearer ${token}`;
}
