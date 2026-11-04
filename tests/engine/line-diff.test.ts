import { describe, expect, it } from 'vitest';
import { anchorLine, diffLines, splitLines, type Hunk } from '../../src/engine/line-diff.js';

function apply(a: readonly string[], hunks: readonly Hunk[]): string[] {
  const out: string[] = [];
  let ai = 1;
  for (const hunk of hunks) {
    while (ai < hunk.oldStart) out.push(a[ai++ - 1] ?? '');
    for (const removed of hunk.removed) {
      expect(removed.text).toBe(a[removed.line - 1]);
      ai++;
    }
    for (const added of hunk.added) out.push(added.text);
  }
  while (ai <= a.length) out.push(a[ai++ - 1] ?? '');
  return out;
}

function lcsLength(a: readonly string[], b: readonly string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  return dp[a.length]![b.length]!;
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe('splitLines', () => {
  it('drops the final newline and carriage returns', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a\r\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\n\n')).toEqual(['a', '']);
    expect(splitLines('a')).toEqual(['a']);
  });
});

describe('diffLines', () => {
  it('reports a replaced line as one hunk with both line numbers', () => {
    const hunks = diffLines(['a', 'b', 'c'], ['a', 'B', 'c']);
    expect(hunks).toEqual([{ oldStart: 2, newStart: 2, removed: [{ line: 2, text: 'b' }], added: [{ line: 2, text: 'B' }] }]);
  });

  it('places a pure deletion at the line that follows it', () => {
    const hunks = diffLines(['a', 'b', 'c'], ['a', 'c']);
    expect(hunks).toEqual([{ oldStart: 2, newStart: 2, removed: [{ line: 2, text: 'b' }], added: [] }]);
    expect(anchorLine(hunks[0]!, 2)).toBe(2);
    const atEnd = diffLines(['a', 'b'], ['a']);
    expect(anchorLine(atEnd[0]!, 1)).toBe(1);
    expect(anchorLine(diffLines(['a'], [])[0]!, 0)).toBeNull();
  });

  it('treats an absent side as empty', () => {
    expect(diffLines([], ['x', 'y'])).toEqual([
      { oldStart: 1, newStart: 1, removed: [], added: [{ line: 1, text: 'x' }, { line: 2, text: 'y' }] },
    ]);
    expect(diffLines([], [])).toEqual([]);
  });

  it('produces a minimal edit script that rebuilds the new side (random cases)', () => {
    const rand = seeded(42);
    for (let round = 0; round < 300; round++) {
      const alphabet = ['a', 'b', 'c', 'd'];
      const gen = (): string[] =>
        Array.from({ length: Math.floor(rand() * 14) }, () => alphabet[Math.floor(rand() * alphabet.length)]!);
      const a = gen();
      const b = gen();
      const hunks = diffLines(a, b);
      expect(apply(a, hunks)).toEqual(b);
      const edits = hunks.reduce((sum, h) => sum + h.removed.length + h.added.length, 0);
      expect(edits).toBe(a.length + b.length - 2 * lcsLength(a, b));
    }
  });

  it('falls back to one replaced block when the edit distance is too large', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `old ${i}`);
    const b = Array.from({ length: 3000 }, (_, i) => `new ${i}`);
    const hunks = diffLines(['same', ...a, 'end'], ['same', ...b, 'end']);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.removed).toHaveLength(3000);
    expect(hunks[0]!.added).toHaveLength(3000);
    expect(hunks[0]!.newStart).toBe(2);
  });
});
