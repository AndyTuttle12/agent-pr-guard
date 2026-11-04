import { legacyHeader, summarize } from './format.js';

export function render(rows: string[]): string {
  const header = legacyHeader(rows);
  // @ts-ignore
  const footer: string = summarize(rows.length);
  return header + footer;
}
