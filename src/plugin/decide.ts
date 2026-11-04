import type { JsonReport } from '../cli/report.js';
import type { Finding } from '../engine/finding.js';

/** The fields the Stop hook reads from Claude Code's hook input. */
export interface StopHookInput {
  readonly cwd: string | null;
  /** True when Claude is already continuing because a Stop hook blocked the last stop. */
  readonly stopHookActive: boolean;
}

/**
 * What the guard found for this session's repository.
 * - `skip`: nothing to check (not a git working tree, no commits, nothing differs from the base).
 * - `report`: the check ran.
 * - `unavailable`: the check could not run (no base branch, a failed snapshot, a timeout, a check error).
 */
export type GuardOutcome =
  | { readonly kind: 'skip'; readonly reason: string }
  | { readonly kind: 'report'; readonly report: JsonReport }
  | { readonly kind: 'unavailable'; readonly message: string };

/** The JSON a Stop hook prints. An empty object lets the stop go ahead silently. */
export interface StopHookOutput {
  readonly decision?: 'block';
  readonly reason?: string;
  readonly systemMessage?: string;
}

/** Findings listed in a message before it says how many more there are. */
export const MAX_LISTED = 20;

export const BASE_ENV = 'AGENT_PR_GUARD_BASE';

/** Set to `1` or `true` to let the Stop hook block a stop on error findings. Off by default (warn-only). */
export const BLOCK_ENV = 'AGENT_PR_GUARD_BLOCK';

export function blockingEnabled(env: NodeJS.ProcessEnv): boolean {
  const value = env[BLOCK_ENV]?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

/** Tolerant: input that is not the expected JSON is treated as a first stop in the hook's cwd. */
export function parseHookInput(text: string): StopHookInput {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { cwd: null, stopHookActive: false };
  }
  if (typeof value !== 'object' || value === null) return { cwd: null, stopHookActive: false };
  const record = value as Record<string, unknown>;
  const cwd = typeof record['cwd'] === 'string' && record['cwd'] !== '' ? record['cwd'] : null;
  return { cwd, stopHookActive: record['stop_hook_active'] === true };
}

/**
 * Revisions tried, in order, as the default branch: `AGENT_PR_GUARD_BASE` alone when set,
 * otherwise the branch `origin/HEAD` names, then the usual names on origin and locally.
 */
export function baseCandidates(originHead: string | null, override: string | undefined): string[] {
  if (override !== undefined && override.trim() !== '') return [override.trim()];
  const out: string[] = [];
  const remote = originHead?.trim().replace(/^refs\/remotes\//, '');
  if (remote !== undefined && remote !== '' && remote.startsWith('origin/')) out.push(remote);
  for (const name of ['origin/main', 'origin/master', 'main', 'master']) if (!out.includes(name)) out.push(name);
  return out;
}

/**
 * The Stop hook's decision. By default it is warn-only: error findings are shown to the user in
 * a message and the stop goes ahead. With `block` (opt in through AGENT_PR_GUARD_BLOCK) error
 * findings block the stop once, with the findings as the reason, so the agent fixes them before
 * it claims to be done; if they are still there when the agent stops again (`stop_hook_active`),
 * the stop goes ahead and the user is told, so a finding the agent cannot or should not fix never
 * traps the session in a loop. Anything that kept the check from running lets the stop go ahead
 * with a visible message: a broken install fails open.
 */
export function decideStop(outcome: GuardOutcome, input: StopHookInput, block = false): StopHookOutput {
  if (outcome.kind === 'skip') return {};
  if (outcome.kind === 'unavailable') return { systemMessage: `agent-pr-guard: ${outcome.message} The stop check did not run.` };
  const { report } = outcome;
  if (report.errors === 0) return {};
  if (!block) {
    // A second stop in the same turn (another hook blocked the first) must not repeat the message.
    if (input.stopHookActive) return {};
    return {
      systemMessage: `agent-pr-guard (warn-only, not blocking): ${errorCount(report)} on this branch. Review before merging:\n${listErrors(report)}\nSet ${BLOCK_ENV}=1 to block the stop until they are fixed.`,
    };
  }
  if (input.stopHookActive) {
    return {
      systemMessage: `agent-pr-guard: ${errorCount(report)} still on this branch after the agent was asked to fix them. Review before merging:\n${listErrors(report)}`,
    };
  }
  return { decision: 'block', reason: blockReason(report) };
}

export function blockReason(report: JsonReport): string {
  return [
    `agent-pr-guard: you weakened what judges you. This branch's changes since ${report.mergeBase.slice(0, 12)} (its merge base with the default branch), counting uncommitted and untracked files, have ${errorCount(report)}:`,
    listErrors(report),
    '',
    'Undo each one before you say the work is done: restore the removed or loosened assertions, un-skip the tests, put back deleted test files and protected files. The check reads the working tree, so the fix counts whether or not it is committed.',
    'If a finding is intended (a feature retired on purpose, a config change the user asked for), do not work around the guard: stop and tell the user which finding it is and why.',
  ].join('\n');
}

function listErrors(report: JsonReport): string {
  const errors = report.findings.filter((f) => f.severity === 'error');
  const lines = errors.slice(0, MAX_LISTED).map((f) => `- ${where(f)} ${f.ruleId}: ${f.reason}`);
  if (errors.length > MAX_LISTED) lines.push(`- ...and ${errors.length - MAX_LISTED} more (run /agent-pr-guard:check for the full report)`);
  return lines.join('\n');
}

function where(f: Finding): string {
  return f.line === null ? f.file : `${f.file}:${f.line}`;
}

function errorCount(report: JsonReport): string {
  return `${report.errors} error finding${report.errors === 1 ? '' : 's'}`;
}
