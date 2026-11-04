import { run } from './run.js';

export function main(argv: string[]): number {
  return run(argv);
}

/* c8 ignore next */
export const debug = process.env['DEBUG'] === '1';
