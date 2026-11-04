import { describe, expect, it } from 'vitest';
import { GlobSet, globToRegExp } from '../../src/engine/glob.js';
import { DEFAULT_TEST_PATTERNS, TestFileMatcher } from '../../src/engine/test-files.js';

const m = (pattern: string, path: string): boolean => globToRegExp(pattern).test(path);

describe('globToRegExp', () => {
  it('matches a slash-free pattern against the file name at any depth', () => {
    expect(m('*.snap', 'a.snap')).toBe(true);
    expect(m('*.snap', 'src/__snapshots__/a.snap')).toBe(true);
    expect(m('*.snap', 'a.snap.txt')).toBe(false);
    expect(m('CODEOWNERS', '.github/CODEOWNERS')).toBe(true);
  });

  it('anchors a pattern with a slash at the repo root', () => {
    expect(m('src/*.ts', 'src/a.ts')).toBe(true);
    expect(m('src/*.ts', 'lib/src/a.ts')).toBe(false);
    expect(m('src/*.ts', 'src/x/a.ts')).toBe(false);
    expect(m('/Makefile', 'Makefile')).toBe(true);
    expect(m('/Makefile', 'sub/Makefile')).toBe(false);
    expect(m('./a/b', 'a/b')).toBe(true);
  });

  it('treats ** as any number of segments', () => {
    expect(m('src/**/*.ts', 'src/a.ts')).toBe(true);
    expect(m('src/**/*.ts', 'src/x/y/a.ts')).toBe(true);
    expect(m('**/fixtures/**', 'a/fixtures/b/c.json')).toBe(true);
    expect(m('**/fixtures/**', 'fixtures/c.json')).toBe(true);
    expect(m('**/fixtures/**', 'myfixtures/c.json')).toBe(false);
    expect(m('a**b', 'axxb')).toBe(true);
    expect(m('a**b', 'ax/xb')).toBe(false);
  });

  it('matches a trailing slash as everything below the directory', () => {
    expect(m('.github/', '.github/workflows/ci.yml')).toBe(true);
    expect(m('.github/', '.githubx/a')).toBe(false);
  });

  it('supports ?, classes, negated classes and nested braces', () => {
    expect(m('a?.js', 'ab.js')).toBe(true);
    expect(m('a?.js', 'a/.js')).toBe(false);
    expect(m('[ab].js', 'b.js')).toBe(true);
    expect(m('[!ab].js', 'c.js')).toBe(true);
    expect(m('[!ab].js', 'a.js')).toBe(false);
    expect(m('*.{js,{m,c}ts}', 'x.mts')).toBe(true);
    expect(m('*.{js,{m,c}ts}', 'x.ts')).toBe(false);
  });

  it('escapes regex metacharacters and honours backslash escapes', () => {
    expect(m('a+b(c).js', 'a+b(c).js')).toBe(true);
    expect(m('a+b(c).js', 'aab(c).js')).toBe(false);
    expect(m('\\*.js', '*.js')).toBe(true);
    expect(m('\\*.js', 'x.js')).toBe(false);
    expect(m('a[b', 'a[b')).toBe(true);
  });

  it('matches dotfiles with *', () => {
    expect(m('*', '.agent-pr-guard.json')).toBe(true);
  });

  it('rejects an empty pattern', () => {
    expect(() => globToRegExp('  ')).toThrow(/empty/);
  });

  it('GlobSet reports the first matching pattern', () => {
    const set = new GlobSet(['*.md', 'docs/']);
    expect(set.matches('docs/a.txt')).toBe(true);
    expect(set.firstMatch('docs/a.md')).toBe('*.md');
    expect(set.firstMatch('src/a.ts')).toBeNull();
  });
});

describe('TestFileMatcher', () => {
  const tests = new TestFileMatcher();
  it.each([
    'src/a.test.ts',
    'a.spec.js',
    'web/src/x.test.tsx',
    'src/__tests__/helper.ts',
    'test/unit.mjs',
    'tests/e2e/flow.ts',
    'tests/test_api.py',
    'pkg/api_test.py',
    'app/tests.py',
    'pkg/server_test.go',
  ])('treats %s as a test file', (path) => {
    expect(tests.isTest(path)).toBe(true);
  });

  it.each(['src/a.ts', 'src/testing.ts', 'src/contest.py', 'pkg/server.go', 'docs/test.md', 'lib/test/a.js', 'conftest.py'])(
    'does not treat %s as a test file',
    (path) => {
      expect(tests.isTest(path)).toBe(false);
    },
  );

  it('adds configured patterns to the defaults', () => {
    const custom = new TestFileMatcher(['e2e/**/*.ts']);
    expect(custom.isTest('e2e/login.ts')).toBe(true);
    expect(custom.isTest('src/a.test.ts')).toBe(true);
    expect(DEFAULT_TEST_PATTERNS.length).toBeGreaterThan(0);
  });
});
