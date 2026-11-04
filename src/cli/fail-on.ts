/**
 * What makes a check exit non-zero. The default is `none`: findings are reported and the check
 * still exits 0, so installing the tool never blocks a pull request. Blocking is opt-in.
 */
export type FailOn = 'none' | 'error' | 'warning';

export const DEFAULT_FAIL_ON: FailOn = 'none';

export const FAIL_ON_VALUES: readonly FailOn[] = ['none', 'error', 'warning'];

/** Parses a `--fail-on` or `fail-on` value. Anything else is null, never a guess. */
export function parseFailOn(value: string): FailOn | null {
  const normalized = value.toLowerCase();
  return FAIL_ON_VALUES.find((v) => v === normalized) ?? null;
}

/** True when a report with these counts should make the check fail under `failOn`. */
export function exceeds(counts: { readonly errors: number; readonly warnings: number }, failOn: FailOn): boolean {
  if (failOn === 'none') return false;
  return counts.errors > 0 || (failOn === 'warning' && counts.warnings > 0);
}
