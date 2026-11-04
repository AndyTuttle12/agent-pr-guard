import type { AnalyzedFile, SideView } from '../engine/analyze.js';
import type { RuleHit } from '../engine/finding.js';
import { extension } from '../engine/syntax.js';
import { readable } from './config-model.js';

/** One lint, type-check or coverage suppression comment on one line. */
export interface Directive {
  /** `eslint`, `ts`, `type`, `pylint`, `noqa`, `nolint`, `coverage`, `istanbul`, `c8`, `v8`. */
  readonly tool: string;
  /** What it covers: `line`, `next-line`, `block`, `file`, or an istanbul-style `next`/`if`/`else`/`start`. */
  readonly scope: string;
  /** As written, folded: `eslint-disable-next-line`, `@ts-ignore`, `ruff: noqa`, `c8 ignore next`. */
  readonly label: string;
  /** Rule codes it names, sorted; empty for a blanket suppression. */
  readonly codes: readonly string[];
  /** The text after the directive and its codes, up to the next directive; empty when none. */
  readonly reason: string;
}

interface Spec {
  readonly re: RegExp;
  read(m: RegExpExecArray, tail: string): { tool: string; scope: string; label: string; codes: string[]; rest: string };
}

const ESLINT_SCOPES: Readonly<Record<string, string>> = {
  'eslint-disable': 'block',
  'eslint-disable-next-line': 'next-line',
  'eslint-disable-line': 'line',
};

/** `no-console, @typescript-eslint/no-explicit-any -- why`: names up to the first token that is not one. */
function eslintCodes(tail: string): { codes: string[]; rest: string } {
  const m = /^\s*([@\w][@\w./-]*(?:\s*,\s*[@\w][@\w./-]*)*)/.exec(tail);
  if (m?.[1] === undefined) return { codes: [], rest: tail };
  return { codes: m[1].split(',').map((c) => c.trim()), rest: tail.slice(m[0].length) };
}

/** flake8 and ruff: codes only after a colon, `# noqa: E501,W291`. */
function noqaCodes(tail: string): { codes: string[]; rest: string } {
  const m = /^\s*:\s*([A-Z]+\d+(?:[,\s]+[A-Z]+\d+)*)/i.exec(tail);
  if (m?.[1] === undefined) return { codes: [], rest: tail };
  return { codes: m[1].split(/[,\s]+/).map((c) => c.toUpperCase()), rest: tail.slice(m[0].length) };
}

/** golangci-lint: `//nolint:errcheck,gosec`, no spaces. */
function nolintCodes(tail: string): { codes: string[]; rest: string } {
  const m = /^:([\w-]+(?:,[\w-]+)*)/.exec(tail);
  if (m?.[1] === undefined) return { codes: [], rest: tail };
  return { codes: m[1].split(','), rest: tail.slice(m[0].length) };
}

/** mypy and pyright: error codes in brackets, `# type: ignore[attr-defined, arg-type]`. */
function typeIgnoreCodes(tail: string): { codes: string[]; rest: string } {
  const m = /^\[([^\]]*)\]/.exec(tail);
  if (m?.[1] === undefined) return { codes: [], rest: tail };
  return { codes: m[1].split(',').map((c) => c.trim()), rest: tail.slice(m[0].length) };
}

/** `# pylint: disable=invalid-name,C0301`; `all` is every check, the same as no codes. */
function pylintCodes(tail: string): { codes: string[]; rest: string } {
  const m = /^\s*=\s*([\w-]+(?:\s*,\s*[\w-]+)*)/.exec(tail);
  if (m?.[1] === undefined) return { codes: [], rest: tail };
  const codes = m[1].split(',').map((c) => c.trim());
  return { codes: codes.includes('all') ? [] : codes, rest: tail.slice(m[0].length) };
}

/**
 * Each directive must open its comment (only whitespace between the comment marker and it), as
 * the tools themselves require, so prose that mentions a directive is not one.
 */
