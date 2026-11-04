import { parseCliJson } from '../cli/json-outcome.js';
import { runCli } from '../cli/run.js';
import { BASE_ENV, baseCandidates, blockingEnabled, decideStop, parseHookInput, type GuardOutcome, type StopHookOutput } from './decide.js';
import { gitProbe } from './git.js';
import { snapshotWorkingTree, type Snapshot } from './snapshot.js';

/** Each git probe; they are all local reads. */
const GIT_TIMEOUT_MS = 5_000;
/** `git add` into the temporary index hashes every changed file, so it gets longer. */
const SNAPSHOT_TIMEOUT_MS = 15_000;
/** The whole check. hooks/hooks.json gives the hook 30 s, so a slow check fails open here first. */
export const CHECK_TIMEOUT_MS = 25_000;
const STDIN_TIMEOUT_MS = 2_000;
const MAX_STDIN_BYTES = 1024 * 1024;

/** The repository and revisions for one check, or why there is nothing to check. */
export type Target =
  | {
      readonly kind: 'ready';
      readonly repoRoot: string;
      readonly baseRef: string;
      readonly mergeBase: string;
      /** HEAD, or the throwaway snapshot commit when the working tree differs from HEAD. */
      readonly head: string;
      readonly dirty: boolean;
    }
  | Extract<GuardOutcome, { kind: 'skip' | 'unavailable' }>;

/**
 * Finds the repository, the default branch and merge-base(default branch, HEAD), and snapshots
 * the working tree. The check then covers merge base..snapshot: the branch's commits plus what is
 * not committed yet.
 */
export async function resolveTarget(cwd: string, env: NodeJS.ProcessEnv): Promise<Target> {
  const probe = (args: readonly string[], dir: string): Promise<string | null> => gitProbe(args, { cwd: dir, env, timeoutMs: GIT_TIMEOUT_MS });
  const repoRoot = await probe(['rev-parse', '--show-toplevel'], cwd);
  if (repoRoot === null || repoRoot === '') return { kind: 'skip', reason: 'not inside a git working tree' };
  const head = await probe(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], repoRoot);
  if (head === null) return { kind: 'skip', reason: 'the repository has no commits yet' };
  const originHead = await probe(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], repoRoot);
  const candidates = baseCandidates(originHead, env[BASE_ENV]);
  let baseRef: string | null = null;
  let baseId: string | null = null;
  for (const candidate of candidates) {
    baseId = await probe(['rev-parse', '--verify', '--quiet', '--end-of-options', `${candidate}^{commit}`], repoRoot);
    if (baseId !== null) {
      baseRef = candidate;
      break;
    }
  }
  if (baseRef === null || baseId === null) {
    return { kind: 'unavailable', message: `found no default branch to compare with (tried ${candidates.join(', ')}); set ${BASE_ENV} to the branch your work merges into.` };
  }
  const mergeBase = await probe(['merge-base', '--end-of-options', baseId, head], repoRoot);
  if (mergeBase === null) return { kind: 'unavailable', message: `HEAD shares no history with ${baseRef}.` };
  let snapshot: Snapshot;
  try {
    snapshot = await snapshotWorkingTree({ repoRoot, head, env, timeoutMs: SNAPSHOT_TIMEOUT_MS });
  } catch (error) {
    return { kind: 'unavailable', message: `could not snapshot the working tree: ${messageOf(error)}.` };
  }
  if (snapshot.commit === mergeBase) return { kind: 'skip', reason: `nothing on HEAD or in the working tree differs from ${baseRef}` };
  return { kind: 'ready', repoRoot, baseRef, mergeBase, head: snapshot.commit, dirty: snapshot.dirty };
}

function checkArgs(target: Extract<Target, { kind: 'ready' }>, json: boolean): string[] {
  const args = ['check', '--base', target.mergeBase, '--head', target.head, '--repo', target.repoRoot];
  if (json) args.push('--json');
  return args;
}

