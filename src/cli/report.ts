import type { ChangeSet, SkipReason } from '../changeset.js';
import type { Report } from '../engine/engine.js';
import type { Finding } from '../engine/finding.js';
import { exceeds, type FailOn } from './fail-on.js';

/** Bumped only when a field is removed or changes meaning; new fields may appear in any version. */
export const JSON_SCHEMA_VERSION = 1;

export type Verdict = 'pass' | 'fail';

export interface UninspectedFile {
  readonly file: string;
  readonly reason: SkipReason;
}

export interface CheckResult {
  readonly report: Report;
  readonly configSource: string;
  readonly uninspected: readonly UninspectedFile[];
}

export interface JsonReport {
  readonly version: number;
  readonly base: string;
  readonly head: string;
  readonly mergeBase: string;
  readonly config: string;
  readonly verdict: Verdict;
  readonly errors: number;
  readonly warnings: number;
  readonly findings: readonly Finding[];
  readonly uninspected: readonly UninspectedFile[];
}

const REASON_TEXT: Readonly<Record<SkipReason, string>> = {
  binary: 'binary',
  'too-large': 'too large',
  submodule: 'submodule',
};

/** Every changed file whose content the reader did not read, whether or not a rule cared. */
export function uninspectedFiles(changeSet: ChangeSet): UninspectedFile[] {
  const out: UninspectedFile[] = [];
  for (const file of changeSet.files) {
    const reason = file.old?.skipped ?? file.new?.skipped;
    if (reason !== undefined) out.push({ file: file.path, reason });
  }
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

export function verdictOf(report: Report): Verdict {
  return report.passed ? 'pass' : 'fail';
}

export function toJsonReport({ report, configSource, uninspected }: CheckResult): JsonReport {
  return {
    version: JSON_SCHEMA_VERSION,
    base: report.base,
    head: report.head,
    mergeBase: report.mergeBase,
    config: configSource,
    verdict: verdictOf(report),
    errors: report.errors,
    warnings: report.warnings,
    findings: report.findings.map(({ ruleId, severity, file, line, reason }) => ({ ruleId, severity, file, line, reason })),
    uninspected,
  };
}

export function formatJson(result: CheckResult): string {
  return `${JSON.stringify(toJsonReport(result), null, 2)}\n`;
}

export function formatJsonError(message: string): string {
  return `${JSON.stringify({ version: JSON_SCHEMA_VERSION, verdict: 'error', error: message }, null, 2)}\n`;
}

/** Findings grouped by file, then the files not inspected, then a one-line verdict. */
export function formatHuman({ report, configSource, uninspected }: CheckResult, failOn: FailOn): string {
  const lines: string[] = [
    `agent-pr-guard: ${short(report.mergeBase)}..${short(report.head)} (base ${short(report.base)}), config: ${describeConfig(configSource, report.base)}`,
  ];
  for (const [file, findings] of groupByFile(report.findings)) {
    lines.push('', file);
    for (const f of findings) {
      const where = f.line === null ? 'file' : `line ${f.line}`;
      lines.push(`  ${where.padEnd(9)} ${f.severity.padEnd(7)} ${f.ruleId}: ${f.reason}`);
    }
  }
  if (uninspected.length > 0) {
    lines.push('', 'Not inspected (content not read):');
    for (const u of uninspected) lines.push(`  ${u.file} (${REASON_TEXT[u.reason]})`);
  }
  lines.push('', verdictLine(report, failOn));
  return `${lines.join('\n')}\n`;
}

function verdictLine(report: Report, failOn: FailOn): string {
  const files = new Set(report.findings.map((f) => f.file)).size;
  const counts = `${plural(report.errors, 'error')}, ${plural(report.warnings, 'warning')} in ${plural(files, 'file')}`;
  if (exceeds(report, failOn)) return `FAIL: ${counts}.`;
  if (report.errors > 0) return `FINDINGS (warn-only, exit 0): ${counts}. Pass --fail-on error to exit 1 on these.`;
  if (report.warnings > 0) return `PASS with warnings: ${counts}.`;
  return 'PASS: no findings.';
}

function groupByFile(findings: readonly Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const group = groups.get(f.file);
    if (group === undefined) groups.set(f.file, [f]);
    else group.push(f);
  }
  return groups;
}

function describeConfig(source: string, base: string): string {
  const prefix = `${base}:`;
  return source.startsWith(prefix) ? `${source.slice(prefix.length)} at base` : source;
}

function short(oid: string): string {
  return oid.slice(0, 12);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
