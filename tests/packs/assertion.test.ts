import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/engine/config.js';
import { evaluate } from '../../src/engine/engine.js';
import { assertionPack } from '../../src/packs/assertion.js';
import { callArgs, isToleranceName, tolerancesIn } from '../../src/packs/tolerance.js';
import { describePackFixtures } from '../helpers/both-directions.js';
import { change, changeSet, modified, side } from '../helpers/changeset.js';

describePackFixtures(assertionPack);

function findings(files: Parameters<typeof changeSet>[0]): [string, string, number | null][] {
  return evaluate(changeSet(files), DEFAULT_CONFIG, [assertionPack]).findings.map((f) => [f.ruleId, f.file, f.line]);
}

describe('assertion pack', () => {
  it('ignores files that are not tests, and added or deleted test files', () => {
    expect(
      findings([
        modified('src/math.ts', 'assert(x);\nexpect(y).toBe(1);\n', 'export {};\n'),
        change(side('a.test.ts', 'expect(1).toBe(1);\n'), null),
        change(null, side('b.test.ts', 'expect(1).toBeDefined();\n')),
      ]),
    ).toEqual([]);
  });

  it('does not count assertions that only appear in strings', () => {
    expect(
      findings([modified('a.test.ts', 'it("calls expect(x)", () => { expect(x).toBe(1); });\n', 'it("calls it", () => { expect(x).toBe(1); });\n')]),
    ).toEqual([]);
  });

  it('anchors a removal at the hunk that lost the assertion', () => {
    const before = 'it("a", () => {\n  expect(a).toBe(1);\n  expect(b).toBe(2);\n});\n';
    const after = 'it("a", () => {\n  expect(a).toBe(1);\n});\n';
    expect(findings([modified('a.test.ts', before, after)])).toEqual([['assertion/removed', 'a.test.ts', 3]]);
  });

  it('reports a Go t.Errorf turned into t.Logf once, as loosened', () => {
    const before = 'func TestA(t *testing.T) {\n\tif got != 1 {\n\t\tt.Errorf("got %d", got)\n\t}\n}\n';
    const after = 'func TestA(t *testing.T) {\n\tif got != 1 {\n\t\tt.Logf("got %d", got)\n\t}\n}\n';
    expect(findings([modified('a_test.go', before, after)])).toEqual([['assertion/loosened', 'a_test.go', 3]]);
  });

  it('counts a chain broken after a bare expect only when the next line continues it', () => {
    const chained = 'it("a", async () => {\n  await expect\n    .poll(() => n)\n    .toBe(1);\n  expect(m).toBe(2);\n});\n';
    const kept = 'it("a", async () => {\n  expect(m).toBe(2);\n});\n';
    expect(findings([modified('a.test.ts', chained, kept)])).toEqual([['assertion/removed', 'a.test.ts', 2]]);
    const bare = 'function pick() {\n  return expect\n}\nexpect(m).toBe(2);\n';
    expect(findings([modified('a.test.ts', bare, 'function pick() {\n}\nexpect(m).toBe(2);\n')])).toEqual([]);
  });

  it('compares a renamed test file with its old content', () => {
    expect(
      findings([change(side('old/a.spec.js', 'expect(a).toEqual(1);\nexpect(b).toEqual(2);\n'), side('new/a.spec.js', 'expect(a).toEqual(1);\n'))]),
    ).toEqual([['assertion/removed', 'new/a.spec.js', 1]]);
  });

  it('counts assertions across test files, and reports the files that lost them when the total drops', () => {
    const report = evaluate(
      changeSet([
        modified('a.test.ts', 'expect(a).toBe(1);\nexpect(b).toBe(2);\nexpect(c).toBe(3);\n', 'expect(a).toBe(1);\n'),
        change(null, side('b.test.ts', 'expect(b).toBe(2);\n')),
      ]),
      DEFAULT_CONFIG,
      [assertionPack],
    );
    expect(report.findings.map((f) => [f.ruleId, f.file, f.severity, f.reason])).toEqual([
      ['assertion/removed', 'a.test.ts', 'error', '2 assertions removed (3 before, 1 after; 3 before and 2 after across the test files in the change)'],
    ]);
  });

  it('leaves a deleted test file to the deletion pack but counts it in the total', () => {
    expect(
      findings([
        change(side('gone.test.ts', 'expect(a).toBe(1);\n'), null),
        modified('kept.test.ts', 'expect(b).toBe(2);\nexpect(c).toBe(3);\n', 'expect(b).toBe(2);\nexpect(a).toBe(1);\nexpect(c).toBe(3);\n'),
      ]),
    ).toEqual([]);
    expect(
      findings([
        change(side('gone.test.ts', 'expect(a).toBe(1);\n'), null),
        modified('kept.test.ts', 'expect(b).toBe(2);\nexpect(c).toBe(3);\n', 'expect(b).toBe(2);\n'),
      ]),
    ).toEqual([['assertion/removed', 'kept.test.ts', 1]]);
  });

  it('keeps a removal an error when the whole-value check that arrived is about something else', () => {
    const before = 'expect(user.id).toBe(7);\nexpect(user.name).toBe("Ada");\n';
    const after = 'expect(order).toEqual({ id: 1 });\n';
    const report = evaluate(changeSet([modified('a.test.ts', before, after)]), DEFAULT_CONFIG, [assertionPack]);
    expect(report.findings.map((f) => [f.ruleId, f.severity])).toEqual([['assertion/removed', 'error']]);
  });

  it('keeps a removal an error when a weak check arrives in place of exact ones', () => {
    const before = 'expect(user.id).toBe(7);\nexpect(user.name).toBe("Ada");\n';
    const after = 'expect(user).toBeDefined();\n';
    const report = evaluate(changeSet([modified('a.test.ts', before, after)]), DEFAULT_CONFIG, [assertionPack]);
    expect(report.findings.map((f) => [f.ruleId, f.severity])).toEqual([
      ['assertion/loosened', 'error'],
      ['assertion/removed', 'error'],
    ]);
  });

  it('lets config mute a consolidation warning but never raises it to an error', () => {
    const before = 'expect(user.id).toBe(7);\nexpect(user.name).toBe("Ada");\n';
    const after = 'expect(user).toEqual({ id: 7, name: "Ada" });\n';
    const files = changeSet([modified('a.test.ts', before, after)]);
    const severities = (rules: Record<string, 'off' | 'warning' | 'error'>): string[] =>
      evaluate(files, { ...DEFAULT_CONFIG, rules }, [assertionPack]).findings.map((f) => f.severity);
    expect(severities({})).toEqual(['warning']);
    expect(severities({ 'assertion/removed': 'error' })).toEqual(['warning']);
    expect(severities({ 'assertion/removed': 'off' })).toEqual([]);
    expect(evaluate(files, DEFAULT_CONFIG, [assertionPack]).passed).toBe(true);
  });

  it('counts checks imported by name from the assert module, renamed or not', () => {
    const before = "import { equal as eq, ok } from 'node:assert';\neq(a, 1);\nok(b);\n";
    expect(findings([modified('a.test.ts', before, "import { equal as eq, ok } from 'node:assert';\neq(a, 1);\n")])).toEqual([
      ['assertion/removed', 'a.test.ts', 2],
    ]);
    expect(findings([modified('a.test.ts', before, "import { equal as eq, ok } from 'node:assert';\nok(a);\nok(b);\n")])).toEqual([
      ['assertion/loosened', 'a.test.ts', 2],
    ]);
  });

  it('reads assert.strict checks with their strength', () => {
    expect(findings([modified('a.test.ts', 'assert.strict.equal(a, 1);\n', 'assert.strict.ok(a);\n')])).toEqual([['assertion/loosened', 'a.test.ts', 1]]);
    expect(findings([modified('a.test.ts', 'assert.strict.ok(a);\n', 'assert.strict.deepEqual(a, [1]);\n')])).toEqual([]);
  });

  describe('a test file moved from expect to the assert module', () => {
    const port = (lines: string[]): string => `import assert from 'node:assert/strict';\n${lines.join('\n')}\n`;
    const vitest = (lines: string[]): string => `import { expect } from 'vitest';\n${lines.join('\n')}\n`;

    it('is judged across the file, so reordered checks are not paired line by line', () => {
      const before = vitest(['expect(a).toBe(true);', 'expect(b).toEqual([1]);', 'expect(c.length).toBeGreaterThan(0);']);
      const after = port(['assert.deepEqual(b, [1]);', 'assert.ok(c.length > 0);', 'assert.ok(a);']);
      expect(findings([modified('a.test.ts', before, after)])).toEqual([]);
    });

    it('flags exact checks replaced by weak ones, once, with the counts', () => {
      const before = vitest(['expect(a).toEqual(1);', 'expect(b).toEqual([1]);', 'expect(c).toBe(true);']);
      const after = port(['assert.equal(a, 1);', 'assert.ok(b.some((x) => x));', 'assert.ok(c);']);
      const report = evaluate(changeSet([modified('a.test.ts', before, after)]), DEFAULT_CONFIG, [assertionPack]);
      expect(report.findings.map((f) => [f.ruleId, f.line, f.reason])).toEqual([
        [
          'assertion/loosened',
          3,
          '1 exact check replaced by weaker ones when the file moved from expect to node:assert (2 exact and 1 weak before, 1 exact and 2 weak after)',
        ],
      ]);
    });

    it('leaves exact checks that were dropped, not replaced, to the removal rule', () => {
      const before = vitest(['expect(a).toEqual(1);', 'expect(b).toEqual(2);']);
      expect(findings([modified('a.test.ts', before, port(['assert.equal(a, 1);']))])).toEqual([['assertion/removed', 'a.test.ts', 1]]);
    });

    it('is not a port while expect remains on the head side, so hunks pair as before', () => {
      const before = vitest(['expect(a).toEqual(1);', 'expect(b).toBe(true);']);
      const after = port(['assert.ok(a);', 'expect(b).toBe(true);']);
      expect(findings([modified('a.test.ts', before, after)])).toEqual([['assertion/loosened', 'a.test.ts', 2]]);
    });
  });

  it('says what was replaced, removed or widened', () => {
    const report = evaluate(
      changeSet([
        modified('a.test.ts', 'expect(a).toEqual(1);\nexpect(b).toBe(2);\nconst tol = 1e-9;\n', 'expect(a).toBeDefined();\nconst tol = 0.1;\n'),
      ]),
      DEFAULT_CONFIG,
      [assertionPack],
    );
    expect(report.findings.map((f) => f.reason)).toEqual([
      'toEqual replaced by the weaker toBeDefined',
      '1 assertion removed (2 before, 1 after)',
      'tol widened from 1e-9 to 0.1',
    ]);
  });
});

