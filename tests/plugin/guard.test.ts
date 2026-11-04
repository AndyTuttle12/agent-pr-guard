import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runManualCheck, runStopHook } from '../../src/plugin/guard.js';
import { MATH_TEST, MATH_TEST_WEAKENED, mathRepo } from '../helpers/cli.js';
import { cleanupTempDirs, makeTempDir, type TestRepo } from '../helpers/repo.js';

afterAll(cleanupTempDirs);

/** Git with no user or system config, as the test repos are made. */
const ENV: NodeJS.ProcessEnv = { PATH: process.env['PATH'] ?? '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

/** The same environment with the opt-in that lets the Stop hook block. */
const BLOCKING_ENV: NodeJS.ProcessEnv = { ...ENV, AGENT_PR_GUARD_BLOCK: '1' };

const BUNDLE = join(import.meta.dirname, '..', '..', 'plugin', 'scripts', 'guard.mjs');

function hookInput(repo: TestRepo, stopHookActive: boolean): string {
  return JSON.stringify({ session_id: 's', hook_event_name: 'Stop', cwd: repo.dir, stop_hook_active: stopHookActive });
}

async function manualCheck(cwd: string): Promise<{ code: number; text: string }> {
  let text = '';
  const code = await runManualCheck(cwd, ENV, (chunk) => {
    text += chunk;
  });
  return { code, text };
}

/** What the hook must never change: the branch, the refs, the staged state and the file on disk. */
function repoState(repo: TestRepo): string[] {
  return [repo.git('symbolic-ref', 'HEAD'), repo.git('for-each-ref', '--format=%(refname) %(objectname)'), repo.git('status', '--porcelain=v1', '--untracked-files=all')];
}

/** A feature branch off main with its test weakened in the working tree and nothing committed. */
function uncommittedWeakening(): TestRepo {
  const { repo } = mathRepo();
  repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
  return repo;
}

describe('runStopHook on a real repository', () => {
  it('is warn-only by default: it names the uncommitted weakened test and lets the stop go ahead', async () => {
    const repo = uncommittedWeakening();
    const before = repoState(repo);
    const out = await runStopHook(hookInput(repo, false), ENV, '/');
    expect(out.decision).toBeUndefined();
    expect(out.reason).toBeUndefined();
    expect(out.systemMessage).toContain('warn-only, not blocking');
    expect(out.systemMessage).toMatch(/^- src\/math\.test\.ts:\d+ assertion\/removed: /m);
    expect(repoState(repo)).toEqual(before);
  });

  it('blocks the first stop on an uncommitted weakened test when blocking is opted in, with the finding as the reason', async () => {
    const repo = uncommittedWeakening();
    const before = repoState(repo);
    const out = await runStopHook(hookInput(repo, false), BLOCKING_ENV, '/');
    expect(out.decision).toBe('block');
    expect(out.systemMessage).toBeUndefined();
    expect(out.reason).toMatch(/^agent-pr-guard: you weakened what judges you\./);
    expect(out.reason).toContain('1 error finding:');
    expect(out.reason).toMatch(/^- src\/math\.test\.ts:\d+ assertion\/removed: 1 assertion removed \(2 before, 1 after\)$/m);
    expect(repoState(repo)).toEqual(before);
  });

  it('lets the repeated stop go ahead with a message naming the finding still there', async () => {
    const repo = uncommittedWeakening();
    const out = await runStopHook(hookInput(repo, true), BLOCKING_ENV, '/');
    expect(out.decision).toBeUndefined();
    expect(out.reason).toBeUndefined();
    expect(out.systemMessage).toContain('1 error finding still on this branch');
    expect(out.systemMessage).toMatch(/^- src\/math\.test\.ts:\d+ assertion\/removed: /m);
  });

  it('lets the stop go ahead silently once the test is restored', async () => {
    const repo = uncommittedWeakening();
    expect((await runStopHook(hookInput(repo, false), ENV, '/')).systemMessage).toContain('1 error finding');
    repo.write('src/math.test.ts', MATH_TEST);
    expect(await runStopHook(hookInput(repo, false), ENV, '/')).toEqual({});
  });

  it('lets the stop go ahead silently on a clean tree, with or without honest commits', async () => {
    const { repo } = mathRepo();
    expect(await runStopHook(hookInput(repo, false), ENV, '/')).toEqual({});
    repo.write('src/sub.ts', 'export const sub = (a: number, b: number): number => a - b;\n');
    repo.commit('add sub');
    expect(await runStopHook(hookInput(repo, false), ENV, '/')).toEqual({});
  });

  it('falls back to the given cwd when the hook input has none', async () => {
    const repo = uncommittedWeakening();
    expect((await runStopHook('not json', BLOCKING_ENV, repo.dir)).decision).toBe('block');
  });

  it('lets the stop go ahead silently outside a git working tree', async () => {
    expect(await runStopHook(JSON.stringify({ cwd: makeTempDir('apg-norepo-') }), ENV, '/')).toEqual({});
  });
});

describe('runManualCheck on a real repository', () => {
  it('reports the uncommitted weakened test and exits 0', async () => {
    const repo = uncommittedWeakening();
    const before = repoState(repo);
    const { code, text } = await manualCheck(repo.dir);
    expect(code).toBe(0);
    expect(text).toMatch(/^agent-pr-guard: comparing HEAD plus uncommitted and untracked files with main \(merge base [0-9a-f]{12}\)\n\n/);
    expect(text).toMatch(/assertion\/removed: 1 assertion removed \(2 before, 1 after\)/);
    expect(text).toContain('FINDINGS (warn-only, exit 0): 1 error, 0 warnings');
    expect(repoState(repo)).toEqual(before);
  });

  it('says there is nothing to check on a clean tree', async () => {
    const { repo } = mathRepo();
    const { code, text } = await manualCheck(repo.dir);
    expect(code).toBe(0);
    expect(text).toBe("agent-pr-guard: nothing to check: nothing on HEAD or in the working tree differs from main.\n");
  });

  it('compares HEAD alone when only committed changes differ', async () => {
    const { repo } = mathRepo();
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    repo.commit('weaken');
    const { text } = await manualCheck(repo.dir);
    expect(text).toMatch(/^agent-pr-guard: comparing HEAD with main /);
    expect(text).toContain('assertion/removed');
  });
});

describe('the bundled guard.mjs', () => {
  it.each([
    ['warn-only decision by default', ENV],
    ['block decision when blocking is opted in', BLOCKING_ENV],
  ])('prints the same %s as runStopHook for the Stop hook', async (_what, env) => {
    const repo = uncommittedWeakening();
    const expected = await runStopHook(hookInput(repo, false), env, '/');
    const stdout = execFileSync(process.execPath, [BUNDLE, 'stop'], { input: hookInput(repo, false), env: { ...env, TMPDIR: tmpdir() }, encoding: 'utf8' });
    expect(JSON.parse(stdout)).toEqual(expected);
  });
});
