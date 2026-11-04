import type { ChangeSet, FileChange, FileSide, SkipReason } from '../changeset.js';
import type { GuardConfig } from './config.js';
import { GlobSet } from './glob.js';
import { diffLines, splitLines, type Hunk } from './line-diff.js';
import { mask } from './mask.js';
import { basename, syntaxOf, testLanguageOf, type Syntax, type TestLanguage } from './syntax.js';
import { TestFileMatcher } from './test-files.js';

/** One side of a changed text file, with its masked views split into lines. */
export interface SideView {
  readonly path: string;
  readonly syntax: Syntax;
  readonly language: TestLanguage | null;
  readonly isTest: boolean;
  readonly lines: readonly string[];
  /** Comments and string contents blanked. */
  readonly code: readonly string[];
  /** Comments blanked, strings kept. */
  readonly codeWithStrings: readonly string[];
  /** Only comments kept. */
  readonly comments: readonly string[];
}

export interface AnalyzedFile {
  readonly change: FileChange;
  /** Where findings are reported: the head path, or the base path for a deletion. */
  readonly path: string;
  readonly oldPath: string | null;
  readonly newPath: string | null;
  /** Path-based, so they hold even when a side's content was not readable. */
  readonly oldIsTest: boolean;
  readonly newIsTest: boolean;
  /** Text views; null when the side is absent or its content was skipped. */
  readonly old: SideView | null;
  readonly new: SideView | null;
  /** Line hunks between the two text sides; an absent side counts as empty. */
  readonly hunks: readonly Hunk[];
  /** Why a present side could not be read, if one could not. */
  readonly uninspected: SkipReason | null;
  /** Matched `ignorePaths`; only the protected-path rules see ignored files. */
  readonly ignored: boolean;
  /** Set when a deleted and an added test file with the same name were paired as a move. */
  readonly pairedMove: boolean;
}

export interface AnalysisContext {
  readonly tests: TestFileMatcher;
  readonly ignore: GlobSet;
}

export function analysisContext(config: GuardConfig): AnalysisContext {
  return { tests: new TestFileMatcher(config.testPatterns), ignore: new GlobSet(config.ignorePaths) };
}

export function analyzeChangeSet(changeSet: ChangeSet, ctx: AnalysisContext): AnalyzedFile[] {
  return pairMovedTests(changeSet.files, ctx).map((change) => analyzeFile(change, ctx));
}

function analyzeFile(change: FileChange & { pairedMove?: boolean }, ctx: AnalysisContext): AnalyzedFile {
  const old = view(change.old, ctx);
  const neu = view(change.new, ctx);
  const skipped = change.old?.skipped ?? change.new?.skipped ?? null;
  const oldPath = change.old?.path ?? null;
  const newPath = change.new?.path ?? null;
  return {
    change,
    path: change.path,
    oldPath,
    newPath,
    oldIsTest: oldPath !== null && ctx.tests.isTest(oldPath),
    newIsTest: newPath !== null && ctx.tests.isTest(newPath),
    old,
    new: neu,
    hunks: diffLines(old?.lines ?? [], neu?.lines ?? []),
    uninspected: skipped,
    ignored: [oldPath, newPath].some((p) => p !== null && ctx.ignore.matches(p)),
    pairedMove: change.pairedMove === true,
  };
}

function view(side: FileSide | null, ctx: AnalysisContext): SideView | null {
  if (side === null || side.text === null) return null;
  const syntax = syntaxOf(side.path);
  const masked = mask(side.text, syntax);
  return {
    path: side.path,
    syntax,
    language: testLanguageOf(side.path),
    isTest: ctx.tests.isTest(side.path),
    lines: splitLines(side.text),
    code: splitLines(masked.code),
    codeWithStrings: splitLines(masked.codeWithStrings),
    comments: splitLines(masked.comments),
  };
}

/**
 * Git reports a move as a deletion plus an addition when the file also changed a lot. When
 * exactly one deleted test file and one added test file share a file name, treat them as one
 * moved file, so the test rules compare their contents instead of reporting a deleted test.
 */
function pairMovedTests(files: readonly FileChange[], ctx: AnalysisContext): (FileChange & { pairedMove?: boolean })[] {
  const deleted = new Map<string, FileChange[]>();
  const added = new Map<string, FileChange[]>();
  for (const file of files) {
    if (file.status === 'deleted' && file.old !== null && ctx.tests.isTest(file.old.path)) {
      push(deleted, basename(file.old.path), file);
    } else if (file.status === 'added' && file.new !== null && ctx.tests.isTest(file.new.path)) {
      push(added, basename(file.new.path), file);
    }
  }
  const merged = new Map<FileChange, FileChange & { pairedMove: boolean }>();
  const dropped = new Set<FileChange>();
  for (const [name, gone] of deleted) {
    const came = added.get(name);
    if (gone.length !== 1 || came?.length !== 1) continue;
    const [from] = gone;
    const [to] = came;
    if (from === undefined || to === undefined) continue;
    merged.set(to, { status: 'renamed', path: to.path, old: from.old, new: to.new, pairedMove: true });
    dropped.add(from);
  }
  return files.filter((f) => !dropped.has(f)).map((f) => merged.get(f) ?? f);
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/** Lines of `side` at the given 1-based line numbers, from one of its views. */
export function linesAt(view: readonly string[], lineNumbers: readonly number[]): string[] {
  return lineNumbers.map((n) => view[n - 1] ?? '');
}
