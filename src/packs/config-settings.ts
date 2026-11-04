import { lastSegment } from '../engine/config-entries.js';
import type { RuleHit } from '../engine/finding.js';
import {
  boolOf,
  extras,
  groupBy,
  headLine,
  isCommand,
  listKey,
  norm,
  numberOf,
  segments,
  type ConfigFile,
  type ConfigSide,
  type Entry,
} from './config-model.js';
import { plural } from './scan.js';

// ---- config/threshold-lowered ----

type Direction = 'floor' | 'ceiling';

interface Threshold {
  readonly id: string;
  readonly kind: Direction;
  readonly metric: string;
  readonly value: number;
  readonly text: string;
  readonly line: number;
}

/** Worker, thread and retry counts: tuning, never a quality bar. */
const NEVER = /^(?:max|min)(?:workers?|concurrency|threads?|forks?|parallel|jobs|procs|processes|oldspacesize|memory|retries|fail|instances|attempts|timeout)$/;
const FLOOR_NAMES = new Set(['failunder', 'covfailunder', 'mincoverage', 'minimumcoverage', 'coverageminimum']);
const COVERAGE_METRICS = new Set(['lines', 'branches', 'functions', 'statements']);
const CEILING_NAMES = new Set([
  'maxlen',
  'maxlinelength',
  'linelength',
  'maxdoclength',
  'maxcomplexity',
  'complexity',
  'mincomplexity',
  'maxlines',
  'maxlinesperfunction',
  'maxdepth',
  'maxparams',
  'maxstatements',
  'maxnestedcallbacks',
  'maxargs',
  'maxpositionalarguments',
  'maxlocals',
  'maxreturns',
  'maxbranches',
  'maxattributes',
  'maxmodulelines',
  'maxwarnings',
  'maxboolexpr',
]);
/** Option names that carry a rule's limit: `'max-len': ['error', { code: 100 }]`. */
const LIMIT_OPTIONS = new Set(['max', 'code', 'comments', 'maximum']);
const LINT_TOOLS = new Set(['eslint', 'stylelint', 'biome', 'golangci', 'flake8', 'pylint', 'ruff', 'pycodestyle', 'pydocstyle']);
/** golangci-lint reads 0 as "no limit" for these. */
const UNLIMITED_AT_ZERO = new Set(['maxissuesperlinter', 'maxsameissues']);

const FLAGS: readonly { re: RegExp; kind: Direction; metric: string }[] = [
  { re: /--(cov-fail-under|fail-under|min-coverage)(?:=|\s+)(-?\d+(?:\.\d+)?)/g, kind: 'floor', metric: 'total' },
  { re: /--(max-warnings|max-line-length|max-complexity)(?:=|\s+)(-?\d+)/g, kind: 'ceiling', metric: '' },
];

function thresholdOf(entry: Entry): { kind: Direction; metric: string } | null {
  if (numberOf(entry.value) === null) return null;
  const segs = segments(entry.sub);
  const last = norm(segs.at(-1) ?? '');
  if (NEVER.test(last)) return null;
  if (FLOOR_NAMES.has(last)) return { kind: 'floor', metric: 'total' };
  if (entry.tool === 'codecov' && last === 'target') return { kind: 'floor', metric: 'total' };
  if (entry.tool === 'codecov' && last === 'threshold') return { kind: 'ceiling', metric: 'threshold' };
  if (COVERAGE_METRICS.has(last) && (entry.tool === 'nyc' || segs.slice(0, -1).some((s) => /threshold|coverage/.test(norm(s))))) {
    return { kind: 'floor', metric: last };
  }
  // ESLint's first list item is the rule's severity, not its limit.
  if (entry.key.endsWith('[]') && entry.position === 0 && entry.tool === 'eslint') return null;
  if (CEILING_NAMES.has(last)) return { kind: 'ceiling', metric: last };
  const owner = LIMIT_OPTIONS.has(last) ? norm(segs.at(-2) ?? '') : '';
  if (CEILING_NAMES.has(owner)) return { kind: 'ceiling', metric: owner };
  if (LINT_TOOLS.has(entry.tool) && last.startsWith('max')) return { kind: 'ceiling', metric: last };
  return null;
}

