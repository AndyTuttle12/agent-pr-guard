import { run } from './run.js';

export const debug = process.env['DEBUG'] === '1';

export function main(argv: string[]): number {
  /* c8 ignore next */
  if (argv.length === 0) return 2;
  return run(argv);
}
