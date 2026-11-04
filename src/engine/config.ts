import { readFile } from 'node:fs/promises';
import type { GitReader } from '../git/reader.js';
import type { Severity } from './finding.js';
import { globToRegExp } from './glob.js';

/** The guard's own config, at the repo root. Always read from the base side, never from head. */
export const GUARD_CONFIG_PATH = '.agent-pr-guard.json';

export type SeveritySetting = 'off' | 'warning' | 'error';

export interface GuardConfig {
  /** Globs added to the built-in test-file patterns. */
  readonly testPatterns: readonly string[];
  /** Globs whose files the PR must not touch, added to the built-in protected paths. */
  readonly protectedPaths: readonly string[];
  /** Globs no rule inspects, except the protected-path rules. */
  readonly ignorePaths: readonly string[];
  /** Severity per rule id or per pack id; a rule id beats its pack. Unlisted rules take their default. */
  readonly rules: Readonly<Record<string, SeveritySetting>>;
}

export const DEFAULT_CONFIG: GuardConfig = { testPatterns: [], protectedPaths: [], ignorePaths: [], rules: {} };

/** The rule ids and pack ids a config may name, the rules whose severity is fixed, and per-rule defaults. */
export interface RuleRegistry {
  readonly ruleIds: ReadonlySet<string>;
  readonly packIds: ReadonlySet<string>;
  readonly locked: ReadonlySet<string>;
  /** Default severity per rule id; a rule not listed defaults to error. */
  readonly defaults: ReadonlyMap<string, Severity>;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const KEYS = new Set(['$schema', 'version', 'testPatterns', 'protectedPaths', 'ignorePaths', 'rules']);
const SEVERITIES = new Set<string>(['off', 'warning', 'error']);

/** Parses and validates a config. Anything unknown or malformed is an error, never ignored. */
export function parseGuardConfig(text: string, source: string, registry: RuleRegistry): GuardConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${source}: not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!isRecord(raw)) throw new ConfigError(`${source}: the config must be a JSON object`);
  for (const key of Object.keys(raw)) {
    if (!KEYS.has(key)) throw new ConfigError(`${source}: unknown key ${JSON.stringify(key)}`);
  }
  if (raw['version'] !== undefined && raw['version'] !== 1) {
    throw new ConfigError(`${source}: "version" must be 1`);
  }
  if (raw['$schema'] !== undefined && typeof raw['$schema'] !== 'string') {
    throw new ConfigError(`${source}: "$schema" must be a string`);
  }
  return {
    testPatterns: globList(raw, 'testPatterns', source),
    protectedPaths: globList(raw, 'protectedPaths', source),
    ignorePaths: globList(raw, 'ignorePaths', source),
    rules: ruleSettings(raw, source, registry),
  };
}

function globList(raw: Record<string, unknown>, key: string, source: string): string[] {
  const value = raw[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ConfigError(`${source}: "${key}" must be an array of globs`);
  return value.map((item: unknown, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new ConfigError(`${source}: "${key}"[${index}] must be a non-empty string`);
    }
    try {
      globToRegExp(item);
    } catch (error) {
      throw new ConfigError(`${source}: "${key}"[${index}] is not a valid glob (${String(error)})`);
    }
    return item;
  });
}

function ruleSettings(raw: Record<string, unknown>, source: string, registry: RuleRegistry): Record<string, SeveritySetting> {
  const value = raw['rules'];
  if (value === undefined) return {};
  if (!isRecord(value)) throw new ConfigError(`${source}: "rules" must be an object of rule id to severity`);
  const out: Record<string, SeveritySetting> = {};
  for (const [id, setting] of Object.entries(value)) {
    if (!registry.ruleIds.has(id) && !registry.packIds.has(id)) {
      throw new ConfigError(`${source}: unknown rule or pack ${JSON.stringify(id)}`);
    }
    if (typeof setting !== 'string' || !SEVERITIES.has(setting)) {
      throw new ConfigError(`${source}: "rules"."${id}" must be "off", "warning" or "error"`);
    }
    if (registry.locked.has(id)) throw new ConfigError(`${source}: the severity of ${id} cannot be changed`);
    out[id] = setting as SeveritySetting;
  }
  return out;
}

/**
 * Severity for a rule: its own setting, else its pack's (the id before the `/`), else the rule's
 * default (D15), else error.
 */
export function severityFor(ruleId: string, config: GuardConfig, registry: RuleRegistry): SeveritySetting {
  if (registry.locked.has(ruleId)) return 'error';
  const own = config.rules[ruleId];
  if (own !== undefined) return own;
  const pack = ruleId.slice(0, ruleId.indexOf('/'));
  return config.rules[pack] ?? registry.defaults.get(ruleId) ?? 'error';
}

export interface LoadedConfig {
  readonly config: GuardConfig;
  /** Where it came from, for the report: `<commit>:.agent-pr-guard.json`, a file, or `defaults`. */
  readonly source: string;
}

/** Reads the config from a commit (the PR's base). A missing file means the defaults. */
export async function loadConfigFromCommit(reader: GitReader, commit: string, registry: RuleRegistry): Promise<LoadedConfig> {
  const source = `${commit}:${GUARD_CONFIG_PATH}`;
  const text = await reader.readFileAt(commit, GUARD_CONFIG_PATH);
  if (text === null) return { config: DEFAULT_CONFIG, source: 'defaults' };
  return { config: parseGuardConfig(text, source, registry), source };
}

/** Reads a config file the caller trusts (`--config`). A missing file is an error. */
export async function loadConfigFromFile(path: string, registry: RuleRegistry): Promise<LoadedConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new ConfigError(`cannot read config ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { config: parseGuardConfig(text, path, registry), source: path };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
