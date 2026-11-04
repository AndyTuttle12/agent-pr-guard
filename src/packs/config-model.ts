import type { AnalyzedFile, SideView } from '../engine/analyze.js';
import { lastSegment, readEntries, type ConfigEntry } from '../engine/config-entries.js';
import { configFileInfo, type ConfigFileInfo } from '../engine/config-files.js';
import { anchorLine } from '../engine/line-diff.js';

/** A config entry with the tool it configures and its place in the lists around it. */
export interface Entry extends ConfigEntry {
  /**
   * The tool the key configures: the file's family, or for a shared project file (pyproject.toml,
   * setup.cfg, tox.ini, package.json) the tool whose section holds the key.
   */
  readonly tool: string;
  /** The key below the tool's own section: `tool.ruff.lint.ignore[]` → `lint.ignore[]`. */
  readonly sub: string;
  /** For a direct list item, its 0-based position in its list; otherwise null. */
  readonly position: number | null;
  /** The key with each YAML list item numbered (`jobs.test.steps[2].run`); other formats keep `[]`. */
  readonly indexed: string;
}

export interface ConfigSide {
  readonly info: ConfigFileInfo;
  readonly entries: readonly Entry[];
}

/** A changed config file whose present sides could all be read. */
export interface ConfigFile {
  readonly file: AnalyzedFile;
  /** Null when the side is absent or is not a config file. */
  readonly old: ConfigSide | null;
  readonly new: ConfigSide | null;
}

/** False when a side exists but its content was not read: such a file is never compared. */
export function readable(file: AnalyzedFile): boolean {
  return (file.oldPath === null || file.old !== null) && (file.newPath === null || file.new !== null);
}

/** The changed config files, each with its entries on both sides; unreadable files are left out. */
export function configFiles(files: readonly AnalyzedFile[]): ConfigFile[] {
  const out: ConfigFile[] = [];
  for (const file of files) {
    if (!readable(file)) continue;
    const old = configSide(file.old);
    const neu = configSide(file.new);
    if (old !== null || neu !== null) out.push({ file, old, new: neu });
  }
  return out;
}

function configSide(view: SideView | null): ConfigSide | null {
  if (view === null) return null;
  const info = configFileInfo(view.path);
  if (info === null) return null;
  return { info, entries: annotate(readEntries(view.codeWithStrings, info.format), info, view.codeWithStrings) };
}

function annotate(entries: readonly ConfigEntry[], info: ConfigFileInfo, lines: readonly string[]): Entry[] {
  const positions = new Map<string, number>();
  const items = new Map<string, number>();
  return entries.map((entry) => {
    let position: number | null = null;
    if (entry.key.endsWith('[]')) {
      position = positions.get(entry.key) ?? 0;
      positions.set(entry.key, position + 1);
    } else {
      positions.delete(`${entry.key}[]`);
    }
    const indexed = info.format === 'yaml' ? numberItems(entry, lines[entry.line - 1] ?? '', items) : entry.key;
    return { ...entry, ...scopeOf(info.family, entry.key), position, indexed };
  });
}

/**
 * Numbers YAML list items: a line that starts with `-` and holds this entry opens a new item of
 * the entry's innermost list. Block-scalar lines that happen to start with `-` do not, since
 * their text is not the entry's key.
 */
function numberItems(entry: ConfigEntry, text: string, items: Map<string, number>): string {
  const parts = entry.key.split('[]');
  const trimmed = text.trimStart();
  const rest = trimmed.replace(/^-\s*/, '');
  const segment = lastSegment(entry.key);
  const opens =
    trimmed.startsWith('-') &&
    (entry.key.endsWith('[]') || rest.startsWith(`${segment}:`) || rest.startsWith(`"${segment}"`) || rest.startsWith(`'${segment}'`) || rest.startsWith(`${segment} `));
  let indexed = parts[0] ?? '';
  for (let i = 1; i < parts.length; i++) {
    const innermost = i === parts.length - 1;
    if (innermost && opens) items.set(indexed, (items.get(indexed) ?? -1) + 1);
    indexed += `[${Math.max(items.get(indexed) ?? 0, 0)}]${parts[i] ?? ''}`;
  }
  return indexed;
}

const PYPROJECT_TOOLS: Readonly<Record<string, string>> = { basedpyright: 'pyright' };

const PACKAGE_JSON_TOOLS: Readonly<Record<string, string>> = {
  eslintConfig: 'eslint',
  jest: 'jest',
  nyc: 'nyc',
  c8: 'nyc',
  stylelint: 'stylelint',
  scripts: 'scripts',
  mocha: 'mocha',
};

const INI_SECTIONS: readonly [RegExp, string][] = [
  [/^flake8\b/i, 'flake8'],
  [/^(?:pycodestyle|pep8)\b/i, 'pycodestyle'],
  [/^pydocstyle\b/i, 'pydocstyle'],
  [/^pylint/i, 'pylint'],
  [/^mypy\b/i, 'mypy'],
  [/^(?:tool:)?pytest\b/i, 'pytest'],
  [/^coverage:/i, 'coverage'],
  [/^(?:testenv|tox)\b/i, 'tox'],
];