function thresholdsOf(side: ConfigSide): Threshold[] {
  const out: Threshold[] = [];
  for (const entry of side.entries) {
    const found = thresholdOf(entry);
    const value = numberOf(entry.value);
    if (found !== null && value !== null && entry.value !== null) {
      out.push({ id: entry.key, ...found, value: limitValue(found, value), text: entry.value, line: entry.line });
    }
    const commandLike = isCommand(entry, side.info) || (entry.tool === 'pytest' && norm(lastSegment(entry.key)) === 'addopts');
    if (!commandLike || entry.value === null) continue;
    for (const flag of FLAGS) {
      for (const m of entry.value.matchAll(flag.re)) {
        const name = m[1] ?? '';
        const metric = flag.metric === '' ? norm(name) : flag.metric;
        const text = m[2] ?? '';
        out.push({ id: `--${name}`, kind: flag.kind, metric, value: limitValue({ kind: flag.kind, metric }, Number(text)), text, line: entry.line });
      }
    }
  }
  return out;
}

/** A negative or zero "no limit" ceiling compares as infinitely loose. */
function limitValue(t: { kind: Direction; metric: string }, value: number): number {
  if (t.kind !== 'ceiling') return value;
  if (value < 0 || (value === 0 && UNLIMITED_AT_ZERO.has(t.metric))) return Number.POSITIVE_INFINITY;
  return value;
}

/** Coverage floors removed; ceilings only count when their default is "no limit" (`--max-warnings`). */
function removable(t: Threshold): boolean {
  return t.kind === 'floor' || t.metric === 'maxwarnings';
}

