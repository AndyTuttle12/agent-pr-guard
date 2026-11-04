import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { CODEOWNERS_PATHS, type FileChange } from '../../src/changeset.js';
import { DEFAULT_CONFIG, GUARD_CONFIG_PATH, parseGuardConfig } from '../../src/engine/config.js';
import { buildRegistry, evaluate, type Report, type RulePack } from '../../src/engine/engine.js';
import type { Severity } from '../../src/engine/finding.js';
import { decodeText, isBinary } from '../../src/git/reader.js';
import { changeSet, side } from './changeset.js';

/**
 * A fixture is a directory with `base/` and `head/` trees and an `expected.json`:
 * `{ "description": "...", "findings": [{ "ruleId": "...", "file": "...", "line": 3, "severity": "warning" }],
 *    "renames": { "old/path": "new/path" } }`. `line` and `severity` are optional; `renames` tells
 * the in-memory loader what git's rename detection would find. The guard config, if any, sits in `base/`.
 */
export interface ExpectedFinding {
  readonly ruleId: string;
  readonly file: string;
  readonly line?: number | null;
  readonly severity?: Severity;
}

export interface Fixture {
  readonly name: string;
  readonly dir: string;
  readonly description: string;
  readonly findings: readonly ExpectedFinding[];
  readonly renames: Readonly<Record<string, string>>;
}

export const FIXTURES_ROOT = join(import.meta.dirname, '..', '..', 'fixtures');

export function listFixtures(pack: string): Fixture[] {
  const packDir = join(FIXTURES_ROOT, pack);
  return readdirSync(packDir)
    .filter((name) => statSync(join(packDir, name)).isDirectory())
    .sort()
    .map((name) => readFixture(join(packDir, name), `${pack}/${name}`));
}

export function readFixture(dir: string, name: string): Fixture {
  const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')) as {
    description?: unknown;
    findings?: unknown;
    renames?: unknown;
  };
  if (typeof expected.description !== 'string' || expected.description === '') {
    throw new Error(`${name}: expected.json needs a description`);
  }
  if (!Array.isArray(expected.findings)) throw new Error(`${name}: expected.json needs a findings array`);
  return {
    name,
    dir,
    description: expected.description,
    findings: expected.findings as ExpectedFinding[],
    renames: (expected.renames ?? {}) as Record<string, string>,
  };
}

export function readTree(root: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  if (!existsSync(root)) return files;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.set(relative(root, full).split(sep).join('/'), readFileSync(full));
    }
  };
  walk(root);
  return files;
}

function fileSide(path: string, content: Buffer): ReturnType<typeof side> {
  return isBinary(content) ? side(path, null, 'binary') : side(path, decodeText(content));
}

/** Runs a fixture through the engine without git: the trees are diffed by path. */
export function runFixtureInMemory(fixture: Fixture, packs: readonly RulePack[]): Report {
  const base = readTree(join(fixture.dir, 'base'));
  const head = readTree(join(fixture.dir, 'head'));
  const renamedTo = new Map(Object.entries(fixture.renames));
  const renamedFrom = new Set(renamedTo.values());
  const files: FileChange[] = [];
  for (const [path, content] of base) {
    const target = renamedTo.get(path);
    if (target !== undefined) {
      const after = head.get(target);
      if (after === undefined) throw new Error(`${fixture.name}: rename target ${target} missing from head`);
      files.push({ status: 'renamed', path: target, old: fileSide(path, content), new: fileSide(target, after) });
      continue;
    }
    const after = head.get(path);
    if (after === undefined) files.push({ status: 'deleted', path, old: fileSide(path, content), new: null });
    else if (!after.equals(content)) {
      files.push({ status: 'modified', path, old: fileSide(path, content), new: fileSide(path, after) });
    }
  }
  for (const [path, content] of head) {
    if (!base.has(path) && !renamedFrom.has(path)) {
      files.push({ status: 'added', path, old: null, new: fileSide(path, content) });
    }
  }
  const configText = base.get(GUARD_CONFIG_PATH);
  const config =
    configText === undefined
      ? DEFAULT_CONFIG
      : parseGuardConfig(configText.toString('utf8'), `${fixture.name}/base`, buildRegistry(packs));
  const baseCodeowners = CODEOWNERS_PATHS.filter((path) => base.has(path));
  return evaluate(changeSet(files, baseCodeowners), config, packs);
}

/**
 * Compares a report with a fixture's expectations: the same multiset of (rule, file), and the
 * same line and severity wherever expected.json gives them.
 */
export function expectationMismatch(fixture: Fixture, report: Report): string | null {
  const actual = report.findings.map((f) => ({ ruleId: f.ruleId, file: f.file, line: f.line, severity: f.severity }));
  const remaining = [...actual];
  for (const want of fixture.findings) {
    const index = remaining.findIndex(
      (got) =>
        got.ruleId === want.ruleId &&
        got.file === want.file &&
        (want.line === undefined || got.line === want.line) &&
        (want.severity === undefined || got.severity === want.severity),
    );
    if (index === -1) return `missing ${JSON.stringify(want)}; got ${JSON.stringify(actual)}`;
    remaining.splice(index, 1);
  }
  if (remaining.length > 0) {
    const detail = report.findings.filter((f) => remaining.some((r) => r.ruleId === f.ruleId && r.file === f.file && r.line === f.line));
    return `unexpected ${JSON.stringify(detail)}`;
  }
  return null;
}