describe('tolerancesIn', () => {
  const read = (line: string): [string, string, number][] => tolerancesIn(line).map((t) => [t.kind, t.label, t.value]);

  it('reads assignments, keyword arguments and positional arguments', () => {
    expect(read('const tol = 1e-9;')).toEqual([['tolerance', 'tol', 1e-9]]);
    expect(read('\tepsilon := 0.001')).toEqual([['tolerance', 'epsilon', 0.001]]);
    expect(read('TOLERANCE: float = 1_000.5')).toEqual([['tolerance', 'TOLERANCE', 1000.5]]);
    expect(read('np.testing.assert_allclose(a, b, rtol=1e-5, atol=0)')).toEqual([
      ['tolerance', 'rtol', 1e-5],
      ['tolerance', 'atol', 0],
    ]);
    expect(read('assert x == pytest.approx(0.3, rel=1e-6)')).toEqual([['tolerance', 'rel', 1e-6]]);
    expect(read('assert x == pytest.approx(0.3, 1e-6)')).toEqual([['tolerance', 'rel', 1e-6]]);
    expect(read('self.assertAlmostEqual(a, f(1, 2), 7)')).toEqual([['precision', 'places', 7]]);
    expect(read('self.assertAlmostEqual(a, b, places=7)')).toEqual([['precision', 'places', 7]]);
    expect(read('expect(sum(0.1, 0.2)).toBeCloseTo(0.3, 5);')).toEqual([['precision', 'toBeCloseTo digits', 5]]);
    expect(read('assert.InDelta(t, 1.0, got, 0.01)')).toEqual([['tolerance', 'delta', 0.01]]);
    expect(read('s.InEpsilon(1.0, got, 0.01)')).toEqual([['tolerance', 'epsilon', 0.01]]);
    expect(read('if math.Abs(got-want) > 1e-9 {')).toEqual([['tolerance', 'abs() bound', 1e-9]]);
  });

  it('leaves generic names alone outside an argument list, and ignores comparisons', () => {
    expect(read('const delta = 5;')).toEqual([]);
    expect(read('const places = 3;')).toEqual([]);
    expect(read('if tol == 1e-9 {')).toEqual([]);
    expect(read('const control = 1;')).toEqual([]);
  });

  it('recognises tolerance names', () => {
    for (const name of ['tol', 'rtol', 'abs_tol', 'rel_tol', 'TOLERANCE', 'eps', 'EPSILON', 'floatTolerance', 'maxEps']) {
      expect(isToleranceName(name), name).toBe(true);
    }
    for (const name of ['control', 'steps', 'stol', 'delta', 'total']) expect(isToleranceName(name), name).toBe(false);
  });

  it('splits call arguments at the top level only', () => {
    expect(callArgs('f(a, g(b, c), [d, e]) + 1', 2)).toEqual({ args: ['a', 'g(b, c)', '[d, e]'], end: 21 });
    expect(callArgs('f()', 2)).toEqual({ args: [], end: 3 });
    expect(callArgs('f(a, b', 2)).toEqual({ args: ['a', 'b'], end: -1 });
  });
});
