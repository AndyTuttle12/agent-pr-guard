export type Severity = 'error' | 'warning';

/**
 * One weakening the guard found. `file` is the head-side path (the base-side path for a deleted
 * file). `line` is a 1-based line in the head-side file, or null when the finding is about the
 * file as a whole (a deletion, a rename, a protected path).
 */
export interface Finding {
  readonly ruleId: string;
  readonly file: string;
  readonly line: number | null;
  readonly reason: string;
  readonly severity: Severity;
}

/**
 * What a rule reports; the engine adds the severity from config. A hit may set `severity` to
 * `warning` to lower itself when the rule judges this instance probably honest. It can never
 * raise a severity: config `off` still mutes it, and a locked rule stays an error.
 */
export interface RuleHit {
  readonly ruleId: string;
  readonly file: string;
  readonly line: number | null;
  readonly reason: string;
  /**
   * Caps this hit's severity below the configured one, for a case the rule judges less likely to
   * be a weakening. A rule set to `off` stays off, and a locked rule ignores the cap.
   */
  readonly severity?: Severity;
}

export function compareFindings(a: Finding, b: Finding): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  const la = a.line ?? 0;
  const lb = b.line ?? 0;
  if (la !== lb) return la - lb;
  if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
  return a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0;
}
