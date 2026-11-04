import type { JsonReport } from './report.js';

/** What one `check --json` run produced: a report (exit 0 or 1), or why the check could not run (exit 2). */
export type CheckOutcome = { readonly kind: 'report'; readonly report: JsonReport } | { readonly kind: 'error'; readonly message: string };

const UNKNOWN_FORMAT = 'the check printed a report in an unknown format';

/**
 * Reads the CLI's `--json` output, for the surfaces that wrap the CLI (the GitHub Action and the
 * Claude Code plugin). Anything that is not a schema version 1 report is an error, never a pass.
 */
export function parseCliJson(stdout: string, stderr: string): CheckOutcome {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return { kind: 'error', message: firstLine(stderr) ?? 'the check printed no JSON report' };
  }
  if (!isRecord(value) || value['version'] !== 1) return { kind: 'error', message: UNKNOWN_FORMAT };
  if (value['verdict'] === 'error') {
    return { kind: 'error', message: typeof value['error'] === 'string' ? value['error'] : 'the check could not run' };
  }
  const passOrFail = value['verdict'] === 'pass' || value['verdict'] === 'fail';
  const counts = typeof value['errors'] === 'number' && typeof value['warnings'] === 'number';
  if (passOrFail && counts && Array.isArray(value['findings']) && Array.isArray(value['uninspected'])) {
    return { kind: 'report', report: value as unknown as JsonReport };
  }
  return { kind: 'error', message: UNKNOWN_FORMAT };
}

function firstLine(text: string): string | null {
  const line = text.split('\n').find((l) => l.trim() !== '');
  return line === undefined ? null : line.replace(/^agent-pr-guard: /, '').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
