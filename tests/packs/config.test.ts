import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/engine/config.js';
import { evaluate } from '../../src/engine/engine.js';
import { configPack } from '../../src/packs/config.js';
import { change, changeSet, modified, side } from '../helpers/changeset.js';
import { describeFixtures } from './fixture-suite.js';

describeFixtures('config', configPack);

function findings(files: Parameters<typeof changeSet>[0]): [string, number | null, string][] {
  return evaluate(changeSet(files), DEFAULT_CONFIG, [configPack]).findings.map((f) => [f.ruleId, f.line, f.reason]);
}

describe('config pack', () => {
  it('names the key and both values', () => {
    expect(findings([modified('jest.config.js', 'module.exports = { coverageThreshold: { global: { lines: 90 } } };\n', 'module.exports = { coverageThreshold: { global: { lines: 60 } } };\n')])).toEqual([
      ['config/threshold-lowered', 1, 'coverage floor coverageThreshold.global.lines lowered from 90 to 60'],
    ]);
    expect(findings([modified('pyproject.toml', '[tool.ruff.lint]\nignore = ["E501"]\n', '[tool.ruff.lint]\nignore = ["E501", "F401", "E722"]\n')])).toEqual([
      ['config/rule-disabled', 2, '2 codes added to tool.ruff.lint.ignore: F401, E722'],
    ]);
  });

  it('never compares a side it could not read', () => {
    const unreadable = change(side('tsconfig.json', null, 'too-large'), side('tsconfig.json', '{ "compilerOptions": {} }\n'));
    expect(findings([unreadable])).toEqual([]);
  });

  it('never counts worker, thread or timeout limits', () => {
    const before = 'export default { test: { maxConcurrency: 2, poolOptions: { forks: { maxForks: 2 } } } };\n';
    const after = 'export default { test: { maxConcurrency: 20, poolOptions: { forks: { maxForks: 1 } } } };\n';
    expect(findings([modified('vitest.config.ts', before, after)])).toEqual([]);
  });
});
