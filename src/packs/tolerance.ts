/**
 * Numeric tolerances in test code, read from one line of the code view. A `tolerance` is
 * looser when it grows (`rtol=1e-6` → `1e-2`); a `precision` is looser when it shrinks
 * (`toBeCloseTo(x, 5)` → `toBeCloseTo(x, 1)`, `places=7` → `places=2`).
 */
export type ToleranceKind = 'tolerance' | 'precision';

export interface Tolerance {
  readonly kind: ToleranceKind;
  /** What the number sets, for pairing and for the finding (`rtol`, `places`, `epsilon`). */
  readonly label: string;
  readonly value: number;
  /** The number as written. */
  readonly text: string;
}

const NUM = String.raw`[-+]?(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][-+]?\d+)?`;
const NUM_ONLY = new RegExp(`^${NUM}$`);

/** `name = 1e-6`, `name := 1e-6`, `name: 1e-6`, `name: float = 1e-6`, `const name float64 = 1e-6`. */
const ASSIGNED = new RegExp(String.raw`[\s\w.:\[\]]{0,30}?(?::=|=(?!=)|:)\s*(${NUM})(?![\w.])`, 'y');

/** Keyword arguments whose names are too generic to trust outside an argument list. */
const KEYWORD = new RegExp(String.raw`[(,]\s*(abs|rel|delta|places|decimal|digits)\s*=(?!=)\s*(${NUM})(?![\w.])`, 'g');

const KEYWORD_KIND: Readonly<Record<string, ToleranceKind>> = {
  abs: 'tolerance',
  rel: 'tolerance',
  delta: 'tolerance',
  places: 'precision',
  decimal: 'precision',
  digits: 'precision',
};

/** Calls whose tolerance is a positional argument: argument index → what it sets. */
const POSITIONAL: Readonly<Record<string, Readonly<Record<number, readonly [ToleranceKind, string]>>>> = {
  toBeCloseTo: { 1: ['precision', 'toBeCloseTo digits'] },
  assertAlmostEqual: { 2: ['precision', 'places'] },
  assertAlmostEquals: { 2: ['precision', 'places'] },
  failUnlessAlmostEqual: { 2: ['precision', 'places'] },
  assert_almost_equal: { 2: ['precision', 'decimal'] },
  assert_array_almost_equal: { 2: ['precision', 'decimal'] },
  assert_allclose: { 2: ['tolerance', 'rtol'], 3: ['tolerance', 'atol'] },
  allclose: { 2: ['tolerance', 'rtol'], 3: ['tolerance', 'atol'] },
  isclose: { 2: ['tolerance', 'rtol'], 3: ['tolerance', 'atol'] },
  approx: { 1: ['tolerance', 'rel'], 2: ['tolerance', 'abs'] },
};

/** testify: `assert.InDelta(t, expected, actual, delta)`, or without `t` on a suite. */
const TESTIFY_DELTA: Readonly<Record<string, string>> = {
  InDelta: 'delta',
  InDeltaSlice: 'delta',
  InDeltaMapValues: 'delta',
  InEpsilon: 'epsilon',
  InEpsilonSlice: 'epsilon',
};

const CALL = new RegExp(String.raw`(?<![\w$])(${[...Object.keys(POSITIONAL), ...Object.keys(TESTIFY_DELTA)].join('|')})\s*\(`, 'g');
const ABS_CALL = /(?<![\w$])(?:abs|fabs|Abs)\s*\(/g;
const ABS_BOUND = new RegExp(String.raw`\s*[<>]=?\s*(${NUM})(?![\w.])`, 'y');

export function tolerancesIn(line: string): Tolerance[] {
  const out: Tolerance[] = [];
  const push = (kind: ToleranceKind, label: string, text: string): void => {
    const value = Number(text.replace(/_/g, ''));
    if (Number.isFinite(value)) out.push({ kind, label, value, text });
  };

  for (const m of line.matchAll(/\b[A-Za-z_]\w*/g)) {
    if (!isToleranceName(m[0])) continue;
    ASSIGNED.lastIndex = m.index + m[0].length;
    const assigned = ASSIGNED.exec(line);
    if (assigned?.[1] !== undefined) push('tolerance', m[0], assigned[1]);
  }

  for (const m of line.matchAll(KEYWORD)) {
    const name = m[1] ?? '';
    const kind = KEYWORD_KIND[name];
    if (kind !== undefined && m[2] !== undefined) push(kind, name, m[2]);
  }

  for (const m of line.matchAll(CALL)) {
    const name = m[1] ?? '';
    const { args } = callArgs(line, m.index + m[0].length);
    const delta = TESTIFY_DELTA[name];
    const slots: Readonly<Record<number, readonly [ToleranceKind, string]>> =
      delta !== undefined ? { [/^(?:t|b|tb|f)$/.test(args[0] ?? '') ? 3 : 2]: ['tolerance', delta] } : (POSITIONAL[name] ?? {});
    for (const [index, [kind, label]] of Object.entries(slots)) {
      const arg = args[Number(index)];
      if (arg !== undefined && NUM_ONLY.test(arg)) push(kind, label, arg);
    }
  }

  for (const m of line.matchAll(ABS_CALL)) {
    const { end } = callArgs(line, m.index + m[0].length);
    if (end === -1) continue;
    ABS_BOUND.lastIndex = end;
    const bound = ABS_BOUND.exec(line);
    if (bound?.[1] !== undefined) push('tolerance', 'abs() bound', bound[1]);
  }
  return out;
}

/** `tol`, `rtol`, `abs_tol`, `TOLERANCE`, `epsilon`, `eps`, `floatTolerance`, `maxEps`. */
export function isToleranceName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    /(?:^|_)(?:a|r|abs_|rel_)?tol(?:erance)?$/.test(lower) ||
    /(?:^|_)eps(?:ilon)?$/.test(lower) ||
    /[a-z0-9](?:Tol|Tolerance|Eps|Epsilon)$/.test(name)
  );
}

/**
 * Top-level arguments of a call whose `(` ends just before `start`, trimmed, and the index just
 * after its closing `)` (-1 when the call does not close on this line).
 */
export function callArgs(line: string, start: number): { args: string[]; end: number } {
  const args: string[] = [];
  let depth = 0;
  let from = start;
  for (let i = start; i < line.length; i++) {
    const ch = line[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) {
        const last = line.slice(from, i).trim();
        if (last !== '' || args.length > 0) args.push(last);
        return { args, end: i + 1 };
      }
      depth--;
    } else if (ch === ',' && depth === 0) {
      args.push(line.slice(from, i).trim());
      from = i + 1;
    }
  }
  args.push(line.slice(from).trim());
  return { args, end: -1 };
}
