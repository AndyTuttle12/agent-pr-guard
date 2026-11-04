import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/engine/config.js';
import { evaluate } from '../../src/engine/engine.js';
import { configPack } from '../../src/packs/config.js';
import { change, changeSet, modified, side } from '../helpers/changeset.js';

type Row = [string, number | null, string, string];

function findings(files: Parameters<typeof changeSet>[0], rule = 'config/gate-softened'): Row[] {
  return evaluate(changeSet(files), DEFAULT_CONFIG, [configPack])
    .findings.filter((f) => f.ruleId === rule)
    .map((f) => [f.file, f.line, f.severity, f.reason]);
}

const step = (run: string, ...extra: string[]): string => `      - run: ${run}\n${extra.map((e) => `        ${e}\n`).join('')}`;
const workflow = (...steps: string[]): string => `on: pull_request\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n${steps.join('')}`;
const ci = '.github/workflows/ci.yml';

describe('config/gate-softened: step and job flags', () => {
  it('names the flag and the gate it softens', () => {
    expect(findings([modified(ci, workflow(step('npm ci'), step('npx vitest run')), workflow(step('npm ci'), step('npx vitest run', 'continue-on-error: true')))])).toEqual([
      [ci, 8, 'error', 'continue-on-error: true lets a step or job that runs vitest fail without failing the build'],
    ]);
  });

  it('a job-level flag softens every gate in the job, and nothing outside it', () => {
    const before = 'jobs:\n  test:\n    steps:\n      - run: pytest\n      - run: mypy src\n  lint:\n    steps:\n      - run: ruff check .\n';
    const after = 'jobs:\n  test:\n    continue-on-error: ${{ true }}\n    steps:\n      - run: pytest\n      - run: mypy src\n  lint:\n    steps:\n      - run: ruff check .\n';
    expect(findings([modified(ci, before, after)]).map((r) => r[3])).toEqual([
      'continue-on-error: true lets a step or job that runs mypy fail without failing the build',
      'continue-on-error: true lets a step or job that runs pytest fail without failing the build',
    ]);
  });

  it('pairs a flag with its own step only, by list position', () => {
    const after = workflow(step('npm ci', 'continue-on-error: true'), step('npm test'));
    expect(findings([modified(ci, workflow(step('npm ci'), step('npm test')), after)])).toEqual([
      [ci, 7, 'warning', 'continue-on-error: true lets a step or job that runs npm ci (not a recognised test, lint or type-check command) fail without failing the build'],
    ]);
  });

  it('an expression or a false value is not a softening', () => {
    expect(findings([modified(ci, workflow(step('npm test')), workflow(step('npm test', 'continue-on-error: ${{ matrix.experimental }}')))])).toEqual([]);
    expect(findings([modified(ci, workflow(step('npm test')), workflow(step('npm test', 'continue-on-error: false', "if: github.event_name == 'push'")))])).toEqual([]);
  });

  it('reads if: false, GitLab allow_failure exit codes and Buildkite soft_fail', () => {
    expect(findings([modified(ci, workflow(step('npm test')), workflow(step('npm test', 'if: false')))])[0]?.[3]).toBe('if: false turns off a step or job that runs npm test');
    const gitlab = (extra: string): string => `test:\n  script:\n    - go test ./...\n${extra}`;
    expect(findings([modified('.gitlab-ci.yml', gitlab(''), gitlab('  allow_failure:\n    exit_codes: [1, 2]\n'))]).map((r) => r[3])).toEqual([
      'allow_failure: exit_codes lets a step or job that runs go test fail without failing the build',
    ]);
    const buildkite = (extra: string): string => `steps:\n  - label: test\n    command: cargo test\n${extra}`;
    expect(findings([modified('.buildkite/pipeline.yml', buildkite(''), buildkite('    soft_fail: true\n'))])).toHaveLength(1);
  });

  it('a renumbered or moved softened step is not new; a setup action that may fail is not counted', () => {
    const soft = step('npx playwright test', 'continue-on-error: true');
    const after = workflow(step('npm ci'), step('npm run build'), soft, '      - uses: actions/upload-artifact@v4\n        continue-on-error: true\n');
    expect(findings([modified(ci, workflow(step('npm ci'), soft), after)])).toEqual([]);
    const files = [modified(ci, workflow(step('npm ci'), soft), workflow(step('npm ci'))), change(null, side('.github/workflows/nightly.yml', workflow(soft)))];
    expect(findings(files)).toEqual([]);
  });
});