function compare(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function thresholdLabel(t: Threshold): string {
  return `${t.kind === 'floor' ? 'coverage floor' : 'lint limit'} ${t.id}`;
}

export function thresholdHits(files: readonly ConfigFile[]): RuleHit[] {
  const hits: RuleHit[] = [];
  const movedIn = addedFloors(files);
  for (const cf of files) {
    if (cf.old === null || cf.new === null) continue;
    const before = groupBy(thresholdsOf(cf.old), (t) => t.id);
    const after = groupBy(thresholdsOf(cf.new), (t) => t.id);
    for (const [id, olds] of before) {
      const strictFirst = (a: Threshold, b: Threshold): number => (a.kind === 'floor' ? compare(b.value, a.value) : compare(a.value, b.value));
      const was = [...olds].sort(strictFirst);
      const now = [...(after.get(id) ?? [])].sort(strictFirst);
      was.forEach((o, i) => {
        const n = now[i];
        if (n === undefined) {
          if (!removable(o) || movedIn.some((m) => m.metric === o.metric && m.value >= o.value)) return;
          hits.push({
            ruleId: 'config/threshold-lowered',
            file: cf.file.path,
            line: headLine(cf.file, o.line),
            reason: `${thresholdLabel(o)} (${o.text}) was removed`,
          });
        } else if (o.kind === 'floor' ? n.value < o.value : n.value > o.value) {
          hits.push({
            ruleId: 'config/threshold-lowered',
            file: cf.file.path,
            line: n.line,
            reason: `${thresholdLabel(o)} ${o.kind === 'floor' ? 'lowered' : 'raised'} from ${o.text} to ${n.text}`,
          });
        }
      });
    }
  }
  return hits;
}

/** Coverage floors that appear on the head side of a file without being there before. */
function addedFloors(files: readonly ConfigFile[]): Threshold[] {
  return files.flatMap((cf) => {
    if (cf.new === null) return [];
    const now = thresholdsOf(cf.new).filter((t) => t.kind === 'floor');
    const was = cf.old === null ? [] : thresholdsOf(cf.old).filter((t) => t.kind === 'floor');
    return extras(was, now, (t) => t.id);
  });
}

// ---- config/rule-disabled ----

const RANKS: Readonly<Record<string, number>> = {
  off: 0,
  '0': 0,
  none: 0,
  false: 0,
  null: 0,
  info: 1,
  information: 1,
  hint: 1,
  warn: 2,
  warning: 2,
  '1': 2,
  error: 3,
  '2': 3,
  true: 3,
  on: 3,
};
const TYPE_CHECKING_MODES: Readonly<Record<string, number>> = { off: 0, basic: 1, standard: 2, strict: 3, recommended: 4, all: 5 };

interface Severity {
  readonly id: string;
  readonly rank: number;
  readonly text: string;
  readonly line: number;
  /** Whether removing it can lower it: a preset may not turn the rule back on. */
  readonly removalCounts: boolean;
}

function severityOf(entry: Entry): Severity | null {
  const value = entry.value;
  if (value === null) return null;
  const sub = listKey(entry.sub);
  const listed = entry.key.endsWith('[]');
  const base = { id: listKey(entry.key), text: value, line: entry.line };
  if ((entry.tool === 'eslint' || entry.tool === 'stylelint') && /(?:^|\.)rules\.[^.]+$/.test(sub)) {
    if (listed && entry.position !== 0) return null;
    const v = value.toLowerCase();
    // A stylelint rule's first value is its option; only `null` turns it off.
    const rank = entry.tool === 'stylelint' ? (v === 'null' || v === 'false' ? 0 : 3) : RANKS[v];
    return rank === undefined ? null : { ...base, rank, removalCounts: true };
  }
  if (entry.tool === 'biome' && /(?:^|\.)linter\.rules\./.test(sub)) {
    const rank = RANKS[value.toLowerCase()];
    return rank === undefined || listed ? null : { ...base, id: base.id.replace(/\.level$/, ''), rank, removalCounts: false };
  }
  if (entry.tool === 'pyright') {
    const last = lastSegment(entry.key);
    if (/^report[A-Z]/.test(last)) {
      const rank = RANKS[value.toLowerCase()];
      return rank === undefined ? null : { ...base, rank, removalCounts: true };
    }
    if (last === 'typeCheckingMode') {
      const rank = TYPE_CHECKING_MODES[value.toLowerCase()];
      return rank === undefined ? null : { ...base, rank, removalCounts: true };
    }
  }
  return null;
}

function severityLabel(s: Severity): string {
  return s.id.replace(/^\[\]\./, '');
}

function severityHits(cf: ConfigFile): RuleHit[] {
  if (cf.old === null || cf.new === null) return [];
  const pick = (side: ConfigSide): Severity[] => side.entries.flatMap((e) => severityOf(e) ?? []);
  const before = groupBy(pick(cf.old), (s) => s.id);
  const after = groupBy(pick(cf.new), (s) => s.id);
  const hits: RuleHit[] = [];
  const ids = new Set([...before.keys(), ...after.keys()]);
  const hit = (line: number | null, reason: string, warning = false): RuleHit =>
    warning
      ? { ruleId: 'config/rule-disabled', file: cf.file.path, line, reason, severity: 'warning' }
      : { ruleId: 'config/rule-disabled', file: cf.file.path, line, reason };
  for (const id of ids) {
    const highFirst = (a: Severity, b: Severity): number => b.rank - a.rank;
    const was = [...(before.get(id) ?? [])].sort(highFirst);
    const now = [...(after.get(id) ?? [])].sort(highFirst);
    for (let i = 0; i < Math.max(was.length, now.length); i++) {
      const o = was[i];
      const n = now[i];
      if (o !== undefined && n !== undefined && n.rank < o.rank) {
        hits.push(hit(n.line, `${severityLabel(n)} lowered from ${o.text} to ${n.text}`));
      } else if (o === undefined && n !== undefined && n.rank === 0) {
        hits.push(hit(n.line, `${severityLabel(n)} turned off (${n.text})`));
      } else if (o !== undefined && n === undefined && o.removalCounts && o.rank >= 2) {
        hits.push(hit(headLine(cf.file, o.line), `${severityLabel(o)} (${o.text}) was removed; it now falls back to the shared or default setting`, true));
      }
    }
  }
  return hits;
}

interface FlagSpec {
  /** True for a flag that makes the check stricter (`strict`), false for one that relaxes it (`skipLibCheck`). */
  readonly strict: boolean;
  /** The tool's value when the key is absent. */
  readonly defaultOn: boolean;
}

const strictOff: FlagSpec = { strict: true, defaultOn: false };
const strictOn: FlagSpec = { strict: true, defaultOn: true };
const lax: FlagSpec = { strict: false, defaultOn: false };

const flagTable = (spec: FlagSpec, names: string): [string, FlagSpec][] => names.split(' ').map((n) => [n, spec]);

const TS_FLAGS = new Map<string, FlagSpec>([
  ...flagTable(
    strictOff,
    'strict noimplicitany strictnullchecks strictfunctiontypes strictbindcallapply strictpropertyinitialization strictbuiltiniteratorreturn noimplicitthis alwaysstrict useunknownincatchvariables noimplicitreturns nofallthroughcasesinswitch nouncheckedindexedaccess exactoptionalpropertytypes noimplicitoverride nopropertyaccessfromindexsignature nounusedlocals nounusedparameters checkjs',
  ),
  ...flagTable(lax, 'skiplibcheck skipdefaultlibcheck allowunreachablecode allowunusedlabels suppressimplicitanyindexerrors suppressexcesspropertyerrors noimplicitusestrict nostrictgenericchecks keyofstringsonly'),
]);

const MYPY_FLAGS = new Map<string, FlagSpec>([
  ...flagTable(
    strictOff,
    'strict disallowuntypeddefs disallowincompletedefs disallowanygenerics disallowanyunimported disallowanyexpr disallowanydecorated disallowanyexplicit disallowuntypedcalls disallowuntypeddecorators disallowsubclassingany checkuntypeddefs noimplicitoptional warnreturnany warnunusedignores warnredundantcasts warnunreachable strictequality noimplicitreexport extrachecks strictconcatenate',
  ),
  ...flagTable(strictOn, 'strictoptional'),
  ...flagTable(lax, 'ignoremissingimports ignoreerrors allowuntypedglobals allowredefinition implicitreexport implicitoptional followimports'),
]);

const PYRIGHT_FLAGS = new Map<string, FlagSpec>([
  ...flagTable(strictOff, 'strictlistinference strictdictionaryinference strictsetinference'),
  ...flagTable(strictOn, 'strictparameternonevalue analyzeunannotatedfunctions'),
]);

function flagOf(entry: Entry): FlagSpec | null {
  const last = norm(lastSegment(entry.key));
  switch (entry.tool) {
    case 'tsconfig':
      return /^compilerOptions\./.test(entry.sub) ? (TS_FLAGS.get(last) ?? null) : null;
    case 'mypy':
      return MYPY_FLAGS.get(last) ?? null;
    case 'pyright':
      return PYRIGHT_FLAGS.get(last) ?? null;
    case 'biome':
      return entry.sub === 'linter.enabled' ? strictOn : null;
    case 'golangci':
      return entry.sub === 'run.tests' ? strictOn : null;
    case 'eslint':
      return last === 'noinlineconfig' ? strictOff : null;
    default:
      return null;
  }
}

/** `follow_imports = skip` or `silent` hides errors in imported modules. */
function flagValue(entry: Entry): boolean | null {
  if (norm(lastSegment(entry.key)) === 'followimports') {
    const v = entry.value?.toLowerCase() ?? '';
    return v === 'skip' || v === 'silent';
  }
  return boolOf(entry.value);
}

function flagHits(cf: ConfigFile): RuleHit[] {
  if (cf.old === null || cf.new === null) return [];
  const pick = (side: ConfigSide): { entry: Entry; spec: FlagSpec; on: boolean }[] =>
    side.entries.flatMap((entry) => {
      const spec = flagOf(entry);
      const on = flagValue(entry);
      return spec === null || on === null ? [] : [{ entry, spec, on }];
    });
  const before = groupBy(pick(cf.old), (f) => f.entry.key);
  const after = groupBy(pick(cf.new), (f) => f.entry.key);
  const hits: RuleHit[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(key) ?? [];
    const now = after.get(key) ?? [];
    const spec = (was[0] ?? now[0])?.spec;
    if (spec === undefined) continue;
    const onCount = (list: typeof was): number => (list.length === 0 ? (spec.defaultOn ? 1 : 0) : list.filter((f) => f.on).length);
    const label = key.replace(/^compilerOptions\./, '');
    if (spec.strict && onCount(now) < onCount(was)) {
      const off = now.find((f) => !f.on);
      const first = was.find((f) => f.on);
      hits.push({
        ruleId: 'config/rule-disabled',
        file: cf.file.path,
        line: off?.entry.line ?? (first === undefined ? null : headLine(cf.file, first.entry.line)),
        reason: off === undefined ? `strict flag ${label} was removed` : `strict flag ${label} turned off`,
      });
    } else if (!spec.strict && onCount(now) > onCount(was)) {
      const on = extras(was.filter((f) => f.on), now.filter((f) => f.on), (f) => f.entry.key)[0];
      hits.push({
        ruleId: 'config/rule-disabled',
        file: cf.file.path,
        line: on?.entry.line ?? null,
        reason: `${label} turned on, which skips checks`,
      });
    }
  }
  return hits;
}

// Code lists: ignore lists that grow and enable lists that shrink.

const PY_CODE_TOOLS = new Set(['ruff', 'flake8', 'pycodestyle', 'pydocstyle']);

type ListKind = 'ignore' | 'enable';

function codeListOf(entry: Entry): ListKind | null {
  const last = norm(lastSegment(entry.key));
  const tool = entry.tool;
  if (PY_CODE_TOOLS.has(tool)) {
    if (last === 'ignore' || last === 'extendignore' || perFileGlob(entry) !== null) return 'ignore';
    if (last === 'select' || last === 'extendselect') return 'enable';
  }
  if (tool === 'pylint') return last === 'disable' ? 'ignore' : last === 'enable' ? 'enable' : null;
  if (tool === 'mypy') return last === 'disableerrorcode' ? 'ignore' : last === 'enableerrorcode' ? 'enable' : null;
  if (tool === 'golangci') return /^linters\.disable(?:\[\])?$/.test(entry.sub) ? 'ignore' : /^linters\.enable(?:\[\])?$/.test(entry.sub) ? 'enable' : null;
  if (last === 'extends' && (tool === 'eslint' || tool === 'stylelint' || tool === 'biome' || tool === 'tsconfig')) return 'enable';
  // A flat config's top-level array lists shared configs (`js.configs.recommended`) as plain items.
  if (tool === 'eslint' && entry.key === '[]') return 'enable';
  return null;
}

/** For a per-file-ignores entry, the text after the list's key: the glob in TOML and JSON. */
function perFileGlob(entry: Entry): string | null {
  const m = /(?:^|\.)(?:extend-)?per-file-ignores(?:\.(.*?))?(?:\[\])*$/.exec(entry.key.replace(/_/g, '-'));
  return m === null ? null : (m[1] ?? '');
}

interface Code {
  readonly identity: string;
  readonly list: string;
  readonly glob: string;
  readonly code: string;
  readonly line: number;
}

/** Codes in a side's ignore lists, `glob: codes` per-file lines included; codes are split on commas. */
function ignoredCodes(side: ConfigSide): Code[] {
  const out: Code[] = [];
  let lastGlob = '';
  for (const entry of side.entries) {
    if (entry.value === null || codeListOf(entry) !== 'ignore') continue;
    let glob = perFileGlob(entry);
    let text = entry.value;
    if (glob === '') {
      const m = /^([^:\s][^:]*?)\s*:\s*(.*)$/.exec(text);
      if (m !== null) {
        lastGlob = m[1] ?? '';
        text = m[2] ?? '';
      }
      glob = lastGlob;
    }
    const family = PY_CODE_TOOLS.has(entry.tool) ? 'python-lint' : entry.tool;
    for (const code of text.split(/[\s,]+/).filter((c) => c !== '')) {
      const list = glob === null ? listKey(entry.key) : `per-file-ignores for ${glob}`;
      out.push({ identity: `${family}|${glob ?? ''}|${code}`, list, glob: glob ?? '', code, line: entry.line });
    }
  }
  return out;
}

/**
 * Codes newly ignored anywhere in the change, compared across every config file, so a list moved
 * from setup.cfg to pyproject.toml is not new. An existing broader code (`E`) covers a narrower
 * new one (`E501`).
 */
function ignoredCodeHits(files: readonly ConfigFile[]): RuleHit[] {
  const before = new Map<string, Code>();
  for (const cf of files) for (const c of cf.old === null ? [] : ignoredCodes(cf.old)) before.set(c.identity, c);
  const covered = (c: Code): boolean =>
    [...before.values()].some((o) => o.glob === c.glob && o.identity.split('|')[0] === c.identity.split('|')[0] && c.code.startsWith(o.code));
  const hits: RuleHit[] = [];
  for (const cf of files) {
    if (cf.new === null) continue;
    const seen = new Set<string>();
    const fresh = ignoredCodes(cf.new).filter((c) => {
      if (seen.has(c.identity)) return false;
      seen.add(c.identity);
      return !covered(c);
    });
    for (const [list, codes] of groupBy(fresh, (c) => c.list)) {
      hits.push({
        ruleId: 'config/rule-disabled',
        file: cf.file.path,
        line: codes[0]?.line ?? null,
        reason: `${plural(codes.length, 'code')} added to ${list}: ${codes.map((c) => c.code).join(', ')}`,
      });
    }
  }
  return hits;
}

/** Items of each enable, select or extends list, per list. */
interface Enabled {
  readonly item: string;
  readonly line: number;
  /** Lint codes, where a shorter code is broader; otherwise config names, where a longer one is a variant. */
  readonly codes: boolean;
}

function enabledItems(side: ConfigSide): Map<string, Enabled[]> {
  const out = new Map<string, Enabled[]>();
  for (const entry of side.entries) {
    if (entry.value === null || codeListOf(entry) !== 'enable') continue;
    const list = listKey(entry.key) === '' ? 'the shared configs' : listKey(entry.key);
    const codes = PY_CODE_TOOLS.has(entry.tool) || entry.tool === 'pylint' || entry.tool === 'mypy';
    // A shared config spread into the list (`...expoConfig`) is the same item as `expoConfig`.
    const items = codes ? entry.value.split(/[\s,]+/) : [entry.value.replace(/^\.\.\.\s*/, '')];
    const group = out.get(list) ?? [];
    for (const item of items.filter((i) => i !== '')) group.push({ item, line: entry.line, codes });
    out.set(list, group);
  }
  return out;
}

/**
 * Enable lists compared within one file. A removed item is still covered when the head side keeps
 * a broader code (`E` for `E501`), a stricter variant of the config (`recommended` →
 * `recommended-type-checked`), or `ALL`.
 */
function shrunkListHits(cf: ConfigFile): RuleHit[] {
  if (cf.old === null || cf.new === null) return [];
  const before = enabledItems(cf.old);
  const after = enabledItems(cf.new);
  const hits: RuleHit[] = [];
  for (const [list, was] of before) {
    const now = after.get(list) ?? [];
    const kept = now.map((n) => n.item);
    const gone = was.filter(
      (o) => !kept.some((k) => k === o.item || (o.codes ? k.toUpperCase() === 'ALL' || o.item.startsWith(k) : k.startsWith(o.item))),
    );
    const first = gone[0];
    if (first === undefined) continue;
    hits.push({
      ruleId: 'config/rule-disabled',
      file: cf.file.path,
      line: now[0]?.line ?? headLine(cf.file, first.line),
      reason: `${plural(gone.length, 'item')} removed from ${list}: ${gone.map((g) => g.item).join(', ')}`,
    });
  }
  return hits;
}

export function ruleDisabledHits(files: readonly ConfigFile[]): RuleHit[] {
  return [...files.flatMap((cf) => [...severityHits(cf), ...flagHits(cf), ...shrunkListHits(cf)]), ...ignoredCodeHits(files)];
}

// ---- config/ignore-grown ----

const PATH_IGNORE_KEYS = new Set([
  'ignorepatterns',
  'ignores',
  'testpathignorepatterns',
  'coveragepathignorepatterns',
  'modulepathignorepatterns',
  'exclude',
  'extendexclude',
  'omit',
  'ignorefiles',
  'excludedirs',
  'excludefiles',
  'skipdirs',
  'skipfiles',
  'norecursedirs',
  'ignorepaths',
  'pathsignore',
  'excludepatterns',
  'testignore',
]);

const IGNORE_FLAG =
  /(?:^|\s)--(?:ignore(?:-glob|-pattern|-path)?|exclude|extend-exclude|deselect|testPathIgnorePatterns|coveragePathIgnorePatterns)(?:=|\s+)("[^"]*"|'[^']*'|\S+)/g;
/** `--ignore E501,W503` names lint codes, not paths. */
const CODE_LIST = /^[A-Z]+\d*(?:,[A-Z]+\d*)*$/;

interface Ignore {
  readonly value: string;
  readonly line: number;
}

function ignoresOf(side: ConfigSide): Ignore[] {
  const out: Ignore[] = [];
  for (const entry of side.entries) {
    const value = entry.value;
    if (value === null || value === '') continue;
    const last = norm(lastSegment(entry.key));
    const isList =
      side.info.format === 'lines'
        ? !value.startsWith('!')
        : PATH_IGNORE_KEYS.has(last) || (last === 'ignore' && !PY_CODE_TOOLS.has(entry.tool)) || ((last === 'includes' || last === 'include') && value.startsWith('!'));
    if (isList) {
      const items = side.info.format === 'ini' ? value.split(',') : [value];
      for (const item of items.map((i) => i.trim()).filter((i) => i !== '')) out.push({ value: item, line: entry.line });
    }
    if (isCommand(entry, side.info) || (entry.tool === 'pytest' && last === 'addopts')) {
      for (const m of value.matchAll(IGNORE_FLAG)) {
        const target = m[1] ?? '';
        if (!CODE_LIST.test(target)) out.push({ value: m[0].trim(), line: entry.line });
      }
    }
  }
  return out;
}

/**
 * Path ignores counted per file, so reordering or moving one within a file is not growth. A new
 * ignore file is reported as a warning: it may only list build output.
 */
export function ignoreGrownHits(files: readonly ConfigFile[]): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const cf of files) {
    if (cf.new === null) continue;
    const addedIgnoreFile = cf.old === null && cf.new.info.format === 'lines';
    if (cf.old === null && !addedIgnoreFile) continue;
    const was = cf.old === null ? [] : ignoresOf(cf.old);
    const now = ignoresOf(cf.new);
    if (now.length <= was.length) continue;
    const fresh = extras(was, now, (i) => i.value);
    const shown = fresh.slice(0, 3).map((i) => i.value);
    const more = fresh.length > 3 ? ', ...' : '';
    const hit: RuleHit = {
      ruleId: 'config/ignore-grown',
      file: cf.file.path,
      line: fresh[0]?.line ?? null,
      reason: `${plural(now.length - was.length, 'more ignored path')} (${was.length} before, ${now.length} after): ${shown.join(', ')}${more}`,
    };
    hits.push(addedIgnoreFile ? { ...hit, severity: 'warning' } : hit);
  }
  return hits;
}
