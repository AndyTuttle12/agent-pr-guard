import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MATH_TEST_WEAKENED, mathRepo } from '../helpers/cli.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/repo.js';

const ROOT = join(import.meta.dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string; bin: Record<string, string> };

let bin = '';

/** Builds the package the way `npm run build` does, into a temp package dir, so the test runs what ships. */
beforeAll(() => {
  const dir = join(makeTempDir('apg-pkg-'), 'agent-pr-guard');
  mkdirSync(dir);
  copyFileSync(join(ROOT, 'package.json'), join(dir, 'package.json'));
  execFileSync(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', join(ROOT, 'tsconfig.build.json'), '--outDir', join(dir, 'dist')], {
    stdio: 'pipe',
  });
  const entry = pkg.bin['agent-pr-guard'];
  if (entry === undefined) throw new Error('package.json has no agent-pr-guard bin');
  bin = join(dir, entry);
}, 60_000);

afterAll(cleanupTempDirs);

function runBin(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('the built agent-pr-guard bin', () => {
  it('starts with a node shebang', () => {
    expect(readFileSync(bin, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env node');
  });

  it('prints the package version', () => {
    expect(runBin(['--version'])).toEqual({ status: 0, stdout: `${pkg.version}\n`, stderr: '' });
  });

  it('exits 0 (warn-only), 1 (--fail-on error) and 2 against a real repository', () => {
    const { repo } = mathRepo();
    repo.write('README.md', 'math\n');
    repo.commit('docs');
    expect(runBin(['check', '--base', 'main', '--repo', repo.dir]).status).toBe(0);

    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    repo.commit('weaken');
    const warned = runBin(['check', '--base', 'main', '--repo', repo.dir, '--json']);
    expect(warned.status).toBe(0);
    expect(JSON.parse(warned.stdout)).toMatchObject({ verdict: 'fail', findings: [{ ruleId: 'assertion/removed' }] });
    const failed = runBin(['check', '--base', 'main', '--repo', repo.dir, '--json', '--fail-on', 'error']);
    expect(failed.status).toBe(1);
    expect(JSON.parse(failed.stdout)).toMatchObject({ verdict: 'fail', findings: [{ ruleId: 'assertion/removed' }] });

    const usage = runBin(['check', '--repo', repo.dir]);
    expect(usage.status).toBe(2);
    expect(usage.stderr).toContain('missing --base');
  });
});
