import { describe, expect, it } from 'vitest';
import { analysisContext, analyzeChangeSet } from '../../src/engine/analyze.js';
import { DEFAULT_CONFIG, parseGuardConfig } from '../../src/engine/config.js';
import { buildRegistry, evaluate, type RulePack } from '../../src/engine/engine.js';
import { enginePack } from '../../src/packs/engine.js';
import { change, changeSet, modified, side } from '../helpers/changeset.js';

const everyFile: RulePack = {
  id: 'demo',
  rules: [
    { id: 'demo/touched', summary: 'any file' },
    { id: 'demo/locked', summary: 'locked', locked: true },
  ],
  check: ({ files }) =>
    files.flatMap((f) => [
      { ruleId: 'demo/touched', file: f.path, line: 1, reason: 'touched' },
      { ruleId: 'demo/locked', file: f.path, line: null, reason: 'locked' },
    ]),
};

describe('analyzeChangeSet', () => {
  it('builds masked views, hunks and test flags for both sides', () => {
    const [file] = analyzeChangeSet(
      changeSet([modified('src/a.test.ts', 'it("a", () => {}); // x\n', 'it.skip("a", () => {});\n')]),
      analysisContext(DEFAULT_CONFIG),
    );
    expect(file).toMatchObject({ path: 'src/a.test.ts', oldIsTest: true, newIsTest: true, uninspected: null, ignored: false });
    expect(file?.old?.code).toEqual(['it(" ", () => {});     ']);
    expect(file?.new?.language).toBe('js');
    expect(file?.hunks).toHaveLength(1);
  });

  it('pairs one deleted and one added test file with the same name as a move', () => {
    const files = analyzeChangeSet(
      changeSet([
        change(side('old/a.test.ts', 'it("a", () => { expect(1).toBe(1); });\n'), null),
        change(null, side('new/a.test.ts', 'completely different\n')),
        change(null, side('new/b.test.ts', 'x\n')),
      ]),
      analysisContext(DEFAULT_CONFIG),
    );
    expect(files.map((f) => [f.path, f.change.status, f.pairedMove])).toEqual([
      ['new/a.test.ts', 'renamed', true],
      ['new/b.test.ts', 'added', false],
    ]);
    expect(files[0]?.oldPath).toBe('old/a.test.ts');
  });

  it('does not pair when the name is ambiguous', () => {
    const files = analyzeChangeSet(
      changeSet([
        change(side('a/x.test.ts', '1\n'), null),
        change(side('b/x.test.ts', '2\n'), null),
        change(null, side('c/x.test.ts', '3\n')),
      ]),
      analysisContext(DEFAULT_CONFIG),
    );
    expect(files.map((f) => f.change.status)).toEqual(['deleted', 'deleted', 'added']);
  });

  it('marks ignored paths and unreadable sides', () => {
    const config = parseGuardConfig('{"ignorePaths": ["vendor/"]}', 'cfg', buildRegistry([]));
    const files = analyzeChangeSet(
      changeSet([modified('vendor/x.js', 'a\n', 'b\n'), change(side('big.test.ts', null, 'too-large'), side('big.test.ts', null, 'too-large'))]),
      analysisContext(config),
    );
    expect(files.map((f) => [f.path, f.ignored, f.uninspected])).toEqual([
      ['vendor/x.js', true, null],
      ['big.test.ts', false, 'too-large'],
    ]);
  });
});

