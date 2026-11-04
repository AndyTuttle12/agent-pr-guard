import type { AnalyzedFile, SideView } from '../engine/analyze.js';
import type { RulePack } from '../engine/engine.js';
import type { RuleHit } from '../engine/finding.js';
import { anchorLine, type Hunk } from '../engine/line-diff.js';
import type { TestLanguage } from '../engine/syntax.js';
import { subjectsOf } from '../engine/test-files.js';
import { hunkLines, plural, scanLine, type Pattern, type SideLine } from './scan.js';
import { assertView } from './node-assert.js';
import { callArgs, tolerancesIn, type Tolerance } from './tolerance.js';

/** An `expect(...)` call, in any of its recognised forms. */
const EXPECT_CALL = /\bexpect(?:\s*\.\s*(?:soft|poll|element|assertions|hasAssertions))?\s*\(/;

/** An assert-module call: `assert(...)`, `assert.ok(...)`, `assert.strict.equal(...)`. */
const ASSERT_CALL = /(?<![\w$])assert(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\(/;

/**
 * What counts as one assertion, on the code view (comments and string contents blanked), so a
 * commented-out assertion counts as removed. A chained `expect(x).not.toBe(y)` is one assertion.
 * JS is read through `assertView`, so a check imported by name from the assert module counts.
 */
const ASSERTIONS: Readonly<Record<TestLanguage, readonly Pattern<'assertion'>[]>> = {
  js: [
    { tag: 'assertion', re: new RegExp(EXPECT_CALL.source, 'g') },
    { tag: 'assertion', re: /\b(?:expectTypeOf|assertType)\s*\(/g },
    { tag: 'assertion', re: new RegExp(ASSERT_CALL.source, 'g') },
    { tag: 'assertion', re: /\.\s*should\s*\./g },
    {
      tag: 'assertion',
      re: /\bt\s*\.\s*(?:is|not|deepEqual|notDeepEqual|like|true|false|truthy|falsy|regex|notRegex|throws|throwsAsync|notThrows|notThrowsAsync|snapshot|equal|notEqual|same|notSame|strictSame|match|ok|notOk|rejects|resolves)\s*\(/g,
    },
  ],
  python: [
    { tag: 'assertion', re: /(?<![\w.])assert\b/g },
    { tag: 'assertion', re: /(?<!\w)assert(?:[A-Z]|_)\w*\s*\(/g },
    { tag: 'assertion', re: /(?<!\w)(?:raises|warns|deprecated_call)\s*\(/g },
  ],
  go: [
    { tag: 'assertion', re: /\b(?:t|b|tb|f)\s*\.\s*(?:Errorf|Error|Fatalf|Fatal|Fail|FailNow)\s*\(/g },
    { tag: 'assertion', re: /\b(?:assert|require)\s*\.\s*[A-Z]\w*\s*\(/g },
    { tag: 'assertion', re: /\.\s*(?:Assert|Require)\s*\(\s*\)\s*\.\s*[A-Z]\w*\s*\(/g },
    { tag: 'assertion', re: /\b(?:Expect|Eventually|Consistently)\s*\(/g },
  ],
};

/**
 * Strength classes for the loosening rule. `strong` checks an exact value; `weak` only checks
 * that something exists or is truthy; `demoted` looks like a check but cannot fail the test
 * (Go's `t.Logf`). Order matters: a weak form is matched and blanked before the strong forms run.
 */
type Strength = 'strong' | 'weak' | 'demoted';

const STRENGTH: Readonly<Record<TestLanguage, readonly Pattern<Strength>[]>> = {
  js: [
    { tag: 'weak', re: /\.\s*\w+\s*\(\s*expect\s*\.\s*(?:anything|any)\s*\(/g, name: 'expect.anything()' },
    { tag: 'weak', re: /\.\s*not\s*\.\s*toBe(?:Null|Undefined)\s*\(/g },
    { tag: 'weak', re: /\.\s*toBe(?:Defined|Truthy|Falsy)\s*\(/g },
    { tag: 'weak', re: /\.\s*(?:toHaveBeenCalled|toBeCalled)\s*\(/g },
    { tag: 'weak', re: /\.\s*toThrow(?:Error)?\s*\(\s*\)/g, name: 'toThrow()' },
    { tag: 'weak', re: /\bassert(?:\s*\.\s*strict)?\s*\.\s*ok\s*\(/g },
    { tag: 'weak', re: /(?<![\w$.])assert(?:\s*\.\s*strict)?\s*\(/g },
    { tag: 'weak', re: /\.\s*to\s*\.\s*(?:be\s*\.\s*)?(?:ok|true|exist)\b/g },
    { tag: 'weak', re: /\.\s*not\s*\.\s*to\s*\.\s*be\s*\.\s*(?:null|undefined)\b/g },
    { tag: 'weak', re: /\bt\s*\.\s*(?:truthy|true|ok|pass)\s*\(/g },
    {
      tag: 'strong',
      re: /\.\s*(?:toEqual|toStrictEqual|toBe|toMatchObject|toHaveLength|toContain|toContainEqual|toHaveProperty|toHaveBeenCalledWith|toHaveBeenCalledTimes|toHaveBeenLastCalledWith|toHaveBeenNthCalledWith|toHaveReturnedWith|toBeCalledWith|toBeCalledTimes|toMatch|toMatchSnapshot|toMatchInlineSnapshot|toMatchFileSnapshot|toBeNull|toBeUndefined|toBeNaN|toBeInstanceOf|toThrow|toThrowError|toThrowErrorMatchingSnapshot|toThrowErrorMatchingInlineSnapshot|toBeCloseTo)\s*\(/g,
    },
    {
      tag: 'strong',
      re: /\bassert(?:\s*\.\s*strict)?\s*\.\s*(?:equal|strictEqual|deepEqual|deepStrictEqual|partialDeepStrictEqual|throws|rejects|match)\s*\(/g,
    },
    { tag: 'strong', re: /\.\s*to\s*\.(?:\s*\w+\s*\.)*?\s*(?:equal|equals|eql|eq|lengthOf|members|property|throw)\s*\(/g },
    { tag: 'strong', re: /\bt\s*\.\s*(?:is|deepEqual|like|snapshot|same|strictSame|equal|throws|throwsAsync)\s*\(/g },
  ],
  python: [
    { tag: 'weak', re: /(?<!\w)assert(?:True|False|IsNotNone)\s*\(/g },
    { tag: 'weak', re: /\.\s*assert_(?:called|awaited)\s*\(/g },
    { tag: 'weak', re: /(?<!\w)(?:raises|assertRaises)\s*\(\s*(?:Exception|BaseException)\s*[,)]/g, name: 'raises(Exception)' },
    { tag: 'weak', re: /(?<![\w.])assert\b(?=.*(?:\bis\s+not\s+None\b|!=\s*None\b))/g, name: 'assert x is not None' },
    { tag: 'strong', re: /(?<![\w.])assert\b(?=.*(?:[=!<>]=|[<>]|\bin\b|\bis\b|\bisinstance\s*\())/g, name: 'assert x == y' },
    {
      tag: 'strong',
      re: /(?<!\w)assert(?:Equals?|DictEqual|ListEqual|SetEqual|TupleEqual|SequenceEqual|CountEqual|ItemsEqual|MultiLineEqual|Is|IsNone|IsInstance|In|NotIn|Raises|RaisesRegexp?|Warns|WarnsRegex|AlmostEquals?|Greater|GreaterEqual|Less|LessEqual|Regexp?|RegexpMatches|Logs)\s*\(/g,
    },
    {
      tag: 'strong',
      re: /\.\s*assert_(?:called_once_with|called_with|called_once|has_calls|not_called|any_call|awaited_once_with|awaited_with|awaited_once)\s*\(/g,
    },
    { tag: 'strong', re: /(?<!\w)raises\s*\(/g },
    { tag: 'weak', re: /(?<![\w.])assert\b/g, name: 'assert x' },
  ],
  go: [
    { tag: 'demoted', re: /\b(?:t|b|tb|f)\s*\.\s*Logf?\s*\(/g },
    { tag: 'demoted', re: /\b(?:fmt|log)\s*\.\s*Print(?:f|ln)?\s*\(/g },
    { tag: 'weak', re: /\b(?:assert|require)\s*\.\s*(?:NotNil|NotEmpty|True|False|NotZero|Error|Condition)\s*\(/g },
    { tag: 'strong', re: /\b(?:t|b|tb|f)\s*\.\s*(?:Errorf|Error|Fatalf|Fatal|Fail|FailNow)\s*\(/g },
    {
      tag: 'strong',
      re: /\b(?:assert|require)\s*\.\s*(?:Equal|EqualValues|Exactly|EqualError|ErrorIs|ErrorAs|ErrorContains|Len|Contains|ElementsMatch|JSONEq|YAMLEq|Same|Subset|Regexp|InDelta|InEpsilon)\s*\(/g,
    },
  ],
};

export const assertionPack: RulePack = {
  id: 'assertion',
  rules: [
    {
      id: 'assertion/removed',
      summary:
        'The test files in the change hold fewer assertions than before, counted across all of them so a moved assertion is not a removal (a commented-out assertion counts as removed).',
    },
    {
      id: 'assertion/loosened',
      summary: 'An exact assertion was replaced by a weaker one (toEqual → toBeDefined, assertEqual → assertTrue, t.Errorf → t.Logf).',
    },
    {
      id: 'assertion/tolerance-widened',
      summary: 'A numeric tolerance in a test was widened, or a precision was lowered.',
    },
  ],
  check({ files }) {
    const hits: RuleHit[] = [];
    const tallies: Tally[] = [];
    for (const file of files) {
      const language = comparableLanguage(file);
      let demoted = 0;
      if (language !== null) {
        const loosened = language === 'js' && isAssertPort(file) ? { hits: portLoosenedHits(file), demoted: 0 } : loosenedHits(file, language);
        hits.push(...loosened.hits);
        hits.push(...toleranceHits(file));
        demoted = loosened.demoted;
      }
      const tally = tallyOf(file, demoted);
      if (tally !== null) tallies.push(tally);
    }
    hits.push(...removedHits(tallies, files));
    return hits;
  },
};

/** Both sides readable and in one of the test languages, with a test file on at least one side. */
function comparableLanguage(file: AnalyzedFile): TestLanguage | null {
  if (file.old === null || file.new === null) return null;
  if (!(file.oldIsTest || file.newIsTest)) return null;
  const language = file.new.language;
  if (language === null || file.old.language !== language) return null;
  return language;
}

/** One file's assertion count on each side; a side counts only when it is a test file. */
interface Tally {
  readonly file: AnalyzedFile;
  readonly before: number;
  readonly after: number;
  /** Demotions (t.Errorf → t.Logf), already reported as loosened. */
  readonly demoted: number;
}

function tallyOf(file: AnalyzedFile, demoted: number): Tally | null {
  if (!(file.oldIsTest || file.newIsTest)) return null;
  return {
    file,
    before: file.oldIsTest ? assertionCount(file.old) : 0,
    after: file.newIsTest ? assertionCount(file.new) : 0,
    demoted,
  };
}

function assertionCount(side: SideView | null): number {
  if (side === null || side.language === null) return 0;
  const language = side.language;
  const code = assertView(side);
  return code.reduce((n, _line, i) => n + assertionsOn(code, i, language), 0);
}

/** A line holding only `expect`, after an optional `await` or `return`: a chain broken before its first call. */
const BARE_EXPECT = /^\s*(?:(?:await|return)\s+)?expect\s*$/;

/**
 * The assertions on one 0-based line of a code view. A chain a formatter broke after a bare
 * `expect` (`await expect` on its own line, `.poll(...)` on the next) counts on the `expect` line,
 * which has no call of its own to match.
 */
function assertionsOn(code: readonly string[], index: number, language: TestLanguage): number {
  const line = code[index] ?? '';
  const found = scanLine(line, ASSERTIONS[language]).length;
  if (language !== 'js' || !BARE_EXPECT.test(line)) return found;
  return /^\s*\./.test(code[index + 1] ?? '') ? found + 1 : found;
}

/** The assertions on some lines of one side, each read in the context of that side's code view. */
function assertionsIn(lines: readonly SideLine[], side: SideView | null, language: TestLanguage): number {
  if (side === null) return 0;
  const code = assertView(side);
  return lines.reduce((n, l) => n + assertionsOn(code, l.line - 1, language), 0);
}

/**
 * Assertions are counted over every test file in the change, so one moved to another test file
 * is not a removal. When the total drops, each test file still on the head side that lost
 * assertions is reported. A deleted test file, or one moved out of the test patterns, counts in
 * the total but is the deletion pack's to report.
 */
function removedHits(tallies: readonly Tally[], files: readonly AnalyzedFile[]): RuleHit[] {
  const sum = (pick: (t: Tally) => number): number => tallies.reduce((n, t) => n + pick(t), 0);
  const before = sum((t) => t.before);
  const after = sum((t) => t.after);
  const missing = before - after - sum((t) => t.demoted);
  if (missing <= 0) return [];
  const hits: RuleHit[] = [];
  for (const { file, before: was, after: now, demoted } of tallies) {
    const lost = was - now - demoted;
    if (lost <= 0 || file.new === null || !file.newIsTest || file.new.language === null) continue;
    const language = file.new.language;
    const losing = file.hunks.filter((h) => netRemoved(h, file, language) > 0);
    const first = losing[0];
    const consolidated = losing.length > 0 && losing.every((h) => isConsolidation(h, file, language));
    const retired = consolidated ? null : retiredWith(file, losing, files);
    const across = tallies.length > 1 ? `; ${before} before and ${after} after across the test files in the change` : '';
    const counts = `(${was} before, ${now} after${across})`;
    const hit: RuleHit = {
      ruleId: 'assertion/removed',
      file: file.path,
      line: first === undefined ? null : anchorLine(first, file.new.lines.length),
      reason: consolidated
        ? `${plural(lost, 'assertion')} folded into fewer, whole-value checks ${counts}`
        : retired !== null
          ? `${plural(lost, 'assertion')} removed along with ${retired} ${counts}`
          : `${plural(lost, 'assertion')} removed ${counts}`,
    };
    hits.push(consolidated || retired !== null ? { ...hit, severity: 'warning' } : hit);
  }
  return hits;
}

/**
 * The code the lost assertions checked, when it left in the same change: the test file's subject
 * (`subjectsOf`) was deleted, or every hunk that lost assertions names something the subject
 * declared before and that neither the new subject nor the new test file names any more. That is
 * how a retired feature looks; the guard cannot tell it from a test removed to get green, so it
 * warns. Null when neither holds, or a subject could not be read.
 */
function retiredWith(file: AnalyzedFile, losing: readonly Hunk[], files: readonly AnalyzedFile[]): string | null {
  if (file.newPath === null || file.new === null || losing.length === 0) return null;
  const subjects = subjectsOf(file.newPath, files);
  const deleted = subjects.find((s) => s.newPath === null);
  if (deleted !== undefined) return `${deleted.oldPath ?? deleted.path}, the code they tested`;
  if (subjects.length === 0 || subjects.some((s) => s.old === null || s.new === null)) return null;
  const declared = new Set(subjects.flatMap((s) => (s.old === null ? [] : declaredNames(s.old))));
  const present = new Set([...subjects.flatMap((s) => (s.new === null ? [] : namesIn(s.new.codeWithStrings))), ...namesIn(file.new.codeWithStrings)]);
  const gone = new Set([...declared].filter((name) => !present.has(name)));
  const named: string[] = [];
  for (const hunk of losing) {
    const { removed } = hunkLines(hunk, file, (s) => s.code);
    const hit = namesIn(removed.map((l) => l.text)).find((name) => gone.has(name));
    if (hit === undefined) return null;
    if (!named.includes(hit)) named.push(hit);
  }
  const where = subjects[0]?.path ?? 'the subject';
  return `${named.map((n) => `\`${n}\``).join(', ')}, which ${where} no longer declares`;
}

/**
 * Top-level declarations, the names a test imports or calls: JS/TS functions, classes, variables,
 * types and enums at the start of a line (exported or not); Python functions and classes, methods
 * included; Go functions, methods, types, variables and constants. Locals inside a body are left
 * out, so a renamed local never stands in for a retired function.
 */
const DECLARATION: Readonly<Record<TestLanguage, RegExp>> = {
  js: /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\s*\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  python: /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/,
  go: /^(?:func\s+(?:\([^)]*\)\s*)?|type\s+|var\s+|const\s+)([A-Za-z_]\w*)/,
};

function declaredNames(side: SideView): string[] {
  const language = side.language;
  if (language === null) return [];
  return side.code.flatMap((line) => {
    const name = DECLARATION[language].exec(line)?.[1];
    return name === undefined ? [] : [name];
  });
}

function namesIn(lines: readonly string[]): string[] {
  return lines.flatMap((line) => [...line.matchAll(/(?<![\w$])[A-Za-z_$][\w$]*/g)].map((m) => m[0]));
}

function netRemoved(hunk: Hunk, file: AnalyzedFile, language: TestLanguage): number {
  const { removed, added } = hunkLines(hunk, file, assertView);
  const removedSide = file.oldIsTest ? assertionsIn(removed, file.old, language) : 0;
  return removedSide - assertionsIn(added, file.new, language);
}

/** Checks that compare a whole value, so one of them can stand in for several field checks. */
const WHOLE_VALUE: Readonly<Record<TestLanguage, RegExp>> = {
  js: /\.\s*(?:toEqual|toStrictEqual|toMatchObject|toMatchSnapshot|toMatchInlineSnapshot)\s*\(|\bassert\s*\.\s*(?:deepEqual|deepStrictEqual|partialDeepStrictEqual)\s*\(|\.\s*to\s*\.(?:\s*\w+\s*\.)*?\s*(?:eql|equal)\s*\(|\bt\s*\.\s*(?:deepEqual|like|snapshot|same|strictSame)\s*\(/,
  python: /(?<!\w)assert(?:Equal|DictEqual|ListEqual|TupleEqual|SequenceEqual|CountEqual)\s*\(|(?<![\w.])assert\b.*==/,
  go: /\b(?:assert|require)\s*\.\s*(?:Equal|EqualValues|Exactly|ElementsMatch|JSONEq|YAMLEq)\s*\(|\breflect\s*\.\s*DeepEqual\s*\(|\bcmp\s*\.\s*(?:Diff|Equal)\s*\(/,
};

/** Names that belong to the assertion itself, not to the value it checks. */
const ASSERTION_WORDS = /^(?:expect|assert\w*|Assert|require|Require|t|b|tb|self|this|to|be|deep|not|eq|eql|equal|equals|toBe\w*|toEqual|toStrictEqual|toMatch\w*|toHave\w*|toContain\w*|Equal\w*|Exactly|DeepEqual|reflect|cmp|Diff|Errorf|Error|Fatalf|Fatal|got|want|is|in|and|or|None|True|False|null|undefined|true|false|nil)$/;

/**
 * Several exact checks in one hunk folded into fewer whole-value checks on the same subject, such
 * as three `toBe` calls on fields becoming one `toEqual` on the object. Every check that left and
 * every one that arrived is exact, at least one that arrived compares a whole value, and that
 * check names the root of a value a removed check looked at (`user` in `expect(user.id)`).
 */
function isConsolidation(hunk: Hunk, file: AnalyzedFile, language: TestLanguage): boolean {
  const { removed, added } = hunkLines(hunk, file, assertView);
  const gone = matches(removed, file.old, language);
  const came = matches(added, file.new, language);
  if (came.length === 0 || came.length >= gone.length) return false;
  if (![...gone, ...came].every((m) => m.tag === 'strong')) return false;
  const assertionLines = (lines: readonly SideLine[], side: SideView | null): SideLine[] =>
    lines.filter((l) => assertionsIn([l], side, language) > 0);
  const wholeLines = assertionLines(added, file.new).filter((l) => WHOLE_VALUE[language].test(l.text));
  if (wholeLines.length === 0) return false;
  const subjects = new Set(assertionLines(removed, file.old).map((l) => identifiers(l.text)[0]));
  return wholeLines.some((l) => identifiers(l.text).some((name) => subjects.has(name)));
}

/** The value names on a line, in order; the first is the root of the value a check looks at. */
function identifiers(text: string): string[] {
  return [...text.matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)].map((m) => m[0]).filter((name) => !ASSERTION_WORDS.test(name));
}

/**
 * Per hunk: exact checks that left, matched against weak checks that arrived. A strong check
 * replaced by another strong check, or a weak one replaced by a strong one, is not reported.
 */
function loosenedHits(file: AnalyzedFile, language: TestLanguage): { hits: RuleHit[]; demoted: number } {
  const hits: RuleHit[] = [];
  let demoted = 0;
  for (const hunk of file.hunks) {
    const { removed, added } = hunkLines(hunk, file, assertView);
    const gone = matches(removed, file.old, language);
    const came = matches(added, file.new, language);
    const strongLost = gone.filter((m) => m.tag === 'strong');
    const strongNet = strongLost.length - came.filter((m) => m.tag === 'strong').length;
    const weakGained = came.filter((m) => m.tag !== 'strong');
    const weakNet = weakGained.length - gone.filter((m) => m.tag !== 'strong').length;
    const n = Math.min(strongNet, weakNet);
    if (n <= 0) continue;
    // Report the last weak checks that arrived; earlier ones may have been there before.
    const reported = weakGained.slice(-n);
    reported.forEach((weak, i) => {
      const strong = strongLost[i];
      if (weak.tag === 'demoted') demoted++;
      hits.push({
        ruleId: 'assertion/loosened',
        file: file.path,
        line: weak.line,
        reason:
          weak.tag === 'demoted'
            ? `${strong?.name ?? 'an assertion'} replaced by ${weak.name}, which cannot fail the test`
            : `${strong?.name ?? 'an exact assertion'} replaced by the weaker ${weak.name}`,
      });
    });
  }
  return { hits, demoted };
}

interface StrengthMatch {
  readonly tag: Strength;
  readonly name: string;
  readonly line: number;
}

/**
 * The strength checks in the statements that `lines` touch, each statement scanned once as a
 * whole and reported at its first line. A Python assert that a formatter wrapped over several
 * lines (`assert (\n x == y\n), msg`) is judged on its whole text, so moving its parentheses or
 * line breaks changes nothing, and a change to one of its continuation lines is still seen.
 */
function matches(lines: readonly SideLine[], side: SideView | null, language: TestLanguage, port = false): StrengthMatch[] {
  if (side === null) return [];
  const { startOf, text } = statementsOf(side, language);
  const seen = new Set<number>();
  const out: StrengthMatch[] = [];
  for (const l of lines) {
    const start = startOf[l.line - 1] ?? l.line - 1;
    if (seen.has(start)) continue;
    seen.add(start);
    const statement = text(start);
    for (const m of scanLine(statement, port ? PORT_STRENGTH : STRENGTH[language])) {
      const compares = port && m.tag === 'weak' && BARE_ASSERT.test(m.name) && comparesFirstArgument(statement, m.index);
      out.push(compares ? { tag: 'strong', name: `${m.name} with a comparison`, line: start + 1 } : { tag: m.tag, name: m.name, line: start + 1 });
    }
  }
  return out;
}

/**
 * Strengths in a file moved from `expect` to the assert module, where the two spellings must
 * compare like for like: `toBe(true)` and `toBe(false)` say no more than `assert.ok`, so they
 * count as weak; and `assert.ok(a === b)` (see `BARE_ASSERT`) checks a value, so it counts as exact.
 */
const PORT_STRENGTH: readonly Pattern<Strength>[] = [{ tag: 'weak', re: /\.\s*toBe\s*\(\s*(?:true|false)\s*\)/g }, ...STRENGTH.js];

/** The weak assert-module checks that take a single condition: `assert(...)`, `assert.ok(...)`. */
const BARE_ASSERT = /^assert(?:\.strict)?(?:\.ok)?$/;

/** Whether the first argument of the call starting at `index` compares values (`=>` is not a comparison). */
function comparesFirstArgument(statement: string, index: number): boolean {
  const open = statement.indexOf('(', index);
  if (open < 0) return false;
  const first = callArgs(statement, open + 1).args[0] ?? '';
  return /[<>]|[=!]=/.test(first.replace(/=>/g, '  '));
}

/**
 * A JS test file whose assertion style switched completely: the base side calls `expect` and
 * never the assert module, the head side calls the assert module and never `expect`. Such a port
 * rewrites every check, so pairing lines hunk by hunk compares unrelated checks.
 */
function isAssertPort(file: AnalyzedFile): boolean {
  if (file.old === null || file.new === null) return false;
  const uses = (side: SideView, call: RegExp): boolean => assertView(side).some((line) => call.test(line));
  return uses(file.old, EXPECT_CALL) && !uses(file.old, ASSERT_CALL) && uses(file.new, ASSERT_CALL) && !uses(file.new, EXPECT_CALL);
}

/**
 * Loosening in an `expect` to assert-module port, judged across the whole file: the exact checks
 * that left, matched against the weak checks that arrived, both counted file-wide. Reported once,
 * at the first weak check on the head side, since no line-level pairing is meaningful.
 */
function portLoosenedHits(file: AnalyzedFile): RuleHit[] {
  if (file.old === null || file.new === null) return [];
  const every = (side: SideView): SideLine[] => assertView(side).map((_line, i) => ({ line: i + 1, text: '' }));
  const before = matches(every(file.old), file.old, 'js', true);
  const after = matches(every(file.new), file.new, 'js', true);
  const exact = (list: readonly StrengthMatch[]): number => list.filter((m) => m.tag === 'strong').length;
  const weak = (list: readonly StrengthMatch[]): StrengthMatch[] => list.filter((m) => m.tag !== 'strong');
  const n = Math.min(exact(before) - exact(after), weak(after).length - weak(before).length);
  const first = weak(after)[0];
  if (n <= 0 || first === undefined) return [];
  const counts = `${exact(before)} exact and ${weak(before).length} weak before, ${exact(after)} exact and ${weak(after).length} weak after`;
  return [
    {
      ruleId: 'assertion/loosened',
      file: file.path,
      line: first.line,
      reason: `${plural(n, 'exact check')} replaced by weaker ones when the file moved from expect to node:assert (${counts})`,
    },
  ];
}

interface Statements {
  /** For each 0-based line, the 0-based line its statement starts on. */
  readonly startOf: readonly number[];
  /** The code view of the statement starting at a 0-based line, its lines joined by spaces. */
  readonly text: (start: number) => string;
}

/** A wrapped statement longer than this is cut off: an unbalanced bracket must not swallow the file. */
const MAX_STATEMENT_LINES = 40;

const statementCache = new WeakMap<SideView, Statements>();

/**
 * Python's logical lines: a statement continues while a bracket is open or a line ends in a
 * backslash. JS and Go chains are judged per line (their matchers name the strength on the line
 * they sit on), so every line there is its own statement.
 */
function statementsOf(side: SideView, language: TestLanguage): Statements {
  const cached = statementCache.get(side);
  if (cached !== undefined) return cached;
  const code = assertView(side);
  const startOf: number[] = [];
  const endOf = new Map<number, number>();
  let start = 0;
  let depth = 0;
  let continued = false;
  for (let i = 0; i < code.length; i++) {
    const line = code[i] ?? '';
    if (!continued) {
      start = i;
      depth = 0;
    }
    startOf.push(start);
    endOf.set(start, i);
    if (language !== 'python') continue;
    for (const ch of line) {
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if ((ch === ')' || ch === ']' || ch === '}') && depth > 0) depth--;
    }
    continued = (depth > 0 || /\\\s*$/.test(line)) && i - start + 1 < MAX_STATEMENT_LINES;
  }
  const statements: Statements = {
    startOf,
    text: (s) => code.slice(s, (endOf.get(s) ?? s) + 1).join(' '),
  };
  statementCache.set(side, statements);
  return statements;
}

/** Per hunk, each tolerance that left is paired in order with one of the same kind that arrived. */
function toleranceHits(file: AnalyzedFile): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const hunk of file.hunks) {
    const { removed, added } = hunkLines(hunk, file, (s) => s.code);
    const before = groupByKey(removed.flatMap((l) => tolerancesIn(l.text).map((t) => ({ ...t, line: l.line }))));
    const after = groupByKey(added.flatMap((l) => tolerancesIn(l.text).map((t) => ({ ...t, line: l.line }))));
    for (const [key, olds] of before) {
      const news = after.get(key) ?? [];
      for (let i = 0; i < Math.min(olds.length, news.length); i++) {
        const was = olds[i];
        const now = news[i];
        if (was === undefined || now === undefined || !isLooser(was, now)) continue;
        hits.push({
          ruleId: 'assertion/tolerance-widened',
          file: file.path,
          line: now.line,
          reason:
            now.kind === 'precision'
              ? `${now.label} lowered from ${was.text} to ${now.text}`
              : `${now.label} widened from ${was.text} to ${now.text}`,
        });
      }
    }
  }
  return hits;
}

function groupByKey(list: (Tolerance & { line: number })[]): Map<string, (Tolerance & { line: number })[]> {
  const out = new Map<string, (Tolerance & { line: number })[]>();
  for (const t of list) {
    const key = `${t.kind}:${t.label.toLowerCase()}`;
    const group = out.get(key);
    if (group === undefined) out.set(key, [t]);
    else group.push(t);
  }
  return out;
}

function isLooser(was: Tolerance, now: Tolerance): boolean {
  return now.kind === 'precision' ? now.value < was.value : now.value > was.value;
}
