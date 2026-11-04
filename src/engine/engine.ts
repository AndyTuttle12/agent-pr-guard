import type { ChangeSet } from '../changeset.js';
import { analysisContext, analyzeChangeSet, type AnalyzedFile } from './analyze.js';
import { severityFor, type GuardConfig, type RuleRegistry } from './config.js';
import { compareFindings, type Finding, type RuleHit, type Severity } from './finding.js';

export interface RuleInfo {
  /** `<pack>/<name>`. */
  readonly id: string;
  readonly summary: string;
  /** Severity is always error and config cannot change it. */
  readonly locked?: boolean;
  /** Severity when config names neither the rule nor its pack; error when unset (D15). */
  readonly defaultSeverity?: Severity;
}

export interface PackContext {
  /** The changed files, without `ignorePaths` matches unless the pack sees ignored files. */
  readonly files: readonly AnalyzedFile[];
  readonly config: GuardConfig;
  /** The CODEOWNERS locations that exist at the merge base (`ChangeSet.baseCodeowners`). */
  readonly baseCodeowners: readonly string[];
}

export interface RulePack {
  readonly id: string;
  readonly rules: readonly RuleInfo[];
  /** Protected-path packs judge every file, `ignorePaths` included. */
  readonly seesIgnoredFiles?: boolean;
  check(ctx: PackContext): RuleHit[];
}

export function buildRegistry(packs: readonly RulePack[]): RuleRegistry {
  const ruleIds = new Set<string>();
  const packIds = new Set<string>();
  const locked = new Set<string>();
  const defaults = new Map<string, Severity>();
  for (const pack of packs) {
    if (packIds.has(pack.id)) throw new Error(`duplicate pack ${pack.id}`);
    packIds.add(pack.id);
    for (const rule of pack.rules) {
      if (!rule.id.startsWith(`${pack.id}/`)) throw new Error(`rule ${rule.id} is not in pack ${pack.id}`);
      if (ruleIds.has(rule.id)) throw new Error(`duplicate rule ${rule.id}`);
      ruleIds.add(rule.id);
      if (rule.locked === true) locked.add(rule.id);
      if (rule.defaultSeverity !== undefined) {
        if (rule.locked === true && rule.defaultSeverity !== 'error') throw new Error(`locked rule ${rule.id} must default to error`);
        defaults.set(rule.id, rule.defaultSeverity);
      }
    }
  }
  return { ruleIds, packIds, locked, defaults };
}

export interface Report {
  readonly base: string;
  readonly head: string;
  readonly mergeBase: string;
  readonly findings: readonly Finding[];
  readonly errors: number;
  readonly warnings: number;
  /** True when no finding has severity error. */
  readonly passed: boolean;
}

/** Runs every pack over the change set and applies the configured severities. */
export function evaluate(changeSet: ChangeSet, config: GuardConfig, packs: readonly RulePack[]): Report {
  const registry = buildRegistry(packs);
  const files = analyzeChangeSet(changeSet, analysisContext(config));
  const inspected = files.filter((f) => !f.ignored);
  const findings: Finding[] = [];
  for (const pack of packs) {
    const known = new Set(pack.rules.map((r) => r.id));
    const seen = pack.seesIgnoredFiles === true ? files : inspected;
    const ctx: PackContext = { files: seen, config, baseCodeowners: changeSet.baseCodeowners };
    for (const hit of pack.check(ctx)) {
      if (!known.has(hit.ruleId)) throw new Error(`pack ${pack.id} reported unknown rule ${hit.ruleId}`);
      const configured = severityFor(hit.ruleId, config, registry);
      if (configured === 'off') continue;
      const capped = hit.severity === 'warning' && !registry.locked.has(hit.ruleId);
      const { ruleId, file, line, reason } = hit;
      findings.push({ ruleId, file, line, reason, severity: capped ? 'warning' : configured });
    }
  }
  const unique = dedupeFindings(findings);
  const errors = unique.filter((f) => f.severity === 'error').length;
  return {
    base: changeSet.base,
    head: changeSet.head,
    mergeBase: changeSet.mergeBase,
    findings: unique,
    errors,
    warnings: unique.length - errors,
    passed: errors === 0,
  };
}

/**
 * Sorted findings with one per (rule, file, line, reason): a rule that reaches the same line by
 * two routes reports it once, at the higher of the severities.
 */
export function dedupeFindings(findings: readonly Finding[]): Finding[] {
  const byKey = new Map<string, Finding>();
  for (const finding of findings) {
    const key = JSON.stringify([finding.ruleId, finding.file, finding.line, finding.reason]);
    const seen = byKey.get(key);
    if (seen === undefined || (seen.severity === 'warning' && finding.severity === 'error')) byKey.set(key, finding);
  }
  return [...byKey.values()].sort(compareFindings);
}
