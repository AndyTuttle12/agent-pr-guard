import type { AnalyzedFile, SideView } from '../engine/analyze.js';
import type { Hunk } from '../engine/line-diff.js';

/**
 * One thing a rule looks for on a line. `re` must carry the `g` flag. `name` labels the match in
 * findings; without it the label is the matched text, compacted (`.toBeDefined(` → `toBeDefined`).
 */
export interface Pattern<T extends string> {
  readonly tag: T;
  readonly re: RegExp;
  readonly name?: string;
}

export interface LineMatch<T extends string> {
  readonly tag: T;
  readonly name: string;
  readonly index: number;
}

/**
 * Every match of `patterns` on one line, in column order. Patterns run in list order and each
 * match is blanked before the next pattern runs, so one span of text matches at most once and an
 * earlier, more specific pattern wins over a later, broader one.
 */
export function scanLine<T extends string>(line: string, patterns: readonly Pattern<T>[]): LineMatch<T>[] {
  const out: LineMatch<T>[] = [];
  let rest = line;
  for (const pattern of patterns) {
    pattern.re.lastIndex = 0;
    let blanked = rest;
    for (const match of rest.matchAll(pattern.re)) {
      const text = match[0];
      if (text === '') continue;
      out.push({ tag: pattern.tag, name: pattern.name ?? compact(text), index: match.index });
      blanked = blanked.slice(0, match.index) + ' '.repeat(text.length) + blanked.slice(match.index + text.length);
    }
    rest = blanked;
  }
  return out.sort((a, b) => a.index - b.index);
}

function compact(text: string): string {
  return text.replace(/\s+/g, '').replace(/^\./, '').replace(/\($/, '');
}

/** How many matches carry each tag, over every line. */
export function countTags<T extends string>(lines: readonly string[], patterns: readonly Pattern<T>[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const line of lines) {
    for (const match of scanLine(line, patterns)) counts.set(match.tag, (counts.get(match.tag) ?? 0) + 1);
  }
  return counts;
}

export interface SideLine {
  /** 1-based line number on its side. */
  readonly line: number;
  readonly text: string;
}

/** A hunk's removed and added lines, taken from one view of each side. */
export function hunkLines(
  hunk: Hunk,
  file: AnalyzedFile,
  view: (side: SideView) => readonly string[],
): { removed: SideLine[]; added: SideLine[] } {
  const oldView = file.old === null ? [] : view(file.old);
  const newView = file.new === null ? [] : view(file.new);
  return {
    removed: hunk.removed.map((l) => ({ line: l.line, text: oldView[l.line - 1] ?? '' })),
    added: hunk.added.map((l) => ({ line: l.line, text: newView[l.line - 1] ?? '' })),
  };
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
