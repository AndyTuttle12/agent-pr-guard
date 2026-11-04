import { describe, expect, it } from 'vitest';
import type { FileChange } from '../../src/changeset.js';
import { ConfigError, DEFAULT_CONFIG, GUARD_CONFIG_PATH, parseGuardConfig, type GuardConfig } from '../../src/engine/config.js';
import { buildRegistry, evaluate } from '../../src/engine/engine.js';
import { ALL_PACKS } from '../../src/packs/index.js';
import { protectedPack } from '../../src/packs/protected.js';
import { change, changeSet, modified, side } from '../helpers/changeset.js';
import { describeFixtures } from './fixture-suite.js';

describeFixtures('protected', protectedPack);

const GOLDEN: GuardConfig = { ...DEFAULT_CONFIG, protectedPaths: ['fixtures/golden/'] };

function run(files: readonly FileChange[], config: GuardConfig = GOLDEN): [string, string, string][] {
  return evaluate(changeSet(files), config, [protectedPack]).findings.map((f) => [f.ruleId, f.file, f.reason]);
}

function modeChange(path: string, text: string, from: string, to: string): FileChange {
  const before = side(path, text);
  return { status: 'modified', path, old: { ...before, mode: from }, new: { ...before, mode: to } };
}

describe('protected pack', () => {
  it('reports a mode change on a protected path', () => {
    expect(run([modeChange('fixtures/golden/run.sh', 'echo ok\n', '100644', '100755')])).toEqual([
      ['protected/path', 'fixtures/golden/run.sh', 'protected path fixtures/golden/run.sh (protectedPaths "fixtures/golden/") changed mode 100644 to 100755'],
    ]);
  });

  it('reports a mode change on the guard config', () => {
    expect(run([modeChange(GUARD_CONFIG_PATH, '{}\n', '100644', '100755')])).toEqual([
      ['protected/guard-config', GUARD_CONFIG_PATH, 'guard config .agent-pr-guard.json changed mode 100644 to 100755'],
    ]);
  });

  it('reports a type change, such as a file replaced by a symlink', () => {
    const before = side('CODEOWNERS', '* @andy\n');
    const after = { ...side('CODEOWNERS', 'elsewhere/CODEOWNERS'), mode: '120000' };
    expect(run([{ status: 'type-changed', path: 'CODEOWNERS', old: before, new: after }])).toEqual([
      ['protected/path', 'CODEOWNERS', 'protected path CODEOWNERS (CODEOWNERS) changed type'],
    ]);
  });

  it('judges paths, so a protected file the reader could not open is still reported', () => {
    const findings = run([
      change(side('fixtures/golden/big.bin', null, 'binary'), side('fixtures/golden/big.bin', null, 'binary')),
      change(side(GUARD_CONFIG_PATH, null, 'too-large'), null),
    ]);
    expect(findings.map(([rule, file]) => [rule, file])).toEqual([
      ['protected/guard-config', GUARD_CONFIG_PATH],
      ['protected/path', 'fixtures/golden/big.bin'],
    ]);
  });

  it('names a rename on both sides in the reason', () => {
    expect(run([change(side('fixtures/golden/a.json', '1\n'), side('fixtures/a.json', '1\n'))])).toEqual([
      [
        'protected/path',
        'fixtures/a.json',
        'protected path fixtures/golden/a.json (protectedPaths "fixtures/golden/") was renamed from fixtures/golden/a.json to fixtures/a.json',
      ],
    ]);
  });

  it('reports a file both edited and given a new mode', () => {
    const findings = run([
      { ...modeChange('fixtures/golden/x', 'a\n', '100644', '100755'), new: { ...side('fixtures/golden/x', 'b\n'), mode: '100755' } },
    ]);
    expect(findings[0]?.[2]).toMatch(/was modified and changed mode 100644 to 100755$/);
  });

  it('passes a first CODEOWNERS with a warning, and errors when the base already had one anywhere', () => {
    const added = [change(null, side('.github/CODEOWNERS', '* @andy\n'))];
    const first = evaluate(changeSet(added), DEFAULT_CONFIG, [protectedPack]);
    expect(first.findings.map((f) => [f.ruleId, f.severity])).toEqual([['protected/path', 'warning']]);
    expect(first.passed).toBe(true);
    for (const existing of ['CODEOWNERS', 'docs/CODEOWNERS', '.gitlab/CODEOWNERS']) {
      const over = evaluate(changeSet(added, [existing]), DEFAULT_CONFIG, [protectedPack]);
      expect(over.findings.map((f) => f.severity), existing).toEqual(['error']);
    }
  });

  it('warns on a protected path the PR creates, and errors on any change to one the base had', () => {
    const severities = (files: readonly FileChange[]) =>
      evaluate(changeSet(files), GOLDEN, [protectedPack]).findings.map((f) => [f.file, f.severity]);
    expect(severities([change(null, side('fixtures/golden/new.json', '1\n'))])).toEqual([['fixtures/golden/new.json', 'warning']]);
    expect(severities([change(side('scratch/a.json', '1\n'), side('fixtures/golden/a.json', '1\n'))])).toEqual([
      ['fixtures/golden/a.json', 'warning'],
    ]);
    expect(severities([change(side('fixtures/golden/a.json', '1\n'), side('fixtures/golden/b.json', '1\n'))])).toEqual([
      ['fixtures/golden/b.json', 'error'],
    ]);
    expect(severities([modified('fixtures/golden/a.json', '1\n', '2\n')])).toEqual([['fixtures/golden/a.json', 'error']]);
    expect(severities([change(side('fixtures/golden/a.json', '1\n'), null)])).toEqual([['fixtures/golden/a.json', 'error']]);
    expect(severities([modeChange('fixtures/golden/run.sh', 'echo\n', '100644', '100755')])).toEqual([['fixtures/golden/run.sh', 'error']]);
  });

  it('keeps an added guard config at error and lets config turn an added protected path off', () => {
    const files = [change(null, side(GUARD_CONFIG_PATH, '{}\n')), change(null, side('fixtures/golden/new.json', '1\n'))];
    expect(evaluate(changeSet(files), GOLDEN, [protectedPack]).findings.map((f) => [f.ruleId, f.severity])).toEqual([
      ['protected/guard-config', 'error'],
      ['protected/path', 'warning'],
    ]);
    const off: GuardConfig = { ...GOLDEN, rules: { 'protected/path': 'off' } };
    expect(evaluate(changeSet(files), off, [protectedPack]).findings.map((f) => f.ruleId)).toEqual(['protected/guard-config']);
  });

  it('protects only the root guard config, not a same-named file elsewhere', () => {
    expect(run([modified('packages/a/.agent-pr-guard.json', '{}\n', '{"x":1}\n')], DEFAULT_CONFIG)).toEqual([]);
  });

  it('lets config lower protected/path but never protected/guard-config', () => {
    const config: GuardConfig = { ...GOLDEN, rules: { protected: 'warning' } };
    const report = evaluate(
      changeSet([modified('fixtures/golden/a.json', '1\n', '2\n'), modified(GUARD_CONFIG_PATH, '{}\n', '{"rules":{}}\n')]),
      config,
      [protectedPack],
    );
    expect(report.findings.map((f) => [f.ruleId, f.severity])).toEqual([
      ['protected/guard-config', 'error'],
      ['protected/path', 'warning'],
    ]);
  });

  it('is registered, with protected/guard-config locked against config', () => {
    expect(ALL_PACKS).toContain(protectedPack);
    const registry = buildRegistry(ALL_PACKS);
    expect(registry.locked.has('protected/guard-config')).toBe(true);
    expect(registry.locked.has('protected/path')).toBe(false);
    expect(() => parseGuardConfig('{"rules":{"protected/guard-config":"warning"}}', 'test', registry)).toThrow(ConfigError);
    expect(parseGuardConfig('{"rules":{"protected/path":"off"}}', 'test', registry).rules).toEqual({ 'protected/path': 'off' });
  });
});
