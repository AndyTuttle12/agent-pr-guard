export function home(): string {
  /* c8 ignore next -- the fallback only runs on a bare CI image */
  return process.env['HOME'] ?? process.cwd();
}
