#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { EXIT_ERROR, runCli } from './cli/run.js';

/** package.json sits one level above both src/cli.ts and dist/cli.js. */
function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

try {
  process.exitCode = await runCli(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    cwd: process.cwd(),
    version: packageVersion(),
  });
} catch (error) {
  process.stderr.write(`agent-pr-guard: internal error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = EXIT_ERROR;
}
