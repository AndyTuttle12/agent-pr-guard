import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCliArgs, UsageError } from '../../src/cli/args.js';
import { JSON_SCHEMA_VERSION } from '../../src/cli/report.js';
import { cli, MATH_TEST, MATH_TEST_WEAKENED, mathRepo } from '../helpers/cli.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/repo.js';

afterEach(cleanupTempDirs);

describe('agent-pr-guard check: verdicts and exit codes', () => {
  it('exits 0 with a one-line PASS verdict for an honest change', async () => {
    const { repo } = mathRepo();
    repo.write('src/math.ts', `${'export const sub = (a: number, b: number): number => a - b;\n'}`);
    repo.commit('honest');
    const run = await cli(['check', '--base', 'main', '--head', 'feature', '--repo', repo.dir]);
    expect(run).toMatchObject({ code: 0, stderr: '' });
    expect(run.stdout.trimEnd().split('\n').at(-1)).toBe('PASS: no findings.');
  });

  it('exits 1 on an error finding under --fail-on error, grouping findings by file with line, severity, rule and reason', async () => {
    const { repo } = mathRepo();
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    repo.write('CODEOWNERS', '* @someone\n');
    repo.commit('weaken');
    const run = await cli(['check', '--base', 'main', '--head', 'feature', '--repo', repo.dir, '--fail-on', 'error']);
    expect(run.code).toBe(1);
    expect(run.stderr).toBe('');
    const lines = run.stdout.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^agent-pr-guard: [0-9a-f]{12}\.\.[0-9a-f]{12} \(base [0-9a-f]{12}\), config: defaults$/);
    const codeowners = lines.indexOf('CODEOWNERS');
    const test = lines.indexOf('src/math.test.ts');
    expect(codeowners).toBeGreaterThan(0);
    expect(test).toBeGreaterThan(codeowners);
    expect(lines[codeowners + 1]).toBe('  file      warning protected/path: protected path CODEOWNERS (CODEOWNERS) was added');
    expect(lines[test + 1]).toMatch(/^ {2}line 6 {4}error {3}assertion\/removed: \S/);
    expect(lines.at(-1)).toBe('FAIL: 1 error, 1 warning in 2 files.');
  });

  it('is warn-only by default: an error finding is printed and the exit code stays 0', async () => {
    const { repo } = mathRepo();
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    repo.commit('weaken');
    const run = await cli(['check', '--base', 'main', '--head', 'feature', '--repo', repo.dir]);
    expect(run).toMatchObject({ code: 0, stderr: '' });
    expect(run.stdout).toMatch(/\n {2}line 6 {4}error {3}assertion\/removed: /);
    expect(run.stdout.trimEnd().split('\n').at(-1)).toBe(
      'FINDINGS (warn-only, exit 0): 1 error, 0 warnings in 1 file. Pass --fail-on error to exit 1 on these.',
    );
    expect((await cli(['check', '--base', 'main', '--head', 'feature', '--repo', repo.dir, '--fail-on', 'none'])).code).toBe(0);
  });

  it('--fail-on warning also exits 1 on a warning-only report; --fail-on error does not', async () => {
    const { repo } = mathRepo();
    repo.remove('src/math.ts');
    repo.remove('src/math.test.ts');
    repo.commit('retire math');
    const base = ['check', '--base', 'main', '--head', 'feature', '--repo', repo.dir];
    expect((await cli([...base, '--fail-on', 'error'])).code).toBe(0);
    const strict = await cli([...base, '--fail-on', 'warning']);
    expect(strict.code).toBe(1);
    expect(strict.stdout.trimEnd().split('\n').at(-1)).toBe('FAIL: 0 errors, 1 warning in 1 file.');
  });

  it('rejects an unknown --fail-on level with exit 2', async () => {
    const { repo } = mathRepo();
    const run = await cli(['check', '--base', 'main', '--repo', repo.dir, '--fail-on', 'always']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('--fail-on must be none, error or warning, got "always"');
  });

  it('prints warnings but exits 0 when no finding is an error', async () => {
    const { repo } = mathRepo();
    repo.remove('src/math.ts');
    repo.remove('src/math.test.ts');
    repo.commit('retire math');
    const run = await cli(['check', '--base', 'main', '--head', 'feature', '--repo', repo.dir]);
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/\n {2}file {6}warning test-deletion\/deleted: /);
    expect(run.stdout.trimEnd().split('\n').at(-1)).toBe('PASS with warnings: 0 errors, 1 warning in 1 file.');
  });

  it('diffs from the merge base, so a weakening that landed on main is not blamed on the PR', async () => {
    const { repo } = mathRepo();
    repo.write('src/math.ts', 'export const add = (a: number, b: number): number => b + a;\n');
    repo.commit('feature work');
    repo.git('checkout', '-q', 'main');
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    repo.commit('main weakens its own test');
    const run = await cli(['check', '--base', 'main', '--head', 'feature', '--repo', repo.dir]);
    expect(run.code).toBe(0);
  });

  it('defaults --head to HEAD and --repo to the current directory', async () => {
    const { repo } = mathRepo();
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    repo.commit('weaken');
    const run = await cli(['check', '--base', 'main', '--fail-on', 'error'], repo.dir);
    expect(run.code).toBe(1);
  });
});