describe('evaluate', () => {
  it('applies severities, drops rules turned off, and keeps locked rules at error', () => {
    const registry = buildRegistry([everyFile]);
    const config = parseGuardConfig('{"rules": {"demo/touched": "warning"}}', 'cfg', registry);
    const report = evaluate(changeSet([modified('b.txt', '1\n', '2\n'), modified('a.txt', '1\n', '2\n')]), config, [everyFile]);
    expect(report.findings.map((f) => [f.file, f.ruleId, f.severity])).toEqual([
      ['a.txt', 'demo/locked', 'error'],
      ['a.txt', 'demo/touched', 'warning'],
      ['b.txt', 'demo/locked', 'error'],
      ['b.txt', 'demo/touched', 'warning'],
    ]);
    expect(report).toMatchObject({ errors: 2, warnings: 2, passed: false });
    const off = evaluate(changeSet([modified('a.txt', '1\n', '2\n')]), { ...config, rules: { 'demo/touched': 'off' } }, [everyFile]);
    expect(off.findings.map((f) => f.ruleId)).toEqual(['demo/locked']);
  });

  it('caps a hit at the severity it carries, but never above off or below a locked rule', () => {
    const capped: RulePack = {
      ...everyFile,
      check: ({ files }) =>
        files.flatMap((f) => [
          { ruleId: 'demo/touched', file: f.path, line: 1, reason: 'touched', severity: 'warning' as const },
          { ruleId: 'demo/locked', file: f.path, line: null, reason: 'locked', severity: 'warning' as const },
        ]),
    };
    const cs = changeSet([modified('a.txt', '1\n', '2\n')]);
    const report = evaluate(cs, DEFAULT_CONFIG, [capped]);
    expect(report.findings.map((f) => [f.ruleId, f.severity])).toEqual([
      ['demo/locked', 'error'],
      ['demo/touched', 'warning'],
    ]);
    const off = evaluate(cs, { ...DEFAULT_CONFIG, rules: { demo: 'off' } }, [capped]);
    expect(off.findings.map((f) => f.ruleId)).toEqual(['demo/locked']);
  });

  it('reports a hit repeated with the same rule, file, line and reason once, at its highest severity', () => {
    const repeats: RulePack = {
      ...everyFile,
      check: ({ files }) =>
        files.flatMap((f) => [
          { ruleId: 'demo/touched', file: f.path, line: 57, reason: "'|| true' swallows a failure of pytest", severity: 'warning' as const },
          { ruleId: 'demo/touched', file: f.path, line: 57, reason: "'|| true' swallows a failure of pytest" },
          { ruleId: 'demo/touched', file: f.path, line: 57, reason: "'|| true' swallows a failure of pytest" },
          { ruleId: 'demo/touched', file: f.path, line: 58, reason: "'|| true' swallows a failure of pytest" },
          { ruleId: 'demo/touched', file: f.path, line: 57, reason: "'|| true' swallows a failure of ruff" },
        ]),
    };
    const report = evaluate(changeSet([modified('Makefile', '1\n', '2\n')]), DEFAULT_CONFIG, [repeats]);
    expect(report.findings.map((f) => [f.line, f.reason, f.severity])).toEqual([
      [57, "'|| true' swallows a failure of pytest", 'error'],
      [57, "'|| true' swallows a failure of ruff", 'error'],
      [58, "'|| true' swallows a failure of pytest", 'error'],
    ]);
    expect(report).toMatchObject({ errors: 3, warnings: 0 });
  });

  it('uses a rule default severity when config names neither the rule nor its pack', () => {
    const warns: RulePack = { ...everyFile, rules: [{ id: 'demo/touched', summary: 'any file', defaultSeverity: 'warning' }, { id: 'demo/locked', summary: 'locked', locked: true }] };
    const cs = changeSet([modified('a.txt', '1\n', '2\n')]);
    const severities = (config: typeof DEFAULT_CONFIG) => evaluate(cs, config, [warns]).findings.map((f) => [f.ruleId, f.severity]);
    expect(severities(DEFAULT_CONFIG)).toEqual([
      ['demo/locked', 'error'],
      ['demo/touched', 'warning'],
    ]);
    expect(severities({ ...DEFAULT_CONFIG, rules: { demo: 'error' } })).toContainEqual(['demo/touched', 'error']);
  });

  it('hides ignored files from packs unless the pack sees them', () => {
    const config = parseGuardConfig('{"ignorePaths": ["*.txt"]}', 'cfg', buildRegistry([]));
    const cs = changeSet([modified('a.txt', '1\n', '2\n')]);
    expect(evaluate(cs, config, [everyFile]).findings).toEqual([]);
    expect(evaluate(cs, config, [{ ...everyFile, seesIgnoredFiles: true }]).findings).toHaveLength(2);
  });

  it('passes with no findings and rejects a pack reporting a rule it does not declare', () => {
    expect(evaluate(changeSet([]), DEFAULT_CONFIG, [everyFile])).toMatchObject({ findings: [], passed: true, errors: 0 });
    const rogue: RulePack = { id: 'rogue', rules: [], check: () => [{ ruleId: 'rogue/x', file: 'a', line: null, reason: 'r' }] };
    expect(() => evaluate(changeSet([modified('a', '1\n', '2\n')]), DEFAULT_CONFIG, [rogue])).toThrow(/unknown rule/);
  });

  it('rejects duplicate or misnamed rules in the registry', () => {
    expect(() => buildRegistry([everyFile, everyFile])).toThrow(/duplicate pack/);
    expect(() => buildRegistry([{ ...everyFile, id: 'other' }])).toThrow(/not in pack/);
    const lockedWarning: RulePack = { ...everyFile, rules: [{ id: 'demo/locked', summary: 'locked', locked: true, defaultSeverity: 'warning' }] };
    expect(() => buildRegistry([lockedWarning])).toThrow(/must default to error/);
  });
});

describe('engine pack', () => {
  it('reports a test file it could not read, and nothing for other unreadable files', () => {
    const report = evaluate(
      changeSet([
        change(side('a.test.ts', 'x\n'), side('a.test.ts', null, 'too-large')),
        change(null, side('b_test.go', null, 'binary')),
        change(side('logo.png', null, 'binary'), side('logo.png', null, 'binary')),
      ]),
      DEFAULT_CONFIG,
      [enginePack],
    );
    expect(report.findings.map((f) => [f.ruleId, f.file, f.reason])).toEqual([
      ['engine/uninspected', 'a.test.ts', 'test file is larger than the read limit, so its content was not checked'],
      ['engine/uninspected', 'b_test.go', 'test file is binary, so its content was not checked'],
    ]);
  });
});
