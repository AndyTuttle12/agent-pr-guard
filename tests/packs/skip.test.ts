import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/engine/config.js';
import { evaluate } from '../../src/engine/engine.js';
import { narrows, parseGoBuild, parsePlusBuild, type Constraint } from '../../src/packs/build-constraint.js';
import { skipPack } from '../../src/packs/skip.js';
import { describePackFixtures } from '../helpers/both-directions.js';
import { changeSet, modified } from '../helpers/changeset.js';

describePackFixtures(skipPack);

function findings(files: Parameters<typeof changeSet>[0]): [string, number | null, string][] {
  return evaluate(changeSet(files), DEFAULT_CONFIG, [skipPack]).findings.map((f) => [f.ruleId, f.line, f.reason]);
}

describe('skip pack', () => {
  it('counts a skip per file, so moving one is not new but adding a second is', () => {
    const before = 'it.skip("a", () => {});\nit("b", () => {});\n';
    const moved = 'it("b", () => {});\nit.skip("a", () => {});\n';
    const second = 'it.skip("b", () => {});\nit.skip("a", () => {});\n';
    expect(findings([modified('a.test.ts', before, moved)])).toEqual([]);
    expect(findings([modified('a.test.ts', before, second)])).toEqual([['skip/skipped', 1, 'it.skip added: the test no longer runs']]);
  });

  it('names the focus, the todo and the rename in its reasons', () => {
    expect(findings([modified('a.test.ts', 'it("x", () => {});\n', 'it.only("x", () => {});\n')])).toEqual([
      ['skip/focused', 1, 'it.only added: only focused tests run, so the others are skipped'],
    ]);
    expect(findings([modified('a.test.ts', 'it("parses", () => {});\n', 'it.todo("parses");\n')])).toEqual([
      ['skip/todo', 1, 'test "parses" turned into it.todo'],
    ]);
    expect(findings([modified('test_a.py', 'def test_x():\n    pass\n', 'def xtest_x():\n    pass\n')])).toEqual([
      ['skip/renamed-out', 1, 'test_x renamed to xtest_x, which the test runner does not collect'],
    ]);
  });

  describe('an environment fallback in a new test', () => {
    const base = 'def test_a():\n    assert a()\n';
    const fallback = '\n\ndef test_b():\n    if not have_db():\n        pytest.skip("no db")\n    assert b()\n';

    it('passes a skip under an if in a test the base did not have', () => {
      expect(findings([modified('test_x.py', base, base + fallback)])).toEqual([]);
    });

    it('flags it when a base test is gone, since the new test may be that one renamed', () => {
      const renamed = base.replace('test_a', 'test_a2') + fallback;
      expect(findings([modified('test_x.py', base, renamed)])).toEqual([['skip/skipped', 7, 'pytest.skip added: the test no longer runs']]);
    });

    it('flags a constant condition and a skipif with only a reason', () => {
      const always = base + fallback.replace('if not have_db():', 'if True:');
      const reasonOnly = `${base}\n\n@pytest.mark.skipif(reason="later")\ndef test_b():\n    assert b()\n`;
      expect(findings([modified('test_x.py', base, always)]).map((f) => f[1])).toEqual([7]);
      expect(findings([modified('test_x.py', base, reasonOnly)]).map((f) => f[1])).toEqual([5]);
    });

    it('flags a conditional skip in a new helper outside any test', () => {
      const helper = '\n\ndef need_db():\n    if not have_db():\n        pytest.skip("no db")\n';
      expect(findings([modified('test_x.py', base, base + helper)]).map((f) => f[1])).toEqual([7]);
    });
  });

  it('ignores markers in files that are not tests', () => {
    expect(findings([modified('src/a.ts', 'run();\n', 'it.only("x", () => {});\n')])).toEqual([]);
  });
});

describe('build constraints', () => {
  const go = (text: string): Constraint => {
    const parsed = parseGoBuild(text);
    if (parsed === null) throw new Error(`unparsable: ${text}`);
    return parsed;
  };
  const always: Constraint = { kind: 'true' };

  it('parses //go:build expressions and rejects malformed ones', () => {
    expect(parseGoBuild('linux && (amd64 || arm64) && !cgo')).not.toBeNull();
    expect(parseGoBuild('linux &&')).toBeNull();
    expect(parseGoBuild('(linux')).toBeNull();
    expect(parseGoBuild('linux darwin')).toBeNull();
  });

  it('reads // +build lines as or-ed options of and-ed terms', () => {
    expect(narrows(parsePlusBuild('linux,amd64 darwin'), go('(linux && amd64) || darwin'), 'a', 'b')).toBe(false);
    expect(narrows(go('(linux && amd64) || darwin'), parsePlusBuild('linux,amd64 darwin'), 'a', 'b')).toBe(false);
  });

  it('flags a narrower constraint and passes a wider or equivalent one', () => {
    expect(narrows(always, go('integration'), '', 'integration')).toBe(true);
    expect(narrows(go('linux || darwin'), go('linux'), 'a', 'b')).toBe(true);
    expect(narrows(go('linux'), go('linux || darwin'), 'a', 'b')).toBe(false);
    expect(narrows(go('integration'), always, 'a', '')).toBe(false);
    // Two GOOS values never hold at once, so `!windows` adds nothing to `linux`.
    expect(narrows(go('linux'), go('linux && !windows'), 'a', 'b')).toBe(false);
  });
});
