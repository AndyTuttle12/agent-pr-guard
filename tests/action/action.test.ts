import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BUNDLES, bundleCode, ROOT } from '../../scripts/bundle.js';
import { ensureHistory, gitIn } from '../../src/action/history.js';
import { checkArgv, InputError, parseActionInputs } from '../../src/action/inputs.js';
import { runAction } from '../../src/action/main.js';
import { annotations, escapeProperty, MAX_SUMMARY_ROWS, outputs, renderSummary, shouldFail } from '../../src/action/summary.js';
import { parseCliJson, type CheckOutcome } from '../../src/cli/json-outcome.js';
import type { JsonReport } from '../../src/cli/report.js';
import type { Finding } from '../../src/engine/finding.js';
import { MATH_TEST_WEAKENED, mathRepo } from '../helpers/cli.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/repo.js';

afterAll(cleanupTempDirs);

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function env(inputs: Record<string, string>, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { GITHUB_WORKSPACE: '/work', ...extra };
  for (const [name, value] of Object.entries(inputs)) out[`INPUT_${name.toUpperCase()}`] = value;
  return out;
}

function report(findings: Finding[], over: Partial<JsonReport> = {}): CheckOutcome {
  const errors = findings.filter((f) => f.severity === 'error').length;
  return {
    kind: 'report',
    report: {
      version: 1,
      base: SHA_A,
      head: SHA_B,
      mergeBase: 'c'.repeat(40),
      config: 'defaults',
      verdict: errors > 0 ? 'fail' : 'pass',
      errors,
      warnings: findings.length - errors,
      findings,
      uninspected: [],
      ...over,
    },
  };
}

const REMOVED: Finding = { ruleId: 'assertion/removed', severity: 'error', file: 'src/math.test.ts', line: 6, reason: '1 assertion removed (2 before, 1 after)' };
const DELETED_WITH_CODE: Finding = { ruleId: 'test-deletion/deleted', severity: 'warning', file: 'src/old.test.ts', line: null, reason: 'test file deleted with src/old.ts' };

describe('action inputs', () => {
  it('reads every input, with fail-on defaulting to none (warn-only) and the repo to the workspace', () => {
    expect(parseActionInputs(env({ base: ` ${SHA_A} `, head: SHA_B }), '/cwd')).toEqual({
      base: SHA_A,
      head: SHA_B,
      config: null,
      failOn: 'none',
      repoDir: '/work',
      workspace: '/work',
    });
  });

  it('reads fail-on from INPUT_FAIL-ON, keeping the hyphen, and resolves path against the workspace', () => {
    const inputs = parseActionInputs(env({ base: 'origin/main', head: 'HEAD', 'fail-on': 'Warning', path: 'repo', config: '../policy.json' }), '/cwd');
    expect(inputs).toMatchObject({ failOn: 'warning', repoDir: '/work/repo', config: '../policy.json' });
  });

  it('falls back to the current directory without GITHUB_WORKSPACE', () => {
    expect(parseActionInputs({ INPUT_BASE: 'main', INPUT_HEAD: 'HEAD' }, '/cwd').workspace).toBe('/cwd');
  });

  it.each([
    [{ head: SHA_B }, /input base is empty: .*pull_request/],
    [{ base: SHA_A }, /input head is empty/],
    [{ base: '--upload-pack=evil', head: SHA_B }, /must be a revision, not an option/],
    [{ base: 'main other', head: SHA_B }, /single revision/],
    [{ base: SHA_A, head: SHA_B, 'fail-on': 'never' }, /fail-on must be "none", "error" or "warning"/],
  ])('refuses %j', (inputs, message) => {
    expect(() => parseActionInputs(env(inputs), '/cwd')).toThrow(InputError);
    expect(() => parseActionInputs(env(inputs), '/cwd')).toThrow(message);
  });

  it('builds the CLI arguments, adding --config only when given', () => {
    const inputs = parseActionInputs(env({ base: SHA_A, head: SHA_B }), '/cwd');
    expect(checkArgv(inputs)).toEqual(['check', '--base', SHA_A, '--head', SHA_B, '--json', '--repo', '/work']);
    expect(checkArgv({ ...inputs, config: 'p.json' }).slice(-2)).toEqual(['--config', 'p.json']);
  });
});

describe('reading the CLI JSON', () => {
  it('turns exit-2 JSON, stderr-only output and unknown shapes into errors', () => {
    expect(parseCliJson('{"version":1,"verdict":"error","error":"bad revision"}', '')).toEqual({ kind: 'error', message: 'bad revision' });
    expect(parseCliJson('', 'agent-pr-guard: not a git repository\n')).toEqual({ kind: 'error', message: 'not a git repository' });
    expect(parseCliJson('{"version":2,"verdict":"pass"}', '').kind).toBe('error');
    expect(parseCliJson('{"version":1,"verdict":"pass"}', '').kind).toBe('error');
  });
});

