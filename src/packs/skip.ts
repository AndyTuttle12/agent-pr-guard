import type { AnalyzedFile, SideView } from '../engine/analyze.js';
import type { RulePack } from '../engine/engine.js';
import type { RuleHit } from '../engine/finding.js';
import type { TestLanguage } from '../engine/syntax.js';
import { fileConstraint, narrows } from './build-constraint.js';
import { hunkLines, scanLine, type Pattern } from './scan.js';

type Marker = 'skipped' | 'focused' | 'todo';

/** A runner call, with chained modifiers: `it`, `test.concurrent`, `test.describe`, `it.each`. */
const JS_RUNNER = String.raw`(?<![\w$.])(?:it|test|describe|context|suite|specify|bench)(?:\s*\.\s*(?:concurrent|sequential|serial|parallel|describe|each))*\s*\.\s*`;
const GINKGO = '(?:It|Describe|Context|When|Specify|Entry|DescribeTable)';

/**
 * Markers that stop a test from running, on the code view so a commented-out or quoted marker
 * never counts. One pass per line, todo before focused before skipped, so one span matches once.
 */
const MARKERS: Readonly<Record<TestLanguage, readonly Pattern<Marker>[]>> = {
  js: [
    { tag: 'todo', re: new RegExp(`${JS_RUNNER}todo\\b`, 'g') },
    { tag: 'todo', re: /(?<![\w$.])t\s*\.\s*todo\s*\(/g },
    { tag: 'todo', re: /\btodo\s*:\s*(?:true\b|['"`])/g, name: 'todo option' },
    { tag: 'todo', re: /(?<![\w$.])(?:it|test|specify)\s*\(\s*(['"`]) *\1\s*\)/g, name: 'a test with no body' },
    { tag: 'focused', re: new RegExp(`${JS_RUNNER}only\\b`, 'g') },
    { tag: 'focused', re: /(?<![\w$.])f(?:it|describe)\s*\(/g },
    { tag: 'focused', re: /\bonly\s*:\s*true\b/g, name: 'only option' },
    { tag: 'skipped', re: new RegExp(`${JS_RUNNER}(?:skipIf|skip|fixme|fails|fail)\\b`, 'g') },
    { tag: 'skipped', re: /(?<![\w$.])x(?:it|test|describe|context|specify)\s*\(/g },
    { tag: 'skipped', re: /(?<![\w$.])(?:this|t|ctx|context)\s*\.\s*skip\s*\(/g },
    { tag: 'skipped', re: /\bskip\s*:\s*(?:true\b|['"`])/g, name: 'skip option' },
  ],
  python: [
    { tag: 'skipped', re: /(?<![\w.])(?:pytest\s*\.\s*)?mark\s*\.\s*(?:skipif|skip|xfail)\b/g },
    { tag: 'skipped', re: /\bpytest\s*\.\s*(?:skip|xfail|importorskip)\s*\(/g },
    { tag: 'skipped', re: /\bunittest\s*\.\s*(?:skipIf|skipUnless|skip|expectedFailure)\b/g },
    { tag: 'skipped', re: /@\s*(?:skipIf|skipUnless|skip|expectedFailure)\b/g },
    { tag: 'skipped', re: /\.\s*skipTest\s*\(/g },
    { tag: 'skipped', re: /(?<![\w.])SkipTest\s*\(/g },
    { tag: 'skipped', re: /(?<![\w.])__test__\s*=\s*False\b/g },
  ],
  go: [
    { tag: 'todo', re: new RegExp(`(?<![\\w.])P${GINKGO}\\s*\\(`, 'g') },
    { tag: 'todo', re: /(?<![\w.])Pending\b/g },
    { tag: 'focused', re: new RegExp(`(?<![\\w.])F${GINKGO}\\s*\\(`, 'g') },
    { tag: 'focused', re: /(?<![\w.])Focus\b/g },
    { tag: 'skipped', re: /(?:\b(?:t|b|tb|f)|\bT\s*\(\s*\))\s*\.\s*Skip(?:f|Now)?\s*\(/g },
    { tag: 'skipped', re: new RegExp(`(?<![\\w.])X${GINKGO}\\s*\\(`, 'g') },
    { tag: 'skipped', re: /(?<![\w.])Skip\s*\(/g },
  ],
};

/** A test call whose first argument is its title; group 1 is the opening quote. */
const TITLED_CALL: Readonly<Record<TestLanguage, RegExp | null>> = {
  js: /(?<![\w$.])[fx]?(?:it|test|specify|describe|context|suite)(?:\s*\.\s*\w+)*\s*\(\s*(['"`])/g,
  python: null,
  go: new RegExp(`(?<![\\w.])[FPX]?${GINKGO}\\s*\\(\\s*(["\`])`, 'g'),
};

/** A test definition, for the commented-out rule; group `name` is its title or function name. */
const DEFINITION: Readonly<Record<TestLanguage, RegExp>> = {
  js: /(?<![\w$.])(?:it|test|specify)(?:\s*\.\s*\w+)*\s*\(\s*(['"`])(?<name>[^'"`]*)\1?/g,
  python: /(?<![\w.])def\s+(?<name>test\w*)\s*\(/g,
  go: /(?<![\w.])func\s+(?:\([^)]*\)\s*)?(?<name>(?:Test|Benchmark|Fuzz)\w*)\s*\(/g,
};

export const skipPack: RulePack = {
  id: 'skip',
  rules: [
    {
      id: 'skip/skipped',
      summary: 'A test was newly skipped or marked as expected to fail (it.skip, xit, pytest.mark.skip, xfail, t.Skip).',
    },
    {
      id: 'skip/focused',
      summary: 'A test was focused (.only, fit, fdescribe, Ginkgo FIt), so the other tests in the run are skipped.',
    },
    { id: 'skip/todo', summary: 'An existing test was turned into a todo or pending test (it.todo, a test with no body, Ginkgo PIt).' },
    { id: 'skip/build-tag', summary: 'A Go test file gained a build constraint that keeps it out of builds where it used to run.' },
    { id: 'skip/commented-out', summary: 'A test was commented out (or wrapped in a string) instead of deleted.' },
    {
      id: 'skip/renamed-out',
      summary: 'A test function was renamed so the runner no longer collects it (test_x → _test_x, TestX → testX).',
    },
  ],
  check({ files }) {
    const hits: RuleHit[] = [];
    for (const file of files) {
      const sides = testSides(file);
      if (sides === null) continue;
      const { neu, old, language } = sides;
      const now = markersIn(neu, language);
      hits.push(...newMarkerHits(file, now, old === null ? [] : markersIn(old, language), 'focused'));
      // An added test file weakens nothing that ran before; only a focus reaches other tests.
      if (old === null) continue;
      const fallbacks = newTestFallbacks(old, neu, now, language);
      const counted = now.filter((f) => !fallbacks.has(f.line));
      hits.push(...newMarkerHits(file, counted, markersIn(old, language), 'skipped'));
      hits.push(...todoHits(file, now, old, neu, language));
      hits.push(...commentedOutHits(file, old, neu, language));
      if (language !== 'js') hits.push(...renamedOutHits(file, language));
      if (language === 'go') hits.push(...buildTagHits(file, old, neu));
    }
    return hits;
  },
};

/** The head side of a test file, and its base side when that was a test in the same language. */
function testSides(file: AnalyzedFile): { neu: SideView; old: SideView | null; language: TestLanguage } | null {
  const neu = file.new;
  if (neu === null || !file.newIsTest || neu.language === null) return null;
  const old = file.old !== null && file.oldIsTest && file.old.language === neu.language ? file.old : null;
  return { neu, old, language: neu.language };
}

interface Found {
  readonly tag: Marker;
  readonly name: string;
  /** 1-based. */
  readonly line: number;
  readonly column: number;
}

function markersIn(view: SideView, language: TestLanguage): Found[] {
  return view.code.flatMap((text, i) =>
    scanLine(text, MARKERS[language])
      .filter((m) => !(language === 'go' && m.tag === 'skipped' && shortModeOnly(view.code, i)))
      .map((m) => ({ tag: m.tag, name: m.name, line: i + 1, column: m.index })),
  );
}

/** A test's header line, anchored at its indentation; the name is read with `DEFINITION`. */
const TEST_HEADER: Readonly<Record<TestLanguage, RegExp>> = {
  js: /^\s*(?:it|test|specify)(?:\s*\.\s*\w+)*\s*\(\s*['"`]/,
  python: /^\s*(?:async\s+)?def\s+test\w*\s*\(/,
  go: /^func\s+(?:\([^)]*\)\s*)?(?:Test|Benchmark|Fuzz)\w*\s*\(/,
};

/** Block headers that run their body only on a condition: if, else, and an exception handler. */
const CONDITIONAL_HEADER: Readonly<Record<TestLanguage, RegExp>> = {
  js: /^(?:\}\s*)?(?:if|else|catch)\b/,
  python: /^(?:if|elif|else|except)\b/,
  go: /^(?:\}\s*)?(?:if|else)\b/,
};

const ALWAYS_TRUE_IF = /^(?:\}\s*)?(?:if|elif)\s*\(?\s*(?:True|true|1)\s*\)?\s*[:{]?\s*$/;

/** Markers that skip only when their condition holds: a missing module, a skipif condition. */
const CONDITIONAL_MARKER = /(?:importorskip|skipif|skipIf|skipUnless)$/;

/**
 * Lines of skip markers that are an environment fallback in a test the base side did not have:
 * the skip sits in an if/else or exception-handler block of that test, or is a skipif-style or
 * importorskip marker whose condition is not a constant. A new test that skips on a host without
 * the dependency it needs weakens nothing that ran before. When any base test's name is gone
 * from the head side, no test counts as new, since a renamed test would pass for one.
 */
function newTestFallbacks(old: SideView, neu: SideView, now: readonly Found[], language: TestLanguage): Set<number> {
  const out = new Set<number>();
  const before = testNames(old, language);
  const after = testNames(neu, language);
  if ([...before].some((name) => !after.has(name))) return out;
  for (const found of now) {
    if (found.tag !== 'skipped') continue;
    const owner = owningTest(neu, found, language);
    if (owner !== null && owner.conditional && !before.has(owner.name)) out.add(found.line);
  }
  return out;
}

function testNames(view: SideView, language: TestLanguage): Set<string> {
  const out = new Set<string>();
  view.code.forEach((_, i) => {
    const name = testNameAt(view, i, language);
    if (name !== null) out.add(name);
  });
  return out;
}

function testNameAt(view: SideView, index: number, language: TestLanguage): string | null {
  if (!TEST_HEADER[language].test(view.code[index] ?? '')) return null;
  const re = new RegExp(DEFINITION[language].source);
  const source = language === 'js' ? view.lines[index] : view.code[index];
  return re.exec(source ?? '')?.groups?.['name'] ?? null;
}

const indentOf = (text: string): number => text.length - text.trimStart().length;

/** The test a skip marker belongs to, and whether it skips only on a condition. */
function owningTest(view: SideView, found: Found, language: TestLanguage): { name: string; conditional: boolean } | null {
  const index = found.line - 1;
  const code = view.code[index] ?? '';
  if (language === 'python' && code.trimStart().startsWith('@')) return decoratedTest(view, index, found);
  const header = CONDITIONAL_HEADER[language];
  let conditional =
    CONDITIONAL_MARKER.test(found.name) ||
    (header.test(code.trim()) && !ALWAYS_TRUE_IF.test(code.trim()) && found.column > indentOf(code));
  let limit = indentOf(code);
  for (let j = index - 1; j >= 0 && limit > 0; j--) {
    const text = view.code[j] ?? '';
    if (text.trim() === '' || indentOf(text) >= limit) continue;
    limit = indentOf(text);
    const name = testNameAt(view, j, language);
    if (name !== null) return { name, conditional };
    if (header.test(text.trim()) && !ALWAYS_TRUE_IF.test(text.trim())) conditional = true;
  }
  return null;
}

/** A skip decorator applies to the `def test_*` below it; it is conditional when skipif-style. */
function decoratedTest(view: SideView, index: number, found: Found): { name: string; conditional: boolean } | null {
  const indent = indentOf(view.code[index] ?? '');
  for (let j = index + 1; j < view.code.length; j++) {
    const text = view.code[j] ?? '';
    const trimmed = text.trim();
    if (trimmed === '' || indentOf(text) > indent || trimmed.startsWith('@') || trimmed.startsWith(')')) continue;
    const name = testNameAt(view, j, 'python');
    if (name === null) return null;
    return { name, conditional: CONDITIONAL_MARKER.test(found.name) && hasCondition(view, index, found.column) };
  }
  return null;
}

/** The first argument of a skipif-style call is a real condition, not a constant or a bare reason. */
function hasCondition(view: SideView, index: number, column: number): boolean {
  const text = view.code.slice(index, index + 4).join(' ').slice(column);
  const open = text.indexOf('(');
  if (open === -1) return false;
  return !/^\s*(?:(?:True|False|None|0|1)\s*[,)]|reason\s*=|\))/.test(text.slice(open + 1));
}

/** `if testing.Short() { t.Skip() }` skips only under `go test -short`, which CI rarely sets. */
function shortModeOnly(code: readonly string[], index: number): boolean {
  return code.slice(Math.max(0, index - 2), index + 1).some((l) => /\btesting\s*\.\s*Short\s*\(\s*\)/.test(l));
}

const REASONS: Readonly<Record<'skipped' | 'focused', (name: string) => string>> = {
  skipped: (name) => `${name} added: the test no longer runs`,
  focused: (name) => `${name} added: only focused tests run, so the others are skipped`,
};

/**
 * Counted over the whole file, so a marker that only moved is not new. When the count rises,
 * the new markers are picked from the added lines, preferring lines that were not just moved.
 */
function newMarkerHits(file: AnalyzedFile, now: readonly Found[], was: readonly Found[], tag: 'skipped' | 'focused'): RuleHit[] {
  const current = now.filter((f) => f.tag === tag);
  const extra = current.length - was.filter((f) => f.tag === tag).length;
  if (extra <= 0) return [];
  const added = addedLines(file);
  const moved = removedTexts(file);
  const fresh: Found[] = [];
  const relocated: Found[] = [];
  for (const found of current.filter((f) => added.has(f.line))) {
    const text = (file.new?.lines[found.line - 1] ?? '').trim();
    const left = moved.get(text) ?? 0;
    if (left > 0) {
      moved.set(text, left - 1);
      relocated.push(found);
    } else {
      fresh.push(found);
    }
  }
  return [...fresh, ...relocated].slice(0, extra).map((f) => ({
    ruleId: `skip/${tag}`,
    file: file.path,
    line: f.line,
    reason: REASONS[tag](f.name),
  }));
}

function addedLines(file: AnalyzedFile): Set<number> {
  return new Set(file.hunks.flatMap((h) => h.added.map((l) => l.line)));
}

function removedTexts(file: AnalyzedFile): Map<string, number> {
  const out = new Map<string, number>();
  for (const hunk of file.hunks) for (const l of hunk.removed) out.set(l.text.trim(), (out.get(l.text.trim()) ?? 0) + 1);
  return out;
}

/**
 * A todo marker counts only when its title belonged to a live test before and no live test
 * carries it now: a brand-new todo is a placeholder, not a weakened test.
 */
function todoHits(file: AnalyzedFile, now: readonly Found[], old: SideView, neu: SideView, language: TestLanguage): RuleHit[] {
  const titled = TITLED_CALL[language];
  if (titled === null) return [];
  const added = addedLines(file);
  const todoLines = (found: readonly Found[]): Set<number> => new Set(found.filter((f) => f.tag === 'todo').map((f) => f.line));
  const liveBefore = liveTitles(old, titled, todoLines(markersIn(old, language)));
  const liveNow = liveTitles(neu, titled, todoLines(now));
  const hits: RuleHit[] = [];
  for (const found of now) {
    if (found.tag !== 'todo' || !added.has(found.line)) continue;
    const title = titlesOnLine(neu, found.line - 1, titled)[0];
    if (title === undefined || !liveBefore.has(title) || liveNow.has(title)) continue;
    hits.push({ ruleId: 'skip/todo', file: file.path, line: found.line, reason: `test "${title}" turned into ${found.name}` });
  }
  return hits;
}

function liveTitles(view: SideView, titled: RegExp, todo: ReadonlySet<number>): Set<string> {
  const out = new Set<string>();
  view.code.forEach((_, i) => {
    if (!todo.has(i + 1)) for (const title of titlesOnLine(view, i, titled)) out.add(title);
  });
  return out;
}

/** Titles read from the raw line, at the quotes the code view kept (their contents are blanked). */
function titlesOnLine(view: SideView, index: number, titled: RegExp): string[] {
  const code = view.code[index] ?? '';
  const raw = view.lines[index] ?? '';
  const out: string[] = [];
  for (const m of code.matchAll(titled)) {
    const quote = m[1];
    if (quote === undefined) continue;
    const open = m.index + m[0].length;
    const close = code.indexOf(quote, open);
    if (close !== -1) out.push(raw.slice(open, close));
  }
  return out;
}

/**
 * Definitions visible in the raw text but not in the code view sit in a comment or a string.
 * When the file lost live definitions and gained disabled ones, each newly disabled name is
 * reported at its line (the definition line itself may be unchanged, as when a test is wrapped
 * in a block comment or a triple-quoted string).
 */
function commentedOutHits(file: AnalyzedFile, old: SideView, neu: SideView, language: TestLanguage): RuleHit[] {
  const re = DEFINITION[language];
  const live = (v: SideView): number => v.code.reduce((n, l) => n + [...l.matchAll(re)].length, 0);
  const disabled = (v: SideView): { name: string; line: number }[] =>
    v.lines.flatMap((_, i) => disabledOn(v, i, re).map((name) => ({ name, line: i + 1 })));
  const before = disabled(old);
  const after = disabled(neu);
  const budget = Math.min(after.length - before.length, live(old) - live(neu));
  if (budget <= 0) return [];
  const known = new Map<string, number>();
  for (const d of before) known.set(d.name, (known.get(d.name) ?? 0) + 1);
  const fresh = after.filter((d) => {
    const left = known.get(d.name) ?? 0;
    if (left > 0) known.set(d.name, left - 1);
    return left === 0;
  });
  return fresh.slice(0, budget).map((d) => ({
    ruleId: 'skip/commented-out',
    file: file.path,
    line: d.line,
    reason: `test ${d.name} commented out instead of deleted`,
  }));
}

function disabledOn(view: SideView, index: number, re: RegExp): string[] {
  const inCode = [...(view.code[index] ?? '').matchAll(re)].length;
  const names = [...(view.lines[index] ?? '').matchAll(re)].map((m) => m.groups?.['name'] ?? '?');
  return names.slice(0, Math.max(0, names.length - inCode));
}

interface Definition {
  readonly name: string;
  readonly collected: boolean;
  readonly line: number;
}

/** Python test functions and classes, Go test functions (methods too, for testify suites). */
function definitionsIn(lines: readonly { line: number; text: string }[], language: TestLanguage): Definition[] {
  const out: Definition[] = [];
  for (const { line, text } of lines) {
    if (language === 'python') {
      const def = /^\s*(?:async\s+)?def\s+(\w+)\s*\(/.exec(text);
      if (def?.[1] !== undefined) out.push({ name: def[1], collected: def[1].startsWith('test'), line });
      const cls = /^\s*class\s+(\w+)\s*(?:\((.*)\))?\s*:?/.exec(text);
      if (cls?.[1] !== undefined) {
        out.push({ name: cls[1], collected: cls[1].startsWith('Test') || /\bTestCase\b/.test(cls[2] ?? ''), line });
      }
    } else if (language === 'go') {
      const fn = /^func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(/.exec(text);
      if (fn?.[1] !== undefined) {
        out.push({ name: fn[1], collected: /^(?:Test|Benchmark|Fuzz)(?![a-z])/.test(fn[1]) && fn[1] !== 'TestMain', line });
      }
    }
  }
  return out;
}

/** Lower-cased letters and digits, without the first `test`: `_test_foo`, `xtest_foo` → `foo`, `xfoo`. */
function core(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace('test', '');
}

/**
 * Within one hunk, a collected test whose definition line was replaced by one with a related
 * name the runner skips. A whole file moved out of the test patterns is the deletion pack's.
 */
function renamedOutHits(file: AnalyzedFile, language: TestLanguage): RuleHit[] {
  if (file.new === null) return [];
  const stillCollected = new Set(
    definitionsIn(
      file.new.code.map((text, i) => ({ line: i + 1, text })),
      language,
    )
      .filter((d) => d.collected)
      .map((d) => d.name),
  );
  const hits: RuleHit[] = [];
  for (const hunk of file.hunks) {
    const { removed, added } = hunkLines(hunk, file, (s) => s.code);
    const gone = definitionsIn(removed, language).filter((d) => d.collected && !stillCollected.has(d.name));
    const came = definitionsIn(added, language).filter((d) => !d.collected);
    for (const was of gone) {
      const key = core(was.name);
      const index = came.findIndex((d) => key !== '' && (core(d.name).endsWith(key) || core(d.name).startsWith(key)));
      const now = came[index];
      if (now === undefined) continue;
      came.splice(index, 1);
      hits.push({
        ruleId: 'skip/renamed-out',
        file: file.path,
        line: now.line,
        reason: `${was.name} renamed to ${now.name}, which the test runner does not collect`,
      });
    }
  }
  return hits;
}

function buildTagHits(file: AnalyzedFile, old: SideView, neu: SideView): RuleHit[] {
  const was = fileConstraint(old.path, old.lines);
  const now = fileConstraint(neu.path, neu.lines);
  if (was === null || now === null || now.text === null) return [];
  if (!narrows(was.constraint, now.constraint, was.text ?? '', now.text)) return [];
  return [
    {
      ruleId: 'skip/build-tag',
      file: file.path,
      line: now.line,
      reason:
        was.text === null
          ? `build constraint added (${now.text}): go test no longer runs this file everywhere it did`
          : `build constraint narrowed from (${was.text}) to (${now.text}): go test no longer runs this file everywhere it did`,
    },
  ];
}
