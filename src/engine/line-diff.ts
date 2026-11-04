export interface DiffLine {
  /** 1-based line number on its own side. */
  readonly line: number;
  readonly text: string;
}

/**
 * One contiguous change. `newStart` is where the hunk sits in the new file: the line of its first
 * added line, or, for a pure deletion, the line that now follows the deleted block (which can be
 * one past the last line). `oldStart` is the same on the old side.
 */
export interface Hunk {
  readonly oldStart: number;
  readonly newStart: number;
  readonly removed: readonly DiffLine[];
  readonly added: readonly DiffLine[];
}

/** Above this edit distance the middle of the file is reported as one replaced block. */
export const MAX_EDIT_DISTANCE = 2000;

/** Splits text into lines without their terminators; a final newline does not add a line. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/** Line diff (Myers, minimal edit script) after trimming the common prefix and suffix. */
export function diffLines(a: readonly string[], b: readonly string[]): Hunk[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }
  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);
  if (midA.length === 0 && midB.length === 0) return [];

  const ids = new Map<string, number>();
  const intern = (line: string): number => {
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    return id;
  };
  const ops = myers(Int32Array.from(midA, intern), Int32Array.from(midB, intern));
  return toHunks(ops ?? replaceAll(midA.length, midB.length), a, b, prefix);
}

/** 0 = keep, 1 = delete from a, 2 = insert from b. */
type Op = 0 | 1 | 2;

function replaceAll(n: number, m: number): Op[] {
  return [...new Array<Op>(n).fill(1), ...new Array<Op>(m).fill(2)];
}

function myers(a: Int32Array, b: Int32Array): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found === -1; d++) {
    // Snapshot of v as it stood after round d-1, for k in [-(d+1), d+1].
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0));
      let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found === -1) return null;

  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const snap = trace[d];
    if (snap === undefined) throw new Error('diff trace missing');
    const at = (k: number): number => snap[k + d + 1] ?? 0;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push(0);
      x--;
      y--;
    }
    ops.push(x === prevX ? 2 : 1);
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push(0);
    x--;
    y--;
  }
  return ops.reverse();
}

function toHunks(ops: readonly Op[], a: readonly string[], b: readonly string[], prefix: number): Hunk[] {
  const hunks: Hunk[] = [];
  let ai = prefix;
  let bi = prefix;
  let current: { oldStart: number; newStart: number; removed: DiffLine[]; added: DiffLine[] } | null = null;
  for (const op of ops) {
    if (op === 0) {
      if (current !== null) hunks.push(current);
      current = null;
      ai++;
      bi++;
      continue;
    }
    current ??= { oldStart: ai + 1, newStart: bi + 1, removed: [], added: [] };
    if (op === 1) {
      current.removed.push({ line: ai + 1, text: a[ai] ?? '' });
      ai++;
    } else {
      current.added.push({ line: bi + 1, text: b[bi] ?? '' });
      bi++;
    }
  }
  if (current !== null) hunks.push(current);
  return hunks;
}

/** The head-side line a finding about this hunk should point at, or null for an empty file. */
export function anchorLine(hunk: Hunk, newLineCount: number): number | null {
  if (newLineCount === 0) return null;
  return Math.min(hunk.added[0]?.line ?? hunk.newStart, newLineCount);
}