describe('fail-on and outputs', () => {
  it('never fails on a finding by default, fails on errors with fail-on error, on warnings with fail-on warning, and always when the check could not run', () => {
    expect(shouldFail(report([REMOVED, DELETED_WITH_CODE]), 'none')).toBe(false);
    expect(shouldFail({ kind: 'error', message: 'x' }, 'none')).toBe(true);
    expect(shouldFail(report([REMOVED]), 'error')).toBe(true);
    expect(shouldFail(report([DELETED_WITH_CODE]), 'error')).toBe(false);
    expect(shouldFail(report([DELETED_WITH_CODE]), 'warning')).toBe(true);
    expect(shouldFail(report([]), 'warning')).toBe(false);
    expect(shouldFail({ kind: 'error', message: 'x' }, 'error')).toBe(true);
  });

  it('writes verdict and counts', () => {
    expect(outputs(report([REMOVED, DELETED_WITH_CODE]))).toBe('verdict=fail\nerrors=1\nwarnings=1\n');
    expect(outputs({ kind: 'error', message: 'x' })).toBe('verdict=error\nerrors=0\nwarnings=0\n');
  });
});

describe('annotations', () => {
  it('emits one workflow command per finding, with a line only when there is one', () => {
    expect(annotations([REMOVED, DELETED_WITH_CODE], 'error')).toEqual([
      '::error file=src/math.test.ts,line=6,title=agent-pr-guard assertion/removed::1 assertion removed (2 before, 1 after)',
      '::warning file=src/old.test.ts,title=agent-pr-guard test-deletion/deleted::test file deleted with src/old.ts',
    ]);
  });

  it('annotates an error finding as a warning while the step is warn-only, so the PR does not show red', () => {
    expect(annotations([REMOVED], 'none')).toEqual([
      '::warning file=src/math.test.ts,line=6,title=agent-pr-guard assertion/removed::1 assertion removed (2 before, 1 after)',
    ]);
  });

  it('escapes properties and data so a path or reason cannot inject a second command', () => {
    const [line] = annotations([{ ...REMOVED, file: 'a,b:c%.ts', reason: '50%\n::error::forged' }], 'error');
    expect(line).toBe('::error file=a%2Cb%3Ac%25.ts,line=6,title=agent-pr-guard assertion/removed::50%25%0A::error::forged');
    expect(line?.split('\n')).toHaveLength(1);
    expect(escapeProperty('x\r\ny')).toBe('x%0D%0Ay');
  });
});