interface CheckRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the bundled CLI in process, the same engine the Action runs. */
async function runCheck(argv: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<CheckRun> {
  let stdout = '';
  let stderr = '';
  const code = await runCli(argv, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    version: 'plugin',
    env,
  });
  return { code, stdout, stderr };
}

/** Resolves to `onTimeout` if `work` has not settled within `ms`. */
export async function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout), ms);
    timer.unref();
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

const TIMED_OUT = `the check did not finish within ${CHECK_TIMEOUT_MS / 1000} s.`;

/** Runs the check for the Stop hook and returns what it found. Never throws. */
export async function stopOutcome(cwd: string, env: NodeJS.ProcessEnv, deadlineMs = CHECK_TIMEOUT_MS): Promise<GuardOutcome> {
  const work = async (): Promise<GuardOutcome> => {
    const target = await resolveTarget(cwd, env);
    if (target.kind !== 'ready') return target;
    const result = await runCheck(checkArgs(target, true), target.repoRoot, env);
    const outcome = parseCliJson(result.stdout, result.stderr);
    if (outcome.kind === 'error') return { kind: 'unavailable', message: `the check could not run: ${outcome.message}.` };
    return outcome;
  };
  try {
    return await withDeadline(work(), deadlineMs, { kind: 'unavailable', message: TIMED_OUT });
  } catch (error) {
    return { kind: 'unavailable', message: `internal error: ${messageOf(error)}.` };
  }
}

export async function runStopHook(stdin: string, env: NodeJS.ProcessEnv, fallbackCwd: string): Promise<StopHookOutput> {
  const input = parseHookInput(stdin);
  const cwd = input.cwd ?? env['CLAUDE_PROJECT_DIR'] ?? fallbackCwd;
  return decideStop(await stopOutcome(cwd, env), input, blockingEnabled(env));
}

/**
 * The on-demand check: a line saying what was compared, then the CLI's own report. Exits 0
 * whatever the verdict, because the skill reads the text, and a failing command could hide it.
 */
export async function runManualCheck(cwd: string, env: NodeJS.ProcessEnv, write: (text: string) => void): Promise<number> {
  const target = await resolveTarget(cwd, env);
  if (target.kind === 'skip') {
    write(`agent-pr-guard: nothing to check: ${target.reason}.\n`);
    return 0;
  }
  if (target.kind === 'unavailable') {
    write(`agent-pr-guard: the check did not run: ${target.message}\n`);
    return 0;
  }
  const what = target.dirty ? 'HEAD plus uncommitted and untracked files' : 'HEAD';
  write(`agent-pr-guard: comparing ${what} with ${target.baseRef} (merge base ${target.mergeBase.slice(0, 12)})\n\n`);
  const result = await withDeadline(runCheck(checkArgs(target, false), target.repoRoot, env), CHECK_TIMEOUT_MS, null);
  if (result === null) {
    write(`agent-pr-guard: ${TIMED_OUT}\n`);
    return 0;
  }
  write(result.stdout);
  if (result.stderr !== '') write(result.stderr);
  return 0;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let text = '';
    const done = (): void => {
      clearTimeout(timer);
      process.stdin.destroy();
      resolve(text);
    };
    const timer = setTimeout(done, STDIN_TIMEOUT_MS);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      text += chunk;
      if (text.length > MAX_STDIN_BYTES) done();
    });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `guard.mjs stop` (the Stop hook: reads hook input on stdin, always exits 0) or `guard.mjs check`. */
export async function main(argv: readonly string[]): Promise<number> {
  const mode = argv[0];
  if (mode === 'stop') {
    const output = await runStopHook(await readStdin(), process.env, process.cwd());
    if (Object.keys(output).length > 0) process.stdout.write(`${JSON.stringify(output)}\n`);
    return 0;
  }
  if (mode === 'check') return runManualCheck(process.cwd(), process.env, (text) => process.stdout.write(text));
  process.stderr.write('usage: guard.mjs stop|check\n');
  return 2;
}
