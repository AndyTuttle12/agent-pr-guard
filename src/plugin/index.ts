import { main } from './guard.js';

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  const message = `agent-pr-guard: internal error: ${error instanceof Error ? error.message : String(error)}. The stop check did not run.`;
  if (process.argv[2] === 'stop') {
    process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`);
    process.exitCode = 0;
  } else {
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
  }
}
