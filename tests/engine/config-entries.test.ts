import { describe, expect, it } from 'vitest';
import { lastSegment, readEntries, type ConfigEntry } from '../../src/engine/config-entries.js';
import type { ConfigFormat } from '../../src/engine/config-files.js';
import { splitLines } from '../../src/engine/line-diff.js';
import { mask } from '../../src/engine/mask.js';
import type { Syntax } from '../../src/engine/syntax.js';

const SYNTAX: Record<ConfigFormat, Syntax> = {
  json: 'json',
  js: 'js',
  yaml: 'hash',
  toml: 'hash',
  ini: 'hash',
  make: 'hash',
  shell: 'plain',
  lines: 'hash',
};

function read(text: string, format: ConfigFormat): [string, string | null, number][] {
  const lines = splitLines(mask(text, SYNTAX[format]).codeWithStrings);
  return readEntries(lines, format).map((e: ConfigEntry) => [e.key, e.value, e.line]);
}

describe('readEntries', () => {
  it('reads JSONC with comments, nesting and arrays', () => {
    const text = '{\n  // strict\n  "compilerOptions": { "strict": true, /* x */ "lib": ["ES2024", "DOM"] },\n  "exclude": ["dist",],\n}\n';
    expect(read(text, 'json')).toEqual([
      ['compilerOptions', null, 3],
      ['compilerOptions.strict', 'true', 3],
      ['compilerOptions.lib', null, 3],
      ['compilerOptions.lib[]', 'ES2024', 3],
      ['compilerOptions.lib[]', 'DOM', 3],
      ['exclude', null, 4],
      ['exclude[]', 'dist', 4],
    ]);
  });

  it('reads object literals inside JS and TS modules', () => {
    const text = [
      "import { defineConfig } from 'vitest/config';",
      'export default defineConfig({',
      '  plugins: [react({ fast: true })],',
      '  test: {',
      "    coverage: { thresholds: { lines: 90, branches: process.env.CI ? 80 : 0 } },",
      "    exclude: ['e2e/**'],",
      '  },',
      '});',
    ].join('\n');
    expect(read(text, 'js')).toEqual([
      ['plugins', null, 3],
      ['plugins[].fast', 'true', 3],
      ['plugins[]', 'react()', 3],
      ['test', null, 4],
      ['test.coverage', null, 5],
      ['test.coverage.thresholds', null, 5],
      ['test.coverage.thresholds.lines', '90', 5],
      ['test.coverage.thresholds.branches', 'process.env.CI ? 80 : 0', 5],
      ['test.exclude', null, 6],
      ['test.exclude[]', 'e2e/**', 6],
    ]);
  });

  it('reads an ESLint flat config array', () => {
    const text = "export default [\n  js.configs.recommended,\n  { rules: { 'no-console': ['error', { allow: ['warn'] }] }, ignores: ['dist/'] },\n];\n";
    expect(read(text, 'js')).toEqual([
      ['[]', 'js.configs.recommended', 2],
      ['[]', null, 3],
      ['[].rules', null, 3],
      ['[].rules.no-console', null, 3],
      ['[].rules.no-console[]', 'error', 3],
      ['[].rules.no-console[]', null, 3],
      ['[].rules.no-console[].allow', null, 3],
      ['[].rules.no-console[].allow[]', 'warn', 3],
      ['[].ignores', null, 3],
      ['[].ignores[]', 'dist/', 3],
    ]);
  });

  it('reads YAML mappings, sequences at the parent indent, flow collections and block scalars', () => {
    const text = [
      '"on": [push, pull_request]',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest # comment',
      '    steps:',
      '    - uses: actions/checkout@v4',
      '    - name: Test',
      '      run: |',
      '        npm ci',
      '        npm test',
      '      continue-on-error: true',
      '  lint:',
      '    steps:',
      '      - run: npx eslint .',
      '---',
      'other: { a: 1 }',
    ].join('\n');
    expect(read(text, 'yaml')).toEqual([
      ['on', null, 1],
      ['on[]', 'push', 1],
      ['on[]', 'pull_request', 1],
      ['jobs', null, 2],
      ['jobs.test', null, 3],
      ['jobs.test.runs-on', 'ubuntu-latest', 4],
      ['jobs.test.steps', null, 5],
      ['jobs.test.steps[].uses', 'actions/checkout@v4', 6],
      ['jobs.test.steps[].name', 'Test', 7],
      ['jobs.test.steps[].run', null, 8],
      ['jobs.test.steps[].run', 'npm ci', 9],
      ['jobs.test.steps[].run', 'npm test', 10],
      ['jobs.test.steps[].continue-on-error', 'true', 11],
      ['jobs.lint', null, 12],
      ['jobs.lint.steps', null, 13],
      ['jobs.lint.steps[].run', 'npx eslint .', 14],
      ['other', null, 16],
      ['other.a', '1', 16],
    ]);
  });

  it('reads YAML scalar list items', () => {
    expect(read('ignore:\n  - "tests/**"\n  - docs\n', 'yaml')).toEqual([
      ['ignore', null, 1],
      ['ignore[]', 'tests/**', 2],
      ['ignore[]', 'docs', 3],
    ]);
  });

  it('reads TOML tables, dotted keys, inline and multi-line arrays', () => {
    const text = [
      '[tool.coverage.report]',
      'fail_under = 90 # floor',
      '[tool.ruff.lint]',
      'ignore = [',
      '  "E501",',
      ']',
      'per-file-ignores = { "tests/*" = ["S101"] }',
      '[[tool.mypy.overrides]]',
      'module.name = "x"',
    ].join('\n');
    expect(read(text, 'toml')).toEqual([
      ['tool.coverage.report', null, 1],
      ['tool.coverage.report.fail_under', '90', 2],
      ['tool.ruff.lint', null, 3],
      ['tool.ruff.lint.ignore', null, 4],
      ['tool.ruff.lint.ignore[]', 'E501', 5],
      ['tool.ruff.lint.per-file-ignores', null, 7],
      ['tool.ruff.lint.per-file-ignores.tests/*', null, 7],
      ['tool.ruff.lint.per-file-ignores.tests/*[]', 'S101', 7],
      ['tool.mypy.overrides[]', null, 8],
      ['tool.mypy.overrides[].module.name', 'x', 9],
    ]);
  });

  it('reads INI sections with continuation lines', () => {
    const text = '[flake8]\n; comment\nmax-line-length = 100\nextend-ignore =\n    E203,\n    W503\n[coverage:run]\nomit: */tests/*\n';
    expect(read(text, 'ini')).toEqual([
      ['flake8', null, 1],
      ['flake8.max-line-length', '100', 3],
      ['flake8.extend-ignore', null, 4],
      ['flake8.extend-ignore', 'E203,', 5],
      ['flake8.extend-ignore', 'W503', 6],
      ['coverage:run', null, 7],
      ['coverage:run.omit', '*/tests/*', 8],
    ]);
  });

  it('reads Makefile recipes, shell lines and ignore files', () => {
    expect(read('CC := gcc\ntest: build\n\tgo test ./...\n\n.PHONY: test\n', 'make')).toEqual([
      ['test', null, 2],
      ['test', 'go test ./...', 3],
      ['.PHONY', null, 5],
    ]);
    expect(read('#!/bin/sh\nnpx lint-staged\n', 'shell')).toEqual([['run', 'npx lint-staged', 2]]);
    expect(read('# build\ndist/\n\n!keep\n', 'lines')).toEqual([
      ['[]', 'dist/', 2],
      ['[]', '!keep', 4],
    ]);
  });

  it('never throws on malformed input', () => {
    for (const format of ['json', 'js', 'yaml', 'toml', 'ini', 'make'] as const) {
      expect(() => read('{ a: [1, (2 }\n]] ) :: = \n  - - x: [\n"""', format)).not.toThrow();
    }
  });

  it('names the last key segment', () => {
    expect(lastSegment('rules.max-len[]')).toBe('max-len');
    expect(lastSegment('exclude')).toBe('exclude');
  });
});
