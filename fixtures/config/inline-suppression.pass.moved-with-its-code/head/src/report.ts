import { legacyHeader, summarize } from './format.js';

export function render(rows: string[]): string {
  const footer = summarize(rows.length);
  // @ts-ignore

  // legacyHeader predates the Row type.
  const header = legacyHeader(rows);
  return header + footer;
}
