import type { AnalyzedFile } from '../engine/analyze.js';
import { lastSegment } from '../engine/config-entries.js';
import type { RuleHit } from '../engine/finding.js';
import { SWALLOWED } from './config-commands.js';
import { gatesIn, isScript } from './config-removed.js';
import { boolOf, commandBody, extras, headLine, isCommand, norm, readable, type ConfigFile, type ConfigSide, type Entry } from './config-model.js';

/** One gate, or one command in a gate's place, that a change can no longer make fail. */
interface Softened {
  /** What softens it: `continue-on-error: true`, `if: false`, `|| true`, `'-' prefix`. */
  readonly how: string;
  /** The gate as matched (`npm test`), or the command's text when no gate is recognised in it. */
  readonly name: string;
  /** A test, lint or type-check command; otherwise a command in a gate's place. */
  readonly recognised: boolean;
  readonly file: string;
  /** 1-based line on its side. */
  readonly line: number;
}

// ---- flags on a CI step or job ----

const EXPRESSION = /^\$\{\{\s*(.*?)\s*\}\}$/;

function literal(value: string | null): boolean | null {
  if (value === null) return null;
  const inner = EXPRESSION.exec(value.trim())?.[1] ?? value;
  return boolOf(inner);
}

const FLAG_KEYS: Readonly<Record<string, string>> = {
  continueonerror: 'continue-on-error',
  allowfailure: 'allow_failure',
  softfail: 'soft_fail',
};

function parentOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(0, dot);
}

/**
 * A key that lets a step or job fail without failing the run, or turns it off, and the YAML path
 * of that step or job: GitHub's `continue-on-error` and `if: false`, GitLab's `allow_failure`
 * (`true` or `exit_codes`), Buildkite's `soft_fail`, Azure's `continueOnError`.
 */
function flagOf(entry: Entry): { how: string; container: string } | null {
  const path = entry.indexed.replace(/(?:\[\d*\])+$/, '');
  const parent = parentOf(path);
  const key = norm(path.slice(path.lastIndexOf('.') + 1));
  const flag = FLAG_KEYS[key];
  if (flag !== undefined && literal(entry.value) === true) return { how: `${flag}: true`, container: parent };
  if (key === 'if' && literal(entry.value) === false) return { how: 'if: false', container: parent };
  if (key === 'exitcodes' && norm(lastSegment(parent)) === 'allowfailure' && entry.value !== null) {
    return { how: 'allow_failure: exit_codes', container: parentOf(parent) };
  }
  return null;
}

function inside(entry: Entry, container: string): boolean {
  return container === '' || entry.indexed.startsWith(`${container}.`) || entry.indexed.startsWith(`${container}[`);
}

