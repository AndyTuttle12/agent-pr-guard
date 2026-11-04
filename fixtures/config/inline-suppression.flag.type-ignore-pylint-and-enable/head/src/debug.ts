/* eslint-disable no-console */
export function trace(message: string): void {
  console.log(message);
}

export function report(lines: string[]): void {
  console.log(lines.join('\n'));
}