describe('config/gate-softened: command lines', () => {
  it('|| true swallows the gates before it in its own segment only', () => {
    expect(findings([modified(ci, workflow(step('npm test')), workflow(step('npm test || true')))])).toEqual([[ci, 6, 'error', "'|| true' swallows a failure of npm test"]]);
    expect(findings([modified(ci, workflow(step('npm test && rm -rf out')), workflow(step('npm test; rm -rf out || true')))])).toEqual([]);
    expect(findings([modified(ci, workflow(step('npm test')), workflow(step('npm test 2>&1 | tee log || exit 0')))])[0]?.[3]).toBe("'|| exit 0' swallows a failure of npm test");
  });

  it('a Makefile or tox prefix that ignores the exit code', () => {
    expect(findings([modified('Makefile', 'test:\n\t@pytest\n', 'test:\n\t@-pytest\n')])).toEqual([['Makefile', 2, 'error', "'-' prefix ignores the exit code of pytest"]]);
    expect(findings([modified('tox.ini', '[testenv]\ncommands =\n    pytest\n', '[testenv]\ncommands =\n    - pytest\n')])).toHaveLength(1);
  });

  it('in a gate-named target or script an unrecognised command is a warning; elsewhere it is ignored', () => {
    expect(findings([modified('Makefile', 'test:\n\t./run-suite\nclean:\n\trm -r out\n', 'test:\n\t-./run-suite\nclean:\n\t-rm -r out\n')])).toEqual([
      ['Makefile', 2, 'warning', "'-' prefix ignores the exit code of ./run-suite (not a recognised test, lint or type-check command)"],
    ]);
    const pkg = (test: string, build: string): string => `{ "scripts": { "test:unit": "${test}", "build": "${build}" } }\n`;
    expect(findings([modified('package.json', pkg('node t.js', 'tsup'), pkg('node t.js || true', 'tsup || true'))]).map((r) => r[2])).toEqual(['warning']);
  });

  it('reads shell scripts and husky hooks, never commented-out lines or unreadable sides', () => {
    expect(findings([modified('scripts/ci.sh', 'set -e\neslint .\n', 'set -e\neslint . || true\n')])).toHaveLength(1);
    expect(findings([modified('.husky/pre-push', 'npm test\n', 'npm test || true\n')])).toHaveLength(1);
    expect(findings([modified('scripts/ci.sh', 'eslint .\n', 'eslint .\n# eslint . || true\n')])).toEqual([]);
    expect(findings([change(side('scripts/ci.sh', null, 'binary'), side('scripts/ci.sh', 'eslint . || true\n'))])).toEqual([]);
  });
});

describe('config/gate-softened: workflow triggers', () => {
  const wf = (on: string, run = 'npm test'): string => `on: ${on}\njobs:\n  t:\n    steps:\n      - run: ${run}\n`;

  it('names the triggers lost and the gates the workflow runs', () => {
    expect(findings([modified(ci, wf('[push, pull_request]'), wf('[push]'))])).toEqual([[ci, 1, 'error', 'workflow no longer runs on pull_request; it runs npm test']]);
  });

  it('a workflow whose commands are not recognised gates is a warning; one with no commands is ignored', () => {
    expect(findings([modified(ci, wf('pull_request', './check.sh'), wf('workflow_dispatch', './check.sh'))]).map((r) => r[2])).toEqual(['warning']);
    const deploy = (on: string): string => `on: ${on}\njobs:\n  d:\n    steps:\n      - uses: actions/deploy-pages@v4\n`;
    expect(findings([modified(ci, deploy('push'), deploy('workflow_dispatch'))])).toEqual([]);
  });

  it('pull_request_target keeps pull_request; adding triggers or changing the form passes', () => {
    expect(findings([modified(ci, wf('pull_request'), wf('pull_request_target'))])).toEqual([]);
    expect(findings([modified(ci, wf('push'), 'on:\n  push:\n    branches: [main]\n  workflow_dispatch:\njobs:\n  t:\n    steps:\n      - run: npm test\n')])).toEqual([]);
  });

  it('only GitHub workflows have triggers', () => {
    expect(findings([modified('.gitlab-ci.yml', 'on: push\nt:\n  script: [npm test]\n', 't:\n  script: [npm test]\n')])).toEqual([]);
  });
});

describe('config/gate-removed reads make recipe prefixes', () => {
  it('@ and - prefixed recipe lines are commands', () => {
    expect(findings([modified('Makefile', 'test:\n\t@pytest\n', 'test:\n\t@echo skipped\n')], 'config/gate-removed')).toHaveLength(1);
    expect(findings([modified('Makefile', 'test:\n\tpytest\n', 'test:\n\t@pytest\n')], 'config/gate-removed')).toEqual([]);
  });
});
