export function home(): string {
  /* c8 ignore next */
  return process.env['HOME'] ?? '/';
}
