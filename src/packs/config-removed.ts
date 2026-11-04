import type { AnalyzedFile, SideView } from '../engine/analyze.js';
import { configFileInfo, type ConfigCategory } from '../engine/config-files.js';
import type { RuleHit } from '../engine/finding.js';
import { basename, extension } from '../engine/syntax.js';
import { GATE_COMMANDS, type GateKind } from './config-commands.js';
import { commandBody, extras, headLine, isCommand, readable, type ConfigFile, type ConfigSide } from './config-model.js';
import { ShellReader } from './config-shell.js';
import { plural, scanLine } from './scan.js';

// ---- config/file-deleted ----

/** The configs whose deletion drops a check; an ignore file's deletion narrows nothing. */
const CHECK_CATEGORIES: ReadonlySet<ConfigCategory> = new Set(['lint', 'type', 'coverage', 'test-runner']);

function dirOf(path: string | null): string {
  if (path === null) return '';
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** A config in `outer` applies to `inner`: the same directory or an ancestor of it. */
function covers(outer: string, inner: string): boolean {
  return outer === '' || outer === inner || inner.startsWith(`${outer}/`);
}

function toolEntries(side: ConfigSide | null, tool: string): number {
  return side === null ? 0 : side.entries.filter((e) => e.tool === tool).length;
}

/** The file now configures `tool` where it did not, or configures it with more settings. */
function gainsTool(cf: ConfigFile, tool: string): boolean {
  if (cf.new === null) return false;
  const newlyDedicated = cf.new.info.family === tool && cf.old?.info.family !== tool;
  return newlyDedicated || toolEntries(cf.new, tool) > toolEntries(cf.old, tool);
}

/** A dedicated config of another tool of the same category, added where it applies. */
function replacement(files: readonly ConfigFile[], gone: ConfigFile, side: ConfigSide, dir: string): ConfigFile | undefined {
  return files.find(
    (o) =>
      o !== gone &&
      o.new !== null &&
      o.new.info.category === side.info.category &&
      o.new.info.family !== side.info.family &&
      o.old?.info.family !== o.new.info.family &&
      covers(dirOf(o.file.newPath), dir),
  );
}

/**
 * A lint, type-check, coverage or test-runner config deleted, or renamed to a path its tool does
 * not read. A config for the same tool added where it applies (another file name, a section of
 * pyproject.toml or package.json, a parent directory) is a migration and passes; one for another
 * tool of the same kind may be a switch of tools, so it lowers the finding to a warning. A
 * test-runner config deleted with its runner, which another runner replaced, passes too.
 */
export function fileDeletedHits(analyzed: readonly AnalyzedFile[], files: readonly ConfigFile[]): RuleHit[] {
  const migration = runnerMigration(commandSources(analyzed, files), files);
  const hits: RuleHit[] = [];
  for (const cf of files) {
    const old = cf.old;
    if (old === null || cf.new !== null || !CHECK_CATEGORIES.has(old.info.category) || old.info.format === 'lines') continue;
    const tool = old.info.family;
    const dir = dirOf(cf.file.oldPath);
    if (files.some((o) => o !== cf && gainsTool(o, tool) && covers(dirOf(o.file.newPath), dir))) continue;
    if (migratedAway(migration, old, cf.file.oldPath ?? cf.file.path)) continue;
    const gone = cf.file.newPath === null ? 'deleted' : `renamed to ${cf.file.newPath}, which ${tool} does not read`;
    const swap = replacement(files, cf, old, dir);
    const reason = `${tool} config ${cf.file.oldPath ?? cf.file.path} ${gone}`;
    hits.push(
      swap === undefined
        ? { ruleId: 'config/file-deleted', file: cf.file.path, line: null, reason: `${reason}; no ${tool} config replaces it` }
        : {
            ruleId: 'config/file-deleted',
            file: cf.file.path,
            line: null,
            reason: `${reason}; ${swap.file.path} (${swap.new?.info.family ?? ''}) was added, which may replace it`,
            severity: 'warning',
          },
    );
  }
  return hits;
}

// ---- config/gate-removed ----

export interface GateCommand {
  readonly kind: GateKind;
  /** The command as matched, whitespace folded: `npm run lint`, `jest`. */
  readonly name: string;
  /** 1-based line on its side. */
  readonly line: number;
}

/**
 * The gate commands on one command line, named by their text in the line. A call to a
 * package.json script or a Makefile target that `defined` holds is left out: its body is counted
 * where it is defined, so moving a command between the two is not a removal.
 */
export function gatesIn(text: string, line: number, defined: ReadonlySet<string> = new Set()): GateCommand[] {
  return scanLine(text, GATE_COMMANDS)
    .map((m) => ({ kind: m.tag, name: commandName(spanText(text, m.index, m.name)), line }))
    .filter((c) => {
      const target = indirection(c.name);
      return target === null || !defined.has(target);
    });
}

/** `npm run lint` → `script:lint`, `npm t` → `script:test`, `make test` → `make:test`. */
function indirection(name: string): string | null {
  if (/^npm\s+t$/.test(name)) return 'script:test';
  const script = /^(?:npm|pnpm|yarn|bun)(?:\s+run(?:-script)?)?\s+(\S+)$/.exec(name);
  if (script !== null) return `script:${script[1] ?? ''}`;
  const make = /^make\s+(\S+)$/.exec(name);
  return make === null ? null : `make:${make[1] ?? ''}`;
}

/** A command's name without node's own flags: `node --import ./setup.mjs --test` → `node --test`. */
function commandName(text: string): string {
  return /^node\s.*--test$/.test(text) ? 'node --test' : text;
}

/** The text a match covered: `name` is that text with its whitespace removed. */
function spanText(text: string, index: number, name: string): string {
  let end = index;
  for (let seen = 0; end < text.length && seen < name.length; end++) if (!/\s/.test(text[end] ?? '')) seen++;
  return text.slice(index, end).replace(/\s+/g, ' ');
}

const SHELL_EXTENSIONS = new Set(['sh', 'bash', 'zsh']);

/** A shell script a CI step or hook may call; config files are read as config instead. */
export function isScript(path: string | null): boolean {
  return path !== null && SHELL_EXTENSIONS.has(extension(path)) && configFileInfo(path) === null;
}

/** The package.json scripts and Makefile targets one side of the change defines. */
function definedTargets(sides: readonly (ConfigSide | null)[]): Set<string> {
  const out = new Set<string>();
  for (const side of sides) {
    for (const entry of side?.entries ?? []) {
      if (entry.tool === 'scripts' && entry.sub !== '' && !entry.sub.includes('.')) out.add(`script:${entry.sub}`);
      if (side?.info.format === 'make' && entry.value === null) for (const t of entry.key.split(/\s+/)) out.add(`make:${t}`);
    }
  }
  return out;
}

/** Each command entry's gates, reading one step's lines in order so a heredoc spans them. */
function configCommands(side: ConfigSide | null, defined: ReadonlySet<string>): GateCommand[] {
  if (side === null) return [];
  let reader = new ShellReader();
  let step: string | null = null;
  return side.entries.flatMap((entry) => {
    if (!isCommand(entry, side.info)) return [];
    if (entry.indexed !== step) reader = new ShellReader();
    step = entry.indexed;
    return gatesIn(reader.line(commandBody(entry, side.info)), entry.line, defined);
  });
}

function scriptCommands(view: SideView | null, defined: ReadonlySet<string>): GateCommand[] {
  if (view === null || !isScript(view.path)) return [];
  const reader = new ShellReader();
  return view.codeWithStrings.flatMap((text, i) => gatesIn(reader.line(text), i + 1, defined));
}

interface CommandSource {
  readonly file: AnalyzedFile;
  readonly old: readonly GateCommand[];
  readonly new: readonly GateCommand[];
}

/** Every changed CI file, hook, Makefile, package.json, tox.ini and shell script, with its gate commands. */
function commandSources(files: readonly AnalyzedFile[], configs: readonly ConfigFile[]): CommandSource[] {
  const oldDefined = definedTargets(configs.map((cf) => cf.old));
  const newDefined = definedTargets(configs.map((cf) => cf.new));
  const fromConfig = configs.map((cf) => ({ file: cf.file, old: configCommands(cf.old, oldDefined), new: configCommands(cf.new, newDefined) }));
  const fromScripts = files
    .filter((f) => readable(f) && (isScript(f.oldPath) || isScript(f.newPath)))
    .map((f) => ({ file: f, old: scriptCommands(f.old, oldDefined), new: scriptCommands(f.new, newDefined) }));
  return [...fromConfig, ...fromScripts]
    .filter((s) => s.old.length > 0 || s.new.length > 0)
    .sort((a, b) => (a.file.path < b.file.path ? -1 : a.file.path > b.file.path ? 1 : 0));
}

const KINDS: readonly GateKind[] = ['test', 'lint', 'typecheck'];

function ofKind(commands: readonly GateCommand[], kind: GateKind): GateCommand[] {
  return commands.filter((c) => c.kind === kind);
}

/**
 * Test, lint and type-check commands counted by kind across every CI file, hook, script and
 * Makefile in the change, so a command moved between files, or one tool swapped for another of
 * the same kind, is not a removal. When the count drops, the finding sits where a command went.
 * Only changed files are seen, so a command that also runs in an unchanged file still counts.
 * Fewer test commands in a runner migration, where every one gone ran the dropped runner, is a
 * warning at most.
 */
export function gateRemovedHits(files: readonly AnalyzedFile[], configs: readonly ConfigFile[]): RuleHit[] {
  const sources = commandSources(files, configs);
  const migration = runnerMigration(sources, configs);
  const hits: RuleHit[] = [];
  for (const kind of KINDS) {
    const was = sources.flatMap((s) => ofKind(s.old, kind));
    const now = sources.flatMap((s) => ofKind(s.new, kind));
    if (now.length >= was.length) continue;
    const gone = extras(now, was, (c) => c.name);
    const at = sources.find((s) => ofKind(s.new, kind).length < ofKind(s.old, kind).length);
    const first = at === undefined ? undefined : extras(ofKind(at.new, kind), ofKind(at.old, kind), (c) => c.name)[0];
    const names = [...new Set(gone.map((c) => c.name))];
    const migrated = kind === 'test' && migration !== null && gone.every((c) => migration.dropped.some((d) => d.runner === runnerOf(c.name)));
    hits.push({
      ...(migrated ? { severity: 'warning' as const } : {}),
      ruleId: 'config/gate-removed',
      file: at?.file.path ?? sources[0]?.file.path ?? '',
      line: at === undefined || first === undefined ? null : headLine(at.file, first.line),
      reason: `${plural(was.length - now.length, `${kind} command`)} fewer across CI, hooks and scripts (${was.length} before, ${now.length} after): ${names.slice(0, 3).join(', ')}${names.length > 3 ? ', ...' : ''}${migrated ? `; replaced by ${migration.added.join(', ')}` : ''}`,
    });
  }
  return hits;
}

// ---- test-runner migrations ----

/** The packages that install each JS test runner, keyed by the runner's command word. */
const RUNNER_PACKAGES: Readonly<Record<string, readonly string[]>> = {
  vitest: ['vitest'],
  jest: ['jest'],
  mocha: ['mocha'],
  ava: ['ava'],
  playwright: ['@playwright/test', 'playwright'],
  karma: ['karma'],
  cypress: ['cypress'],
};

const DEPENDENCY_KEY = /^(?:dependencies|devDependencies|optionalDependencies)\.(.+)$/;

function dependencies(side: ConfigSide | null): Set<string> {
  const out = new Set<string>();
  if (side?.info.family !== 'package-json') return out;
  for (const e of side.entries) {
    const m = DEPENDENCY_KEY.exec(e.key);
    if (m !== null && e.value !== null) out.add(m[1] ?? '');
  }
  return out;
}

/**
 * The runners a package.json in the change no longer installs, with the directory each applied
 * to. A deleted package.json drops a whole project, not one runner, so it does not count.
 */
function droppedRunners(configs: readonly ConfigFile[]): { runner: string; dir: string }[] {
  const out: { runner: string; dir: string }[] = [];
  for (const cf of configs) {
    if (cf.new === null) continue;
    const before = dependencies(cf.old);
    const after = dependencies(cf.new);
    for (const [runner, packages] of Object.entries(RUNNER_PACKAGES)) {
      if (packages.some((p) => before.has(p)) && !packages.some((p) => after.has(p))) out.push({ runner, dir: dirOf(cf.file.newPath) });
    }
  }
  return out;
}

/** The runner a gate command calls (`playwright test` → `playwright`), or null for other commands. */
function runnerOf(name: string): string | null {
  const word = name.split(' ')[0] ?? '';
  return Object.hasOwn(RUNNER_PACKAGES, word) ? word : null;
}

/** The runner a test-runner config file configures: its family, or its file name for the rest. */
function configRunner(side: ConfigSide, path: string): string | null {
  const word = side.info.family === 'js-runner' ? (basename(path).split('.')[0] ?? '') : side.info.family;
  return Object.hasOwn(RUNNER_PACKAGES, word) ? word : null;
}

interface Migration {
  readonly dropped: readonly { runner: string; dir: string }[];
  /** The test commands the head side runs that the base side did not. */
  readonly added: readonly string[];
}

/**
 * One test runner replaced by another: a runner's package dropped from a package.json in the
 * change, and a test command for some other runner newly run. Null when nothing was replaced.
 */
function runnerMigration(sources: readonly CommandSource[], configs: readonly ConfigFile[]): Migration | null {
  const dropped = droppedRunners(configs);
  if (dropped.length === 0) return null;
  const before = new Set(sources.flatMap((s) => ofKind(s.old, 'test').map((c) => c.name)));
  const gone = new Set(dropped.map((d) => d.runner));
  const added = [...new Set(sources.flatMap((s) => ofKind(s.new, 'test').map((c) => c.name)))].filter((n) => !before.has(n) && !gone.has(runnerOf(n) ?? ''));
  return added.length === 0 ? null : { dropped, added };
}

/** The deleted config's runner is one the migration dropped, from a package.json that covers it. */
function migratedAway(migration: Migration | null, side: ConfigSide, path: string): boolean {
  const runner = configRunner(side, path);
  return migration !== null && runner !== null && migration.dropped.some((d) => d.runner === runner && covers(d.dir, dirOf(path)));
}