function fold(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** The gates under each softening flag; a step or job with no recognised gate counts once by its command. */
function flaggedGates(side: ConfigSide, file: string): Softened[] {
  if (side.info.format !== 'yaml' || (side.info.category !== 'ci' && side.info.category !== 'hooks')) return [];
  const out: Softened[] = [];
  const seen = new Set<string>();
  for (const entry of side.entries) {
    const flag = flagOf(entry);
    if (flag === null || seen.has(`${flag.how}\0${flag.container}`)) continue;
    seen.add(`${flag.how}\0${flag.container}`);
    const commands = side.entries.filter((e) => e !== entry && inside(e, flag.container) && isCommand(e, side.info));
    const gates = commands.flatMap((e) => gatesIn(e.value ?? '', e.line));
    if (gates.length > 0) {
      for (const g of gates) out.push({ how: flag.how, name: g.name, recognised: true, file, line: entry.line });
      continue;
    }
    // A `uses:` step that is not a known gate action is setup (checkout, cache, upload), not a check.
    const command = commands.find((e) => norm(lastSegment(e.key)) !== 'uses');
    if (command?.value != null) out.push({ how: flag.how, name: fold(command.value), recognised: false, file, line: entry.line });
  }
  return out;
}

// ---- command lines ----

/** Makefile targets and package.json scripts whose body is a gate, whatever command it runs. */
const GATE_TARGETS = new Set(['test', 'tests', 'check', 'lint', 'typecheck', 'type-check', 'types', 'ci', 'verify']);

function gateTarget(entry: Entry, side: ConfigSide): boolean {
  if (side.info.format === 'make') return entry.key.split(/\s+/).some((t) => GATE_TARGETS.has(t));
  return entry.tool === 'scripts' && GATE_TARGETS.has(entry.sub.split(':')[0] ?? '');
}

/**
 * A command line that cannot fail: `cmd || true` (or `|| exit 0`, `|| :`, `|| echo`) swallows the
 * commands before it in its `;`-separated segment, and a `-` prefix on a Makefile recipe or tox
 * command ignores the exit code. Counted when the swallowed part runs a gate, or, unrecognised,
 * when the line is the body of a gate-named target or script.
 */
function softenedLine(text: string, line: number, file: string, prefixed: boolean, inGateTarget: boolean): Softened[] {
  // `text` is the command without its make or tox prefix; `prefixed` says whether that prefix was `-`.
  const out: Softened[] = [];
  const add = (how: string, part: string): void => {
    const gates = gatesIn(part, line);
    for (const g of gates) out.push({ how, name: g.name, recognised: true, file, line });
    if (gates.length === 0 && inGateTarget) out.push({ how, name: fold(text), recognised: false, file, line });
  };
  const swallow = SWALLOWED.exec(text);
  if (swallow !== null) {
    const before = text.slice(0, swallow.index);
    add(fold(swallow[0]), before.slice(before.lastIndexOf(';') + 1));
  }
  if (prefixed) add("'-' prefix", text);
  return out;
}

function prefixed(entry: Entry, side: ConfigSide): boolean {
  if (side.info.format === 'make') return /^[@+]*-/.test(entry.value ?? '');
  return entry.tool === 'tox' && /^-/.test(entry.value ?? '');
}

function softenedCommands(side: ConfigSide, file: string): Softened[] {
  return side.entries.flatMap((entry) =>
    isCommand(entry, side.info) ? softenedLine(commandBody(entry, side.info), entry.line, file, prefixed(entry, side), gateTarget(entry, side)) : [],
  );
}

function softenedSide(side: ConfigSide | null, file: string): Softened[] {
  return side === null ? [] : [...flaggedGates(side, file), ...softenedCommands(side, file)];
}

function softenedScript(view: AnalyzedFile['old']): Softened[] {
  if (view === null || !isScript(view.path)) return [];
  return view.codeWithStrings.flatMap((text, i) => softenedLine(text, i + 1, view.path, false, false));
}

const keyOf = (s: Softened): string => `${s.how}\0${s.name}`;

function reasonFor(s: Softened): string {
  const what = s.recognised ? s.name : `${s.name} (not a recognised test, lint or type-check command)`;
  if (s.how === 'if: false') return `if: false turns off a step or job that runs ${what}`;
  if (s.how === "'-' prefix") return `'-' prefix ignores the exit code of ${what}`;
  if (s.how.startsWith('||')) return `'${s.how}' swallows a failure of ${what}`;
  return `${s.how} lets a step or job that runs ${what} fail without failing the build`;
}

/**
 * Gates that still run but can no longer fail: compared across the whole change by how and by
 * gate, so a softened step that moved or was renumbered is not new. A recognised gate is an
 * error; a command in a gate's place that the guard does not recognise is a warning.
 */
function softenedHits(files: readonly AnalyzedFile[], configs: readonly ConfigFile[]): RuleHit[] {
  const was = configs.flatMap((cf) => softenedSide(cf.old, cf.file.path));
  const now = configs.flatMap((cf) => softenedSide(cf.new, cf.file.path));
  for (const f of files) {
    if (!readable(f)) continue;
    was.push(...softenedScript(f.old));
    now.push(...softenedScript(f.new).map((s) => ({ ...s, file: f.path })));
  }
  return extras(was, now, keyOf).map((s) => ({
    ruleId: 'config/gate-softened',
    file: s.file,
    line: s.line,
    reason: reasonFor(s),
    ...(s.recognised ? {} : { severity: 'warning' as const }),
  }));
}

// ---- workflow triggers ----

/** Events that run a workflow on the code under review; `pull_request_target` stands for `pull_request`. */
const REVIEW_EVENTS = ['push', 'pull_request'] as const;

function triggers(side: ConfigSide): { events: Set<string>; line: number | null } {
  const events = new Set<string>();
  let line: number | null = null;
  for (const entry of side.entries) {
    const m = /^on(?:\[\]|\.([^.[\]]+))?$/.exec(entry.key);
    if (m === null) continue;
    line ??= entry.line;
    const event = m[1] ?? entry.value;
    if (event != null) events.add(event === 'pull_request_target' ? 'pull_request' : event);
  }
  return { events, line };
}

/**
 * A GitHub workflow that runs commands and no longer runs on push or pull_request. Error when its
 * commands include a recognised gate, warning when none is recognised.
 */
function triggerHits(configs: readonly ConfigFile[]): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const cf of configs) {
    if (cf.old === null || cf.new === null || cf.old.info.family !== 'github-actions' || cf.new.info.family !== 'github-actions') continue;
    const before = triggers(cf.old);
    const after = triggers(cf.new);
    const lost = REVIEW_EVENTS.filter((e) => before.events.has(e) && !after.events.has(e));
    if (lost.length === 0) continue;
    const old = cf.old;
    const commands = old.entries.filter((e) => isCommand(e, old.info) && norm(lastSegment(e.key)) !== 'uses');
    const gates = [...new Set(old.entries.flatMap((e) => (isCommand(e, old.info) ? gatesIn(e.value ?? '', e.line) : [])).map((g) => g.name))];
    if (gates.length === 0 && commands.length === 0) continue;
    const line = after.line ?? (before.line === null ? null : headLine(cf.file, before.line));
    const runs = gates.length > 0 ? `${gates.slice(0, 3).join(', ')}${gates.length > 3 ? ', ...' : ''}` : 'commands, none a recognised test, lint or type-check';
    hits.push({
      ruleId: 'config/gate-softened',
      file: cf.file.path,
      line,
      reason: `workflow no longer runs on ${lost.join(' or ')}; it runs ${runs}`,
      ...(gates.length > 0 ? {} : { severity: 'warning' as const }),
    });
  }
  return hits;
}

export function gateSoftenedHits(files: readonly AnalyzedFile[], configs: readonly ConfigFile[]): RuleHit[] {
  return [...softenedHits(files, configs), ...triggerHits(configs)];
}
