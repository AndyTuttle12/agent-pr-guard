/* eslint-disable no-console */
export function trace(message: string): void {
  console.log(message);
}
/* eslint-enable no-console */

export function report(lines: string[]): void {
  process.stdout.write(lines.join('\n'));
}
