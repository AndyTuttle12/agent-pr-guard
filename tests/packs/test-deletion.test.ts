import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/engine/config.js';
import { evaluate } from '../../src/engine/engine.js';
import { testSubject } from '../../src/engine/test-files.js';
import { testDeletionPack } from '../../src/packs/test-deletion.js';
import { change, changeSet, side } from '../helpers/changeset.js';
import { describeFixtures } from './fixture-suite.js';

describeFixtures('test-deletion', testDeletionPack);

describe('test-deletion pack', () => {
  it('judges paths, so an unreadable deleted test file is still reported', () => {
    const report = evaluate(changeSet([change(side('a.test.ts', null, 'too-large'), null)]), DEFAULT_CONFIG, [testDeletionPack]);
    expect(report.findings.map((f) => [f.ruleId, f.file, f.reason])).toEqual([
      ['test-deletion/deleted', 'a.test.ts', 'test file a.test.ts was deleted'],
    ]);
  });

  describe('a file whose base side holds no tests', () => {
    const deleted = (path: string, text: string): [string, string | undefined][] =>
      evaluate(changeSet([change(side(path, text), null)]), DEFAULT_CONFIG, [testDeletionPack]).findings.map((f) => [f.severity, f.reason]);

    it('warns, since only its name matched', () => {
      expect(deleted('test_scratch.py', 'import numpy as np\nprint(np.arange(3))\n')).toEqual([
        ['warning', 'test file test_scratch.py was deleted, but it defined no tests, so only its name matched the test patterns'],
      ]);
      expect(deleted('pkg/helpers_test.go', 'package pkg\n\nfunc helper() int { return 1 }\n')[0]?.[0]).toBe('warning');
    });

    it('stays an error with a test, a test class or a test framework import', () => {
      for (const [path, text] of [
        ['test_a.py', 'def test_a():\n    assert True\n'],
        ['test_a.py', 'class TestA:\n    pass\n'],
        ['test_a.py', 'class Checks(unittest.TestCase):\n    pass\n'],
        ['test_a.py', 'import pytest\n'],
        ['a.test.ts', "import { expect } from 'vitest';\n"],
        ['a.test.ts', 'test.each([1])("n %s", () => {});\n'],
        ['a_test.go', 'package a\n\nimport "testing"\n'],
        ['a_test.go', 'package a\n\nvar _ = Describe("a", func() {})\n'],
      ] as const) {
        expect(deleted(path, text), `${path}: ${text}`).toEqual([['error', `test file ${path} was deleted`]]);
      }
    });

    it('does not count a test that is only in a comment or a string', () => {
      expect(deleted('test_a.py', '# def test_a():\nDOC = "def test_b():"\n')[0]?.[0]).toBe('warning');
    });

    it('warns on a move out of the patterns too', () => {
      const report = evaluate(
        changeSet([change(side('test_scratch.py', 'print(1)\n'), side('scratch.py', 'print(1)\n'))]),
        DEFAULT_CONFIG,
        [testDeletionPack],
      );
      expect(report.findings.map((f) => [f.ruleId, f.severity])).toEqual([['test-deletion/moved-out', 'warning']]);
    });
  });

  it('does not pair an ambiguous delete and add, so both deletions are reported', () => {
    const report = evaluate(
      changeSet([
        change(side('a/x.test.ts', '1\n'), null),
        change(side('b/x.test.ts', '2\n'), null),
        change(null, side('c/x.test.ts', '3\n')),
      ]),
      DEFAULT_CONFIG,
      [testDeletionPack],
    );
    expect(report.findings.map((f) => f.file)).toEqual(['a/x.test.ts', 'b/x.test.ts']);
  });
});

describe('testSubject', () => {
  it.each([
    ['src/math.test.ts', 'math'],
    ['src/ui/button.spec.tsx', 'button'],
    ['lib/parse.test.mjs', 'parse'],
    ['src/__tests__/store.ts', 'store'],
    ['test/server.js', 'server'],
    ['tests/test_api.py', 'api'],
    ['pkg/api_test.py', 'api'],
    ['calc/calc_test.go', 'calc'],
  ])('names the subject of %s', (path, stem) => {
    expect(testSubject(path)?.stem).toBe(stem);
  });

  it.each(['app/tests.py', 'e2e/login.e2e.ts', 'src/math.test.ts.disabled', 'docs/test_plan.md'])('names none for %s', (path) => {
    expect(testSubject(path)).toBeNull();
  });

  it('only pairs a subject in the same language', () => {
    const report = evaluate(
      changeSet([change(side('src/math.test.ts', 'it("adds", () => {});\n'), null), change(side('src/math.py', 'x\n'), null)]),
      DEFAULT_CONFIG,
      [testDeletionPack],
    );
    expect(report.findings.map((f) => f.severity)).toEqual(['error']);
  });
});
