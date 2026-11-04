/* eslint-disable no-console */
export function trace(message: string): void {
  console.log(`[trace] ${message}`);
}
/* eslint-enable */

export function report(lines: string[]): void {
  process.stdout.write(lines.join('\n'));
}