describe('agent-pr-guard check --json', () => {
  it('prints the stable schema', async () => {
    const { repo, base } = mathRepo();
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    repo.write('assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    const head = repo.commit('weaken');
    const run = await cli(['check', '--base', 'main', '--head', 'feature', '--repo', repo.dir, '--json']);
    expect(run.code).toBe(0);
    const report = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(Object.keys(report)).toEqual([
      'version',
      'base',
      'head',
      'mergeBase',
      'config',
      'verdict',
      'errors',
      'warnings',
      'findings',
      'uninspected',
    ]);
    expect(report).toMatchObject({
      version: JSON_SCHEMA_VERSION,
      base,
      head,
      mergeBase: base,
      config: 'defaults',
      verdict: 'fail',
      errors: 1,
      warnings: 0,
      uninspected: [{ file: 'assets/logo.png', reason: 'binary' }],
    });
    expect(report['findings']).toEqual([
      { ruleId: 'assertion/removed', severity: 'error', file: 'src/math.test.ts', line: 6, reason: expect.any(String) },
    ]);
  });

  it('reports verdict pass with empty lists for an honest change', async () => {
    const { repo } = mathRepo();
    repo.write('README.md', 'math\n');
    repo.commit('docs');
    const run = await cli(['check', '--base', 'main', '--head', 'feature', '--repo', repo.dir, '--json']);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ verdict: 'pass', errors: 0, warnings: 0, findings: [], uninspected: [] });
  });

  it('prints an error object on stdout and exits 2 when the check cannot run', async () => {
    const { repo } = mathRepo();
    const run = await cli(['check', '--base', 'no-such-branch', '--repo', repo.dir, '--json']);
    expect(run.code).toBe(2);
    expect(JSON.parse(run.stdout)).toEqual({
      version: JSON_SCHEMA_VERSION,
      verdict: 'error',
      error: 'cannot resolve "no-such-branch" to a commit in this repository',
    });
    expect(run.stderr).toContain('cannot resolve');
  });
});

describe('agent-pr-guard check: config', () => {
  it('reads .agent-pr-guard.json from the base tip, including a rule added on main after the PR branched', async () => {
    const { repo } = mathRepo();
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    repo.commit('weaken');
    repo.git('checkout', '-q', 'main');
    repo.write('.agent-pr-guard.json', '{ "rules": { "assertion/removed": "warning" } }\n');
    repo.commit('soften on main');
    const run = await cli(['check', '--base', 'main', '--head', 'feature', '--repo', repo.dir, '--json']);
    expect(run.code).toBe(0);
    const report = JSON.parse(run.stdout) as { config: string; findings: { ruleId: string; severity: string }[] };
    expect(report.config).toMatch(/^[0-9a-f]{40}:\.agent-pr-guard\.json$/);
    expect(report.findings.map((f) => [f.ruleId, f.severity])).toEqual([['assertion/removed', 'warning']]);
  });

  it('ignores the head side config and reports the edit as a locked error', async () => {
    const { repo } = mathRepo();
    repo.git('checkout', '-q', 'main');
    repo.write('.agent-pr-guard.json', '{ "rules": { "assertion/removed": "warning" } }\n');
    repo.commit('config');
    repo.git('checkout', '-q', 'feature');
    repo.git('merge', '-q', '--ff-only', 'main');
    repo.write('.agent-pr-guard.json', '{ "rules": { "assertion": "off" } }\n');
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    repo.commit('relax the judge');
    const run = await cli(['check', '--base', 'main', '--head', 'feature', '--repo', repo.dir, '--fail-on', 'error']);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('config: .agent-pr-guard.json at base');
    expect(run.stdout).toMatch(/error {3}protected\/guard-config: /);
    expect(run.stdout).toMatch(/warning assertion\/removed: /);
  });

  it('uses a trusted --config file from outside the repository instead of the base config', async () => {
    const { repo } = mathRepo();
    repo.git('checkout', '-q', 'main');
    repo.write('.agent-pr-guard.json', '{ "protectedPaths": ["src/"] }\n');
    repo.commit('protect src');
    repo.git('checkout', '-q', 'feature');
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    repo.commit('weaken');
    const config = join(makeTempDir('apg-config-'), 'guard.json');
    writeFileSync(config, '{ "rules": { "assertion": "off" } }\n');
    const run = await cli(['check', '--base', 'main', '--head', 'feature', '--repo', repo.dir, '--config', config, '--json']);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ findings: [], verdict: 'pass' });
    expect((JSON.parse(run.stdout) as { config: string }).config).toMatch(/guard\.json$/);
  });

  it('refuses a --config inside the repository being checked, which the PR could edit', async () => {
    const { repo } = mathRepo();
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    repo.write('ci/guard.json', '{ "rules": { "assertion": "off" } }\n');
    repo.commit('weaken and bring a config');
    const run = await cli(['check', '--base', 'main', '--repo', join(repo.dir, 'src'), '--config', 'ci/guard.json'], repo.dir);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/is inside the repository being checked/);
    expect(run.stdout).toBe('');
  });

  it.each([
    ['an unknown key', '{ "rulez": {} }\n', /unknown key "rulez"/],
    ['an unknown rule', '{ "rules": { "assertion/nope": "off" } }\n', /unknown rule or pack "assertion\/nope"/],
    ['invalid JSON', '{ rules: }\n', /not valid JSON/],
  ])('exits 2 when the base config has %s', async (_what, text, message) => {
    const { repo } = mathRepo();
    repo.git('checkout', '-q', 'main');
    repo.write('.agent-pr-guard.json', text);
    repo.commit('bad config');
    repo.git('checkout', '-q', 'feature');
    repo.write('README.md', 'x\n');
    repo.commit('docs');
    const run = await cli(['check', '--base', 'main', '--head', 'feature', '--repo', repo.dir]);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(message);
  });

  it('exits 2 when --config names a missing file', async () => {
    const { repo } = mathRepo();
    const run = await cli(['check', '--base', 'main', '--repo', repo.dir, '--config', join(makeTempDir(), 'missing.json')]);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/cannot read config/);
  });
});