describe('job summary', () => {
  it('renders a verdict line and a findings table', () => {
    expect(renderSummary(report([REMOVED, DELETED_WITH_CODE]), 'error')).toBe(
      [
        '## agent-pr-guard: FAIL',
        '',
        `1 error, 1 warning in \`${'c'.repeat(12)}..${'b'.repeat(12)}\` (config: defaults, fails on: error).`,
        '',
        '| Severity | Rule | File | Line | Reason |',
        '|---|---|---|---|---|',
        '| error | `assertion/removed` | `src/math.test.ts` | 6 | 1 assertion removed (2 before, 1 after) |',
        '| warning | `test-deletion/deleted` | `src/old.test.ts` | file | test file deleted with src/old.ts |',
        '',
      ].join('\n'),
    );
  });

  it('titles an error finding in a warn-only run FINDINGS, not FAIL', () => {
    const summary = renderSummary(report([REMOVED, DELETED_WITH_CODE]), 'none');
    expect(summary).toMatch(/^## agent-pr-guard: FINDINGS \(warn-only\)\n/);
    expect(summary).toContain('fails on: nothing, warn-only).');
  });

  it('titles a clean run PASS and a warnings-only run by fail-on', () => {
    expect(renderSummary(report([]), 'error')).toMatch(/^## agent-pr-guard: PASS\n\n0 errors, 0 warnings/);
    expect(renderSummary(report([DELETED_WITH_CODE]), 'error')).toMatch(/^## agent-pr-guard: PASS with warnings/);
    expect(renderSummary(report([DELETED_WITH_CODE]), 'warning')).toMatch(/^## agent-pr-guard: FAIL/);
  });

  it('keeps hostile paths and reasons inside their cells', () => {
    const summary = renderSummary(report([{ ...REMOVED, file: 'a|b`c.ts', reason: '<img src=x> | x\ny' }]), 'error');
    expect(summary).toContain('| `` a\\|b`c.ts `` |');
    expect(summary).toContain('| &lt;img src=x&gt; \\| x y |');
  });

  it('lists uninspected files and caps the table', () => {
    const many = Array.from({ length: MAX_SUMMARY_ROWS + 2 }, (_, i) => ({ ...REMOVED, line: i + 1 }));
    const summary = renderSummary(report(many, { uninspected: [{ file: 'logo.png', reason: 'binary' }] }), 'error');
    expect(summary.split('\n').filter((l) => l.startsWith('| error'))).toHaveLength(MAX_SUMMARY_ROWS);
    expect(summary).toContain('2 more findings not shown');
    expect(summary).toContain('- `logo.png` (binary)');
  });

  it('says the check did not run when it could not', () => {
    expect(renderSummary({ kind: 'error', message: 'unknown revision <x>' }, 'error')).toBe(
      '## agent-pr-guard: could not run\n\nThe check did not run, so it did not pass: unknown revision &lt;x&gt;\n',
    );
  });
});

describe('runAction', () => {
  function runIn(inputs: Record<string, string>, workspace: string) {
    const files = new Map<string, string>();
    let stdout = '';
    const io = {
      env: { ...env(inputs, { GITHUB_WORKSPACE: workspace, GITHUB_STEP_SUMMARY: '/summary', GITHUB_OUTPUT: '/output' }), PATH: process.env['PATH'] ?? '' },
      cwd: workspace,
      stdout: (text: string) => {
        stdout += text;
      },
      appendFile: (path: string, text: string) => files.set(path, (files.get(path) ?? '') + text),
    };
    return { run: () => runAction(io), files, out: () => stdout };
  }

  it('is warn-only by default: it annotates and summarises a weakening PR but does not fail the step', async () => {
    const { repo, base } = mathRepo();
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    const head = repo.commit('weaken');

    const warned = runIn({ base, head }, repo.dir);
    expect(await warned.run()).toBe(0);
    expect(warned.out()).toContain('::warning file=src/math.test.ts,line=');
    expect(warned.out()).not.toContain('::error');
    expect(warned.files.get('/summary')).toMatch(/^## agent-pr-guard: FINDINGS \(warn-only\)/);
    expect(warned.files.get('/output')).toBe('verdict=fail\nerrors=1\nwarnings=0\n');
  });

  it('fails a weakening PR with annotations, a summary and outputs under fail-on error, and passes an honest one', async () => {
    const { repo, base } = mathRepo();
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    const head = repo.commit('weaken');

    const failing = runIn({ base, head, 'fail-on': 'error' }, repo.dir);
    expect(await failing.run()).toBe(1);
    expect(failing.out()).toContain('::error file=src/math.test.ts,line=');
    expect(failing.out()).toContain('::error title=agent-pr-guard::agent-pr-guard failed: 1 error');
    expect(failing.files.get('/summary')).toMatch(/^## agent-pr-guard: FAIL/);
    expect(failing.files.get('/output')).toBe('verdict=fail\nerrors=1\nwarnings=0\n');

    const passing = runIn({ base, head: base, 'fail-on': 'error' }, repo.dir);
    expect(await passing.run()).toBe(0);
    expect(passing.files.get('/output')).toBe('verdict=pass\nerrors=0\nwarnings=0\n');
  });

  it('fails, without running the check, when an input is missing', async () => {
    const run = runIn({ head: 'HEAD' }, makeTempDir('apg-action-'));
    expect(await run.run()).toBe(1);
    expect(run.files.get('/summary')).toContain('input base is empty');
    expect(run.files.get('/output')).toBe('verdict=error\nerrors=0\nwarnings=0\n');
  });
});

describe('ensureHistory', () => {
  it('deepens a depth-1 clone until the merge base resolves', async () => {
    const { repo, base } = mathRepo();
    for (let i = 0; i < 3; i++) {
      repo.write(`notes/${i}.md`, `${i}\n`);
      repo.commit(`note ${i}`);
    }
    const head = repo.git('rev-parse', 'HEAD').trim();
    const clone = join(makeTempDir('apg-shallow-'), 'clone');
    execFileSync('git', ['clone', '-q', '--depth=1', '--no-single-branch', `file://${repo.dir}`, clone]);
    const git = gitIn(clone, process.env);
    expect((await git(['merge-base', base, head])).code).not.toBe(0);

    expect(await ensureHistory(git, base, head)).toEqual([]);
    expect((await git(['merge-base', base, head])).stdout.trim()).toBe(base);
  });

  it('returns a warning when a fetch fails, and leaves the error to the check', async () => {
    const dir = makeTempDir('apg-noremote-');
    execFileSync('git', ['init', '-q', dir]);
    const warnings = await ensureHistory(gitIn(dir, process.env), SHA_A, SHA_B);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^git fetch failed: /);
  });
});

describe('the committed bundles', () => {
  it.each(BUNDLES.map((b) => [b.output, b] as const))('%s matches its sources (run npm run bundle)', async (_, spec) => {
    expect(readFileSync(join(ROOT, spec.output), 'utf8')).toBe(await bundleCode(spec));
  });

  it('action.yml runs the bundle on the newest Node runtime', () => {
    const yml = readFileSync(join(ROOT, 'action.yml'), 'utf8');
    expect(yml).toMatch(/^ {2}using: node24$/m);
    expect(yml).toMatch(/^ {2}main: action\/dist\/index\.mjs$/m);
  });
});
