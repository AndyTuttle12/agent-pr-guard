import { exceeds } from '../cli/fail-on.js';
import type { CheckOutcome } from '../cli/json-outcome.js';
import type { Finding } from '../engine/finding.js';
import type { FailOn } from './inputs.js';

/** GitHub truncates a step summary over 1 MiB; past this many rows the table stops and says how many it left out. */
export const MAX_SUMMARY_ROWS = 500;

/**
 * True when the step should fail: the check could not run (a broken setup is never a silent
 * pass), or a finding reaches `failOn`. With the default `none` no finding ever fails the step.
 */
export function shouldFail(outcome: CheckOutcome, failOn: FailOn): boolean {
  if (outcome.kind === 'error') return true;
  return exceeds(outcome.report, failOn);
}

/**
 * One workflow command per finding, so each shows on the PR's changed-files view. When the step
 * is warn-only an error finding is annotated as a warning, so the PR does not show red for a
 * check that cannot fail it.
 */
export function annotations(findings: readonly Finding[], failOn: FailOn): string[] {
  return findings.map((f) => {
    const props = [`file=${escapeProperty(f.file)}`];
    if (f.line !== null) props.push(`line=${f.line}`);
    props.push(`title=${escapeProperty(`agent-pr-guard ${f.ruleId}`)}`);
    const level = f.severity === 'error' && failOn !== 'none' ? 'error' : 'warning';
    return `::${level} ${props.join(',')}::${escapeData(f.reason)}`;
  });
}

/** The job summary as GitHub-flavored Markdown. */
export function renderSummary(outcome: CheckOutcome, failOn: FailOn): string {
  if (outcome.kind === 'error') {
    return ['## agent-pr-guard: could not run', '', `The check did not run, so it did not pass: ${inline(outcome.message)}`, ''].join('\n');
  }
  const r = outcome.report;
  const failed = shouldFail(outcome, failOn);
  const title = failed ? 'FAIL' : r.errors > 0 ? 'FINDINGS (warn-only)' : r.warnings > 0 ? 'PASS with warnings' : 'PASS';
  const lines = [
    `## agent-pr-guard: ${title}`,
    '',
    `${count(r.errors, 'error')}, ${count(r.warnings, 'warning')} in \`${r.mergeBase.slice(0, 12)}..${r.head.slice(0, 12)}\` (config: ${inline(r.config)}, fails on: ${failOn === 'none' ? 'nothing, warn-only' : failOn}).`,
  ];
  if (r.findings.length > 0) {
    lines.push('', '| Severity | Rule | File | Line | Reason |', '|---|---|---|---|---|');
    for (const f of r.findings.slice(0, MAX_SUMMARY_ROWS)) {
      lines.push(`| ${f.severity} | ${code(f.ruleId)} | ${code(f.file)} | ${f.line ?? 'file'} | ${cell(f.reason)} |`);
    }
    const left = r.findings.length - MAX_SUMMARY_ROWS;
    if (left > 0) lines.push('', `${count(left, 'more finding')} not shown; the annotations and the CLI's \`--json\` output list them all.`);
  }
  if (r.uninspected.length > 0) {
    lines.push('', '**Not inspected** (content not read):', '');
    for (const u of r.uninspected.slice(0, MAX_SUMMARY_ROWS)) lines.push(`- ${code(u.file)} (${u.reason})`);
  }
  lines.push('');
  return lines.join('\n');
}

/** `name=value` lines for `$GITHUB_OUTPUT`. Every value is a fixed word or a number. */
export function outputs(outcome: CheckOutcome): string {
  if (outcome.kind === 'error') return 'verdict=error\nerrors=0\nwarnings=0\n';
  const { verdict, errors, warnings } = outcome.report;
  return `verdict=${verdict}\nerrors=${errors}\nwarnings=${warnings}\n`;
}

/** The toolkit's escaping for a workflow command's message. */
export function escapeData(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** The toolkit's escaping for a workflow command property value. */
export function escapeProperty(text: string): string {
  return escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/** Text for one table cell: HTML-escaped, pipes escaped, on one line. */
function cell(text: string): string {
  return inline(text).replace(/\|/g, '\\|');
}

function inline(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, ' ');
}

/**
 * A code span inside a table cell: its content is literal (no HTML), so only pipes (which end the
 * cell even here) are escaped, and the fence is longer than any backtick run in the text.
 */
function code(text: string): string {
  const body = text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
  const longestRun = Math.max(0, ...(body.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longestRun + 1);
  const pad = longestRun > 0 ? ' ' : '';
  return `${fence}${pad}${body}${pad}${fence}`;
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