const SPECS: readonly Spec[] = [
  {
    re: /(?:\/\/|\/\*+|<!--)\s*(eslint-disable(?:-next-line|-line)?)(?![\w-])/g,
    read: (m, tail) => {
      const label = m[1] ?? 'eslint-disable';
      return { tool: 'eslint', scope: ESLINT_SCOPES[label] ?? 'block', label, ...withRest(eslintCodes(tail)) };
    },
  },
  {
    // @ts-ignore and @ts-expect-error hide the same thing, so they share a key.
    re: /(?:\/\/+|\/\*+)\s*(@ts-(?:ignore|expect-error|nocheck))(?![\w-])/g,
    read: (m, tail) => {
      const label = m[1] ?? '@ts-ignore';
      return { tool: 'ts', scope: label === '@ts-nocheck' ? 'file' : 'next-line', label, codes: [], rest: tail };
    },
  },
  {
    re: /#\s*(?:(ruff|flake8)\s*:\s*)?noqa(?![\w-])/gi,
    read: (m, tail) => {
      const fileWide = m[1] !== undefined;
      return { tool: 'noqa', scope: fileWide ? 'file' : 'line', label: fileWide ? `${(m[1] ?? '').toLowerCase()}: noqa` : 'noqa', ...withRest(noqaCodes(tail)) };
    },
  },
  {
    re: /\/\/\s*nolint(?![\w-])/g,
    read: (_m, tail) => ({ tool: 'nolint', scope: 'line', label: 'nolint', ...withRest(nolintCodes(tail)) }),
  },
  {
    // mypy and pyright, which also require the comment to end there or a new `#` to follow. Scope is
    // `line` here; placedOn widens one above all code to `file`, as mypy reads it.
    re: /#\s*type\s*:\s*ignore(?=(?:\[[^\]]*\])?\s*(?:#|$))/g,
    read: (_m, tail) => ({ tool: 'type', scope: 'line', label: 'type: ignore', ...withRest(typeIgnoreCodes(tail)) }),
  },
  {
    // Scope is `block` here; placedOn narrows a `disable=` that shares its line with code to `line`.
    re: /#\s*pylint\s*:\s*(disable-next|disable|skip-file)(?![\w-])/g,
    read: (m, tail) => {
      const kind = m[1] ?? 'disable';
      const label = `pylint: ${kind}`;
      if (kind === 'skip-file') return { tool: 'pylint', scope: 'file', label, codes: [], rest: tail };
      return { tool: 'pylint', scope: kind === 'disable-next' ? 'next-line' : 'block', label, ...withRest(pylintCodes(tail)) };
    },
  },
  {
    // coverage.py's own default exclusion pattern.
    re: /#\s*pragma[:\s]?\s*no\s*cover(?![\w-])/gi,
    read: (_m, tail) => ({ tool: 'coverage', scope: 'line', label: 'pragma: no cover', codes: [], rest: tail }),
  },
  {
    // A line count (`c8 ignore next 3`) is part of the directive, not of its reason.
    re: /(?:\/\/|\/\*+)\s*(istanbul|c8|v8)\s+ignore\s+(next|if|else|file|start)(?![\w-])(?:\s+\d+(?![\w-]))?/g,
    read: (m, tail) => {
      const tool = m[1] ?? 'istanbul';
      const scope = m[2] ?? 'next';
      return { tool, scope, label: `${tool} ignore ${scope}`, codes: [], rest: tail };
    },
  },
];

function withRest(parsed: { codes: string[]; rest: string }): { codes: string[]; rest: string } {
  return { codes: [...new Set(parsed.codes.filter((c) => c !== ''))].sort(), rest: parsed.rest };
}

