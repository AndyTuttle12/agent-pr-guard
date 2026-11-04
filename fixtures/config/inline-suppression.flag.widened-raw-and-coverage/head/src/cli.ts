import { run } from './run.js';

// eslint-disable-next-line no-console, no-process-exit
console.log('starting'); process.exit(run(process.argv.slice(2)));

/* c8 ignore next */
export const debug = process.env['DEBUG'] === '1';
