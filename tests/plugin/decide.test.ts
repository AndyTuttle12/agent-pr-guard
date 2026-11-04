import { describe, expect, it } from 'vitest';
import type { JsonReport } from '../../src/cli/report.js';
import type { Finding } from '../../src/engine/finding.js';
import { baseCandidates, blockingEnabled, BLOCK_ENV, blockReason, decideStop, MAX_LISTED, parseHookInput, type GuardOutcome, type StopHookInput } from '../../src/plugin/decide.js';

const FIRST_STOP: StopHookInput = { cwd: '/repo', stopHookActive: false };
const SECOND_STOP: StopHookInput = { cwd: '/repo', stopHookActive: true };

const REMOVED: Finding = { ruleId: 'assertion/removed', severity: 'error', file: 'src/math.test.ts', line: 6, reason: '1 assertion removed (2 before, 1 after)' };
const DELETED: Finding = { ruleId: 'test-deletion/deleted', severity: 'error', file: 'src/old.test.ts', line: null, reason: 'test file deleted' };
const WARNING: Finding = { ruleId: 'test-deletion/deleted', severity: 'warning', file: 'src/gone.test.ts', line: null, reason: 'test file deleted with src/gone.ts' };

function report(findings: readonly Finding[]): GuardOutcome {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const value: JsonReport = {
    version: 1,
    base: 'a'.repeat(40),
    head: 'b'.repeat(40),
    mergeBase: 'c'.repeat(40),
    config: 'defaults',
    verdict: errors > 0 ? 'fail' : 'pass',
    errors,
    warnings: findings.length - errors,
    findings,
    uninspected: [],
  };
  return { kind: 'report', report: value };
}

function reportOf(outcome: GuardOutcome): JsonReport {
  if (outcome.kind !== 'report') throw new Error('not a report');
  return outcome.report;
}

describe('parseHookInput', () => {
  it('reads cwd and stop_hook_active', () => {
    expect(parseHookInput(JSON.stringify({ session_id: 's', hook_event_name: 'Stop', cwd: '/w', stop_hook_active: true }))).toEqual({ cwd: '/w', stopHookActive: true });
  });

  it('treats only a literal true as an active stop hook', () => {
    expect(parseHookInput(JSON.stringify({ cwd: '/w', stop_hook_active: 'true' })).stopHookActive).toBe(false);
    expect(parseHookInput(JSON.stringify({ cwd: '/w' })).stopHookActive).toBe(false);
  });

  it.each(['', 'not json', 'null', '[]', '42', JSON.stringify({ cwd: '' }), JSON.stringify({ cwd: 7 })])('falls back to no cwd and a first stop for %j', (text) => {
    expect(parseHookInput(text)).toEqual({ cwd: null, stopHookActive: false });
  });
});

describe('baseCandidates', () => {
  it('uses the override alone, trimmed', () => {
    expect(baseCandidates('refs/remotes/origin/main', ' develop ')).toEqual(['develop']);
  });

  it('ignores a blank override', () => {
    expect(baseCandidates(null, '  ')).toEqual(['origin/main', 'origin/master', 'main', 'master']);
  });

  it('tries the branch origin/HEAD names first, without repeating it', () => {
    expect(baseCandidates('refs/remotes/origin/master\n', undefined)).toEqual(['origin/master', 'origin/main', 'main', 'master']);
    expect(baseCandidates('refs/remotes/origin/trunk', undefined)).toEqual(['origin/trunk', 'origin/main', 'origin/master', 'main', 'master']);
  });

  it('ignores an origin/HEAD that points outside origin', () => {
    expect(baseCandidates('refs/remotes/upstream/main', undefined)).toEqual(['origin/main', 'origin/master', 'main', 'master']);
  });
});

describe('decideStop', () => {
  it('lets the stop go ahead silently when there is nothing to check', () => {
    expect(decideStop({ kind: 'skip', reason: 'not inside a git working tree' }, FIRST_STOP)).toEqual({});
  });

  it('lets the stop go ahead silently on a pass, even with warnings', () => {
    expect(decideStop(report([]), FIRST_STOP)).toEqual({});
    expect(decideStop(report([WARNING]), FIRST_STOP)).toEqual({});
  });

  it('fails open with a visible message when the check could not run', () => {
    const out = decideStop({ kind: 'unavailable', message: 'the check did not finish within 25 s.' }, FIRST_STOP);
    expect(out.decision).toBeUndefined();
    expect(out.systemMessage).toBe('agent-pr-guard: the check did not finish within 25 s. The stop check did not run.');
  });

  it('is warn-only by default: an error finding is shown to the user and the stop goes ahead', () => {
    const out = decideStop(report([REMOVED, WARNING]), FIRST_STOP);
    expect(out.decision).toBeUndefined();
    expect(out.reason).toBeUndefined();
    expect(out.systemMessage).toContain('warn-only, not blocking');
    expect(out.systemMessage).toContain('1 error finding on this branch');
    expect(out.systemMessage).toContain('- src/math.test.ts:6 assertion/removed: 1 assertion removed (2 before, 1 after)');
    expect(out.systemMessage).toContain(`${BLOCK_ENV}=1`);
    expect(out.systemMessage).not.toContain('src/gone.test.ts');
  });

  it('does not repeat the warn-only message on a second stop in the same turn', () => {
    expect(decideStop(report([REMOVED]), SECOND_STOP)).toEqual({});
  });

  it('blocks the first stop on an error finding when blocking is opted in, with the findings as the reason', () => {
    const outcome = report([REMOVED, WARNING]);
    const out = decideStop(outcome, FIRST_STOP, true);
    expect(out).toEqual({ decision: 'block', reason: blockReason(reportOf(outcome)) });
    expect(out.reason).toContain('- src/math.test.ts:6 assertion/removed: 1 assertion removed (2 before, 1 after)');
    expect(out.reason).toContain('1 error finding:');
    expect(out.reason).not.toContain('src/gone.test.ts');
  });

  it('lets a repeated stop go ahead and tells the user, so a finding never traps the session', () => {
    const out = decideStop(report([REMOVED, DELETED]), SECOND_STOP, true);
    expect(out.decision).toBeUndefined();
    expect(out.systemMessage).toContain('2 error findings still on this branch');
    expect(out.systemMessage).toContain('- src/old.test.ts test-deletion/deleted: test file deleted');
  });
});

describe('blockingEnabled', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['0', false],
    ['no', false],
    ['1', true],
    ['true', true],
    [' TRUE ', true],
  ])('reads %j as %s', (value, expected) => {
    expect(blockingEnabled(value === undefined ? {} : { [BLOCK_ENV]: value })).toBe(expected);
  });
});

describe('blockReason', () => {
  it('names the merge base and says uncommitted work counts', () => {
    const text = blockReason(reportOf(report([DELETED])));
    expect(text).toContain('since cccccccccccc (its merge base with the default branch)');
    expect(text).toContain('uncommitted and untracked files');
    expect(text).toContain('do not work around the guard');
  });

  it(`lists at most ${MAX_LISTED} findings and counts the rest`, () => {
    const many = Array.from({ length: MAX_LISTED + 3 }, (_, i): Finding => ({ ...REMOVED, line: i + 1 }));
    const text = blockReason(reportOf(report(many)));
    expect(text.match(/^- src\/math\.test\.ts:/gm)).toHaveLength(MAX_LISTED);
    expect(text).toContain('- ...and 3 more (run /agent-pr-guard:check for the full report)');
    expect(text).toContain(`${MAX_LISTED + 3} error findings:`);
  });
});
