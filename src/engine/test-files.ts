import { GlobSet } from './glob.js';

const JS_EXT = '{js,jsx,mjs,cjs,ts,tsx,mts,cts}';

/**
 * What each language's usual runner collects by default:
 * - Jest, Vitest, Mocha, node:test, Playwright: `*.test.*`, `*.spec.*`, `__tests__/`, and
 *   Mocha's `test/` directory;
 * - pytest and unittest discovery: `test_*.py`, `*_test.py`, Django's `tests.py`;
 * - `go test`: `*_test.go`.
 * A repo adds its own with `testPatterns` in `.agent-pr-guard.json`.
 */
export const DEFAULT_TEST_PATTERNS: readonly string[] = [
  `*.{test,spec}.${JS_EXT}`,
  `**/__tests__/**/*.${JS_EXT}`,
  `{test,tests}/**/*.${JS_EXT}`,
  'test_*.py',
  '*_test.py',
  'tests.py',
  '*_test.go',
];

const SUBJECT_STEMS: readonly RegExp[] = [
  /^(.+)\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /^test_(.+)\.py$/,
  /^(.+)_test\.(?:py|go)$/,
];

/** Source extensions a test's subject may have, by the test file's extension. */
const SUBJECT_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  js: ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'],
  py: ['py'],
  go: ['go'],
};

/**
 * The name stem of the code a test file tests, by naming convention: `foo.test.ts`, `foo.spec.js`,
 * `test_foo.py`, `foo_test.py` and `foo_test.go` all test `foo`. A file under `__tests__/` or a
 * `test/` directory with a plain name (`__tests__/foo.ts`) tests `foo` too. Null when the name
 * says nothing (Django's `tests.py`, a custom pattern).
 */
export function testSubject(path: string): { stem: string; extensions: readonly string[] } | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  const ext = dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
  const family = /^[cm]?[jt]sx?$/.test(ext) ? 'js' : ext;
  const extensions = SUBJECT_EXTENSIONS[family];
  if (extensions === undefined) return null;
  for (const re of SUBJECT_STEMS) {
    const stem = re.exec(name)?.[1];
    if (stem !== undefined) return { stem, extensions };
  }
  if (family === 'js' && /(?:^|\/)(?:__tests__|tests?)\//.test(path)) return { stem: name.slice(0, dot), extensions };
  return null;
}

/** The paths and test status of one changed file, as a pack sees them. */
export interface ChangedPaths {
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly oldIsTest: boolean;
  readonly newIsTest: boolean;
}

/**
 * The changed non-test files a test file is named after (`testSubject`), deleted or not, matched by
 * file name anywhere in the change: `foo.test.ts` with `foo.{js,ts,...}`, `test_foo.py` with
 * `foo.py`, `foo_test.go` with `foo.go`. In the order of the subject's extensions, then of `files`.
 */
export function subjectsOf<F extends ChangedPaths>(testPath: string, files: readonly F[]): F[] {
  const subject = testSubject(testPath);
  if (subject === null) return [];
  const sources = files.filter((f) => !f.oldIsTest && !f.newIsTest);
  const nameOf = (f: F): string => {
    const path = f.oldPath ?? f.newPath ?? '';
    return path.slice(path.lastIndexOf('/') + 1);
  };
  return subject.extensions.flatMap((ext) => sources.filter((f) => nameOf(f) === `${subject.stem}.${ext}`));
}

export class TestFileMatcher {
  private readonly globs: GlobSet;

  constructor(extraPatterns: readonly string[] = []) {
    this.globs = new GlobSet([...DEFAULT_TEST_PATTERNS, ...extraPatterns]);
  }

  isTest(path: string): boolean {
    return this.globs.matches(path);
  }
}
