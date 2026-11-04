import type { AnalyzedFile, SideView } from '../engine/analyze.js';
import type { RulePack } from '../engine/engine.js';
import type { RuleHit } from '../engine/finding.js';
import type { TestLanguage } from '../engine/syntax.js';
import { subjectsOf } from '../engine/test-files.js';

/**
 * Test files that stop running. Whether a path is a test is the runner's view (the built-in
 * patterns plus `testPatterns`), judged on the path, so a file the reader could not open is
 * still covered. A move that keeps the file collected passes: a rename git detects, and a deleted
 * plus an added test file with the same name, which the engine pairs as one move. A test deleted
 * together with the source file it is named after is reported as a warning: that is how a retired
 * feature looks, but the guard cannot tell it from a test removed to get green. A file whose
 * readable base side holds no tests (a scratch script named `test_*.py`) warns too: only its
 * name matched.
 */
export const testDeletionPack: RulePack = {
  id: 'test-deletion',
  rules: [
    { id: 'test-deletion/deleted', summary: 'A test file was deleted.' },
    {
      id: 'test-deletion/moved-out',
      summary: 'A test file was renamed or moved to a path the test runner does not collect.',
    },
  ],
  check({ files }) {
    const hits: RuleHit[] = [];
    for (const file of files) {
      if (!file.oldIsTest || file.oldPath === null) continue;
      const nameOnly = file.old !== null && definesTests(file.old) === false;
      const noTests = ', but it defined no tests, so only its name matched the test patterns';
      if (file.newPath === null) {
        const subject = deletedSubject(file.oldPath, files);
        hits.push(
          nameOnly
            ? { ruleId: 'test-deletion/deleted', file: file.path, line: null, reason: `test file ${file.oldPath} was deleted${noTests}`, severity: 'warning' }
            : subject === null
              ? { ruleId: 'test-deletion/deleted', file: file.path, line: null, reason: `test file ${file.oldPath} was deleted` }
              : {
                  ruleId: 'test-deletion/deleted',
                  file: file.path,
                  line: null,
                  reason: `test file ${file.oldPath} was deleted along with ${subject}, the code it tests`,
                  severity: 'warning',
                },
        );
      } else if (!file.newIsTest) {
        const reason = `test file ${file.oldPath} was moved to ${file.newPath}, which the test runner does not collect`;
        hits.push(
          nameOnly
            ? { ruleId: 'test-deletion/moved-out', file: file.path, line: null, reason: `${reason}${noTests}`, severity: 'warning' }
            : { ruleId: 'test-deletion/moved-out', file: file.path, line: null, reason },
        );
      }
    }
    return hits;
  },
};

/** A deleted source file the test is named after (`foo.test.ts` and `foo.ts`), or null. */
function deletedSubject(testPath: string, files: readonly AnalyzedFile[]): string | null {
  return subjectsOf(testPath, files).find((f) => f.newPath === null)?.oldPath ?? null;
}

/** Test definitions and calls, on the code view so a commented-out or quoted one never counts. */
const TEST_CODE: Readonly<Record<TestLanguage, readonly RegExp[]>> = {
  js: [
    /(?<![\w$.])[fx]?(?:it|test|describe|context|suite|specify|bench)\s*(?:\.\s*\w+\s*)*\(/,
    /(?<![\w$.])Deno\s*\.\s*test\s*\(/,
  ],
  python: [/^\s*(?:async\s+)?def\s+test\w*\s*\(/, /^\s*class\s+(?:Test\w*|\w+\s*\([^)]*\bTestCase\b)/],
  go: [
    /^func\s+(?:\([^)]*\)\s*)?(?:Test|Benchmark|Fuzz|Example)\w*\s*\(/,
    /(?<![\w.])[FPX]?(?:Describe|Context|It|When|Specify|Entry|DescribeTable)\s*\(/,
  ],
};

/** An import of a test framework, on the view that keeps strings (module names are strings). */
const FRAMEWORK_IMPORT: Readonly<Record<TestLanguage, RegExp>> = {
  js: /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(?\s*)['"](?:vitest|jest|@jest\/globals|mocha|chai|node:test|bun:test|@playwright\/test|ava|tap|uvu)(?:\/[^'"]*)?['"]/,
  python: /^\s*(?:import|from)\s+(?:pytest|unittest|nose2?|hypothesis)\b/,
  go: /"(?:testing|github\.com\/onsi\/ginkgo(?:\/v2)?|github\.com\/stretchr\/testify(?:\/\w+)?)"/,
};

/**
 * Whether one side of a test file holds a test by its language's conventions: a test function,
 * class or call, or a test framework import. Null when the language is not one the guard reads.
 */
function definesTests(view: SideView): boolean | null {
  const language = view.language;
  if (language === null) return null;
  return (
    view.code.some((line) => TEST_CODE[language].some((re) => re.test(line))) ||
    view.codeWithStrings.some((line) => FRAMEWORK_IMPORT[language].test(line))
  );
}