export function scopeOf(family: string, key: string): { tool: string; sub: string } {
  switch (family) {
    case 'pyproject': {
      const m = /^tool\.([^.[\]]+)(?:\.(.*))?$/.exec(key);
      if (m === null) return { tool: 'pyproject', sub: key };
      const name = m[1] ?? '';
      return { tool: PYPROJECT_TOOLS[name] ?? name, sub: m[2] ?? '' };
    }
    case 'setup-cfg':
    case 'tox': {
      const match = INI_SECTIONS.find(([re]) => re.test(key));
      return { tool: match?.[1] ?? family, sub: key };
    }
    case 'package-json': {
      const m = /^([^.[\]]+)(?:\.(.*))?$/.exec(key);
      const tool = m === null ? undefined : PACKAGE_JSON_TOOLS[m[1] ?? ''];
      return tool === undefined ? { tool: family, sub: key } : { tool, sub: m?.[2] ?? '' };
    }
    default:
      return { tool: family, sub: key };
  }
}

const COMMAND_KEYS = new Set(['run', 'script', 'scripts', 'beforescript', 'command', 'commands', 'cmd', 'entry', 'uses', 'bash', 'sh', 'pwsh', 'powershell']);

/**
 * An entry whose value is a command line: a CI or hook step's `run`/`script`/`command`, a
 * Makefile recipe line, a husky hook line, a package.json script, a tox `commands` line.
 */
export function isCommand(entry: Entry, info: ConfigFileInfo): boolean {
  if (entry.value === null || entry.value === '') return false;
  if (info.format === 'make' || info.format === 'shell') return true;
  if (entry.tool === 'scripts') return true;
  const last = norm(lastSegment(entry.key));
  if (entry.tool === 'tox') return last === 'commands';
  if (info.category === 'ci' || info.category === 'hooks') return COMMAND_KEYS.has(last) || (info.family === 'pre-commit' && last === 'id');
  return false;
}

/** A command line without the prefix that tells make (`@`, `-`, `+`) or tox (`-`) how to run it. */
export function commandBody(entry: Entry, info: ConfigFileInfo): string {
  const value = entry.value ?? '';
  if (info.format === 'make') return value.replace(/^[@+-]+\s*/, '');
  if (entry.tool === 'tox') return value.replace(/^-\s*/, '');
  return value;
}

/** A key segment folded for matching: `max_line-length`, `maxLineLength` → `maxlinelength`. */
export function norm(segment: string): string {
  return segment.replace(/[-_\s]/g, '').toLowerCase();
}

/** The key's segments, list marks dropped: `rules.max-len[].code` → `rules`, `max-len`, `code`. */
export function segments(key: string): string[] {
  return key
    .replace(/\[\d*\]/g, '')
    .split('.')
    .filter((s) => s !== '');
}

/** The key with its trailing list marks removed, so a scalar and a list of one compare alike. */
export function listKey(key: string): string {
  return key.replace(/(?:\[\])+$/, '');
}

export function numberOf(value: string | null): number | null {
  if (value === null) return null;
  const m = /^(-?\d+(?:\.\d+)?)%?$/.exec(value.trim());
  return m === null ? null : Number(m[1]);
}

export function boolOf(value: string | null): boolean | null {
  if (value === null) return null;
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === 'yes' || v === 'on' || v === '1') return true;
  if (v === 'false' || v === 'no' || v === 'off' || v === '0') return false;
  return null;
}

/**
 * The head-side line a finding about a base-side line should point at: the line itself if it
 * survived, else where its hunk now sits. Null when the file has no head side or is empty.
 */
export function headLine(file: AnalyzedFile, oldLine: number): number | null {
  const count = file.new?.lines.length ?? 0;
  if (file.new === null || count === 0) return null;
  let delta = 0;
  for (const hunk of file.hunks) {
    const first = hunk.removed[0]?.line;
    const last = hunk.removed.at(-1)?.line;
    if (first !== undefined && last !== undefined && oldLine >= first && oldLine <= last) return anchorLine(hunk, count);
    if (oldLine < hunk.oldStart) break;
    delta += hunk.added.length - hunk.removed.length;
  }
  return Math.min(Math.max(oldLine + delta, 1), count);
}

/** The items of `after` beyond those `before` already had, matched by key, in order. */
export function extras<T>(before: readonly T[], after: readonly T[], keyOf: (item: T) => string): T[] {
  const counts = new Map<string, number>();
  for (const item of before) counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1);
  const out: T[] = [];
  for (const item of after) {
    const k = keyOf(item);
    const left = counts.get(k) ?? 0;
    if (left > 0) counts.set(k, left - 1);
    else out.push(item);
  }
  return out;
}

export function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = keyOf(item);
    const group = out.get(k);
    if (group === undefined) out.set(k, [item]);
    else group.push(item);
  }
  return out;
}