/** Comment closers, separators and esbuild's `@preserve` stripped; empty when nothing is said. */
function reasonOf(rest: string): string {
  const text = rest
    .replace(/\*\/|-->/g, ' ')
    .replace(/(?<![\w-])@preserve(?![\w-])/g, ' ')
    .replace(/^[\s\-–—:;,#/*]+/, '')
    .replace(/[\s/*]+$/, '')
    .replace(/\s+/g, ' ');
  return /[\p{L}\p{N}]/u.test(text) ? text : '';
}

/** Every suppression directive on one line, in column order; each one's tail ends at the next. */
export function directivesIn(line: string): Directive[] {
  const found: { index: number; end: number; spec: Spec; match: RegExpExecArray }[] = [];
  for (const spec of SPECS) {
    spec.re.lastIndex = 0;
    for (let m = spec.re.exec(line); m !== null; m = spec.re.exec(line)) {
      found.push({ index: m.index, end: m.index + m[0].length, spec, match: m });
    }
  }
  found.sort((a, b) => a.index - b.index);
  return found.map((f, i) => {
    const tail = line.slice(f.end, found[i + 1]?.index ?? line.length);
    const { tool, scope, label, codes, rest } = f.spec.read(f.match, tail);
    return { tool, scope, label, codes, reason: reasonOf(rest) };
  });
}

const DOCS = new Set(['md', 'mdx', 'markdown', 'rst', 'txt', 'adoc']);

/**
 * The lines to read directives from: the comments view for a file the masker lexes, raw lines
 * otherwise (the directive patterns require a comment marker). Docs never suppress anything.
 */
function directiveLines(view: SideView): readonly string[] {
  if (DOCS.has(extension(view.path))) return [];
  return view.syntax === 'plain' ? view.lines : view.comments;
}

interface Placed {
  readonly directive: Directive;
  readonly file: string;
  /** 1-based on its own side. */
  readonly line: number;
  /** The whole raw line, trimmed, for pairing a moved line. */
  readonly text: string;
  /** For a directive that covers the code below it: that line, 1-based, or null when none follows. */
  readonly target: number | null;
  /** The covered line, trimmed; null when there is none. */
  readonly targetText: string | null;
}

/** `next-line` and istanbul-style `next` cover the code after them, so they are tied to it. */
function anchored(d: Directive): boolean {
  return d.scope === 'next-line' || d.scope === 'next';
}

const COMMENT_START = /^(?:\/\/|\/\*|\*|<!--)/;

/** A line with code on it; blank and comment-only lines do not count. */
function hasCode(view: SideView, index: number): boolean {
  if (view.syntax !== 'plain') return (view.code[index] ?? '').trim() !== '';
  const raw = (view.lines[index] ?? '').trim();
  return raw !== '' && !COMMENT_START.test(raw);
}

/**
 * The line a next-line directive covers: the next line with code, skipping blank and comment
 * lines as TypeScript does. An istanbul-style `next` that shares its line with code covers that line.
 */
function targetOf(view: SideView, line: number, d: Directive): number | null {
  if (!anchored(d)) return null;
  const from = d.scope === 'next' && hasCode(view, line - 1) ? line - 1 : line;
  for (let i = from; i < view.lines.length; i++) if (hasCode(view, i)) return i + 1;
  return null;
}

/**
 * Scopes that depend on the code around a directive: a `# type: ignore` above all code covers the
 * whole file, and a `# pylint: disable=` after code on its line covers only that line.
 */
function situated(d: Directive, view: SideView, line: number): Directive {
  if (d.tool === 'type' && d.scope === 'line') {
    for (let i = 0; i < line; i++) if (hasCode(view, i)) return d;
    return { ...d, scope: 'file' };
  }
  if (d.tool === 'pylint' && d.scope === 'block' && hasCode(view, line - 1)) return { ...d, scope: 'line' };
  return d;
}

function placedOn(view: SideView | null, file: string, lineNumbers: readonly number[]): Placed[] {
  if (view === null) return [];
  const lines = directiveLines(view);
  return lineNumbers.flatMap((n) =>
    directivesIn(lines[n - 1] ?? '').map((read) => {
      const directive = situated(read, view, n);
      const target = targetOf(view, n, directive);
      const targetText = target === null ? null : (view.lines[target - 1] ?? '').trim();
      return { directive, file, line: n, text: (view.lines[n - 1] ?? '').trim(), target, targetText };
    }),
  );
}

/** Old and new line numbers a hunk rewrote. */
interface Rewritten {
  readonly removed: ReadonlySet<number>;
  readonly added: ReadonlySet<number>;
}

/**
 * The new directive covers the code the old one did: an unanchored directive always does; an
 * anchored one when the covered line is the same text, or, inside one hunk, when that hunk
 * rewrote both covered lines along with the directives.
 */
function sameTarget(old: Placed, now: Placed, hunk: Rewritten | null): boolean {
  if (!anchored(now.directive)) return true;
  if (old.targetText === now.targetText) return true;
  if (hunk === null || old.target === null || now.target === null) return false;
  return hunk.removed.has(old.target) && hunk.added.has(now.target);
}

/** The old directive already suppressed everything the new one does: same tool and scope, no new codes. */
function covers(old: Directive, now: Directive): boolean {
  if (old.tool !== now.tool || old.scope !== now.scope) return false;
  if (old.codes.length === 0) return true;
  return now.codes.length > 0 && now.codes.every((c) => old.codes.includes(c));
}

function takeFirst<T>(pool: T[], match: (item: T) => boolean): boolean {
  const index = pool.findIndex(match);
  if (index === -1) return false;
  pool.splice(index, 1);
  return true;
}

const keyOf = (d: Directive): string => `${d.tool}\0${d.scope}\0${d.codes.join(',')}`;

/**
 * Suppression comments on added lines that no removed line already had. Within a hunk, an old
 * directive covers a new one of the same tool and scope whose codes are the same or narrower
 * (`# noqa` → `# noqa: E501`). Across the change, a line moved with its text unchanged is not new.
 * A next-line directive nets out only when the code it covers came with it; one moved onto other
 * code is new. A removed eslint-enable that leaves an eslint-disable block running on counts too.
 */
export function inlineSuppressionHits(files: readonly AnalyzedFile[]): RuleHit[] {
  const fresh: Placed[] = [];
  const leftOver: Placed[] = [];
  for (const file of files) {
    if (!readable(file)) continue;
    for (const hunk of file.hunks) {
      const rewritten: Rewritten = { removed: new Set(hunk.removed.map((l) => l.line)), added: new Set(hunk.added.map((l) => l.line)) };
      const removed = placedOn(file.old, file.path, [...rewritten.removed]);
      for (const added of placedOn(file.new, file.path, [...rewritten.added])) {
        if (!takeFirst(removed, (r) => covers(r.directive, added.directive) && sameTarget(r, added, rewritten))) fresh.push(added);
      }
      leftOver.push(...removed);
    }
  }
  return fresh
    .filter((added) => !takeFirst(leftOver, (r) => r.text === added.text && keyOf(r.directive) === keyOf(added.directive) && sameTarget(r, added, null)))
    .map((p) => hitFor(p))
    .concat(widenedBlockHits(files));
}

const EFFECTS: Readonly<Record<string, (what: string) => string>> = {
  'eslint\0block': (what) => `turns off ${what} until eslint-enable or the end of the file`,
  'eslint\0next-line': (what) => `turns off ${what} on the next line`,
  'eslint\0line': (what) => `turns off ${what} on this line`,
  'ts\0next-line': () => 'hides type errors on the next line',
  'ts\0file': () => 'turns off type checking for the whole file',
  'type\0line': (what) => `hides ${what} on this line`,
  'type\0file': () => 'turns off type checking for the whole file',
  'pylint\0line': (what) => `turns off ${what} on this line`,
  'pylint\0next-line': (what) => `turns off ${what} on the next line`,
  'pylint\0block': (what) => `turns off ${what} to the end of the enclosing block or module`,
  'pylint\0file': () => 'turns off pylint for the whole file',
  'noqa\0line': (what) => `hides ${what} on this line`,
  'noqa\0file': (what) => `hides ${what} in the whole file`,
  'nolint\0line': (what) => `hides ${what} on this line or the statement below`,
};

const EVERY: Readonly<Record<string, string>> = { eslint: 'every ESLint rule', nolint: 'every linter', type: 'every type error', pylint: 'every pylint check' };

function effectOf(d: Directive): string {
  const what = d.codes.length > 0 ? d.codes.join(', ') : (EVERY[d.tool] ?? 'every lint error');
  const effect = EFFECTS[`${d.tool}\0${d.scope}`];
  if (effect !== undefined) return effect(what);
  if (d.scope === 'file') return 'excludes the whole file from coverage';
  if (d.scope === 'start') return `excludes the code up to ${d.tool} ignore stop from coverage`;
  if (d.scope === 'if' || d.scope === 'else') return `excludes the ${d.scope} branch from coverage`;
  if (d.scope === 'next') return 'excludes the next statement from coverage';
  return 'excludes this line or block from coverage';
}

/** The directive as its tool writes it. */
function writtenOf(d: Directive): string {
  if (d.codes.length === 0) return d.label;
  if (d.tool === 'noqa') return `${d.label}: ${d.codes.join(', ')}`;
  if (d.tool === 'nolint') return `${d.label}:${d.codes.join(',')}`;
  if (d.tool === 'type') return `${d.label}[${d.codes.join(', ')}]`;
  if (d.tool === 'pylint') return `${d.label}=${d.codes.join(',')}`;
  return `${d.label} ${d.codes.join(', ')}`;
}

const MAX_REASON = 80;

/** A reason lowers the hit to a warning, except on a type checker turned off for a whole file. */
function hitFor(p: Placed): RuleHit {
  const d = p.directive;
  const reason = d.reason.length > MAX_REASON ? `${d.reason.slice(0, MAX_REASON - 3)}...` : d.reason;
  const said = reason === '' ? ', with no reason given' : ` (reason: "${reason}")`;
  const lowered = reason !== '' && !((d.tool === 'ts' || d.tool === 'type') && d.scope === 'file');
  return {
    ruleId: 'config/inline-suppression',
    file: p.file,
    line: p.line,
    reason: `${writtenOf(d)} added: ${effectOf(d)}${said}`,
    ...(lowered ? { severity: 'warning' as const } : {}),
  };
}

const ENABLE = /(?:\/\/|\/\*+|<!--)\s*eslint-enable(?![\w-])/g;

/** The rules each `eslint-enable` on a line turns back on; an empty list is every rule. */
export function eslintEnablesIn(line: string): string[][] {
  const out: string[][] = [];
  ENABLE.lastIndex = 0;
  for (let m = ENABLE.exec(line); m !== null; m = ENABLE.exec(line)) {
    out.push(withRest(eslintCodes(line.slice(m.index + m[0].length))).codes);
  }
  return out;
}

/** What eslint-disable blocks leave off at a point: with `all`, every rule but `codes`; else just `codes`. */
interface BlockState {
  all: boolean;
  readonly codes: Set<string>;
}

function isOff(state: BlockState, code: string): boolean {
  return state.all !== state.codes.has(code);
}

function toggle(state: BlockState, off: boolean, codes: readonly string[]): void {
  if (codes.length === 0) {
    state.all = off;
    state.codes.clear();
    return;
  }
  for (const code of codes) {
    if (off === state.all) state.codes.delete(code);
    else state.codes.add(code);
  }
}

/** The eslint-disable block state just before a 1-based line. */
function blockStateBefore(view: SideView, line: number): BlockState {
  const lines = directiveLines(view);
  const state: BlockState = { all: false, codes: new Set() };
  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    const text = lines[i] ?? '';
    for (const d of directivesIn(text)) if (d.tool === 'eslint' && d.scope === 'block') toggle(state, true, d.codes);
    for (const codes of eslintEnablesIn(text)) toggle(state, false, codes);
  }
  return state;
}

/**
 * The rules a removed eslint-enable had turned back on that are now left off past the hunk: off
 * just before the enable, back on after the hunk before the change, still off after it now.
 */
function widened(codes: readonly string[], before: BlockState, oldAfter: BlockState, newAfter: BlockState): string[] | 'all' | null {
  if (codes.length === 0 && before.all && !oldAfter.all && newAfter.all) return 'all';
  const candidates = codes.length > 0 ? codes : [...(before.all ? [] : before.codes), ...(newAfter.all ? [] : newAfter.codes)];
  const list = [...new Set(candidates)].filter((c) => isOff(before, c) && !isOff(oldAfter, c) && isOff(newAfter, c)).sort();
  return list.length > 0 ? list : null;
}

function firstCodeFrom(view: SideView, line: number): number | null {
  for (let i = Math.max(line - 1, 0); i < view.lines.length; i++) if (hasCode(view, i)) return i + 1;
  return null;
}

/**
 * Removing an `eslint-enable` (or moving it down) stretches the eslint-disable block it closed
 * over the code that follows, which is a suppression added without a comment. Reported at the
 * first line of code the block now reaches.
 */
function widenedBlockHits(files: readonly AnalyzedFile[]): RuleHit[] {
  const out: RuleHit[] = [];
  for (const file of files) {
    const { old, new: now } = file;
    if (!readable(file) || old === null || now === null || DOCS.has(extension(now.path))) continue;
    for (const hunk of file.hunks) {
      const enables = hunk.removed.flatMap((l) => eslintEnablesIn(directiveLines(old)[l.line - 1] ?? '').map((codes) => ({ line: l.line, codes })));
      const last = hunk.removed.at(-1)?.line;
      if (enables.length === 0 || last === undefined) continue;
      const at = firstCodeFrom(now, hunk.newStart + hunk.added.length);
      if (at === null) continue;
      const oldAfter = blockStateBefore(old, last + 1);
      const newAfter = blockStateBefore(now, hunk.newStart + hunk.added.length);
      for (const enable of enables) {
        const what = widened(enable.codes, blockStateBefore(old, enable.line), oldAfter, newAfter);
        if (what === null) continue;
        const written = enable.codes.length > 0 ? `eslint-enable ${enable.codes.join(', ')}` : 'eslint-enable';
        out.push({
          ruleId: 'config/inline-suppression',
          file: file.path,
          line: at,
          reason: `${written} removed: an earlier eslint-disable now keeps ${what === 'all' ? 'every ESLint rule' : what.join(', ')} off past this point`,
        });
      }
    }
  }
  return out;
}
