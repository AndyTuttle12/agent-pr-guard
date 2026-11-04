import { legacyHeader, summarize } from './format.js';

export function render(rows: string[]): string {
  // @ts-ignore
  const header = legacyHeader(rows);
  return header;
}
