import { run } from './run.js';

/* c8 ignore next */
export const debug = process.env['DEBUG'] === '1';

export function main(argv: string[]): number {
  return run(argv);
}