describe('agent-pr-guard: usage', () => {
  it.each([
    [[], /missing command/],
    [['lint'], /unknown command "lint"/],
    [['check'], /missing --base/],
    [['check', '--base'], /argument missing/],
    [['check', '--base', 'main', '--bogus'], /Unknown option '--bogus'/],
    [['check', '--base', 'main', '--base', 'dev'], /--base given more than once/],
    [['check', '--base', 'main', 'extra'], /unexpected argument "extra"/],
    [['check', '--base', ''], /--base must not be empty/],
  ])('exits 2 with the usage for %j', async (argv, message) => {
    const run = await cli(argv);
    expect(run.code).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).toMatch(message);
    expect(run.stderr).toContain('Usage: agent-pr-guard check');
  });

  it('exits 2 when --repo is not a directory', async () => {
    const run = await cli(['check', '--base', 'main', '--repo', join(makeTempDir(), 'nope')]);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/is not a directory/);
  });

  it('exits 2 when --repo is not a git repository', async () => {
    const run = await cli(['check', '--base', 'main', '--repo', makeTempDir()]);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/^agent-pr-guard: /);
  });

  it('treats an option-shaped revision as a revision that does not resolve, never as a git flag', async () => {
    const { repo } = mathRepo();
    const run = await cli(['check', '--base=--output=/tmp/x', '--repo', repo.dir]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('cannot resolve "--output=/tmp/x"');
  });

  it('prints help and the version with exit 0', async () => {
    expect(await cli(['--help'])).toMatchObject({ code: 0, stdout: expect.stringContaining('Exit codes:') });
    expect(await cli(['check', '-h'])).toMatchObject({ code: 0 });
    expect(await cli(['--version'])).toEqual({ code: 0, stdout: '0.0.0-test\n', stderr: '' });
  });

  it('parses a full check command', () => {
    expect(parseCliArgs(['check', '--base', 'origin/main', '--head', 'abc', '--json', '--config', 'c.json', '--repo', 'r'])).toEqual({
      command: 'check',
      base: 'origin/main',
      head: 'abc',
      failOn: 'none',
      json: true,
      config: 'c.json',
      repo: 'r',
    });
    expect(parseCliArgs(['check', '--base', 'x', '--fail-on', 'Warning'])).toMatchObject({ failOn: 'warning' });
    expect(() => parseCliArgs(['check', '--json=yes', '--base', 'x'])).toThrow(UsageError);
  });
});

it('keeps the MATH_TEST fixture weakened by exactly one assertion', () => {
  expect(MATH_TEST.split('expect(').length - MATH_TEST_WEAKENED.split('expect(').length).toBe(1);
});
