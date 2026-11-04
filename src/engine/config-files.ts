import { extension } from './syntax.js';

/** What a config file configures; CI and hook files hold the gate commands themselves. */
export type ConfigCategory = 'ci' | 'hooks' | 'lint' | 'type' | 'coverage' | 'test-runner' | 'project';

/**
 * How a config file is read:
 * - `json`, `js`, `yaml`, `toml`, `ini`: key/value entries (see config-entries.ts);
 * - `make`: Makefile recipes; `shell`: one command per line; `lines`: one glob per line.
 */
export type ConfigFormat = 'json' | 'js' | 'yaml' | 'toml' | 'ini' | 'make' | 'shell' | 'lines';

export interface ConfigFileInfo {
  /** The tool, e.g. `eslint`, `tsconfig`, `github-actions`. */
  readonly family: string;
  readonly category: ConfigCategory;
  readonly format: ConfigFormat;
}

interface Pattern {
  readonly test: RegExp;
  readonly family: string;
  readonly category: ConfigCategory;
  /** Used when the extension does not say. */
  readonly format: ConfigFormat;
}

const ANY = '(?:^|/)';
const at = (body: string): RegExp => new RegExp(`${ANY}${body}$`);

const PATTERNS: readonly Pattern[] = [
  { test: /^\.github\/workflows\/[^/]+\.ya?ml$/, family: 'github-actions', category: 'ci', format: 'yaml' },
  { test: /^\.github\/actions\/.+\/action\.ya?ml$/, family: 'github-action', category: 'ci', format: 'yaml' },
  { test: /^(?:.*\/)?\.gitlab-ci\.ya?ml$|^\.gitlab\/ci\/.+\.ya?ml$/, family: 'gitlab-ci', category: 'ci', format: 'yaml' },
  { test: /^\.circleci\/config\.ya?ml$/, family: 'circleci', category: 'ci', format: 'yaml' },
  { test: at('azure-pipelines\\.ya?ml'), family: 'azure-pipelines', category: 'ci', format: 'yaml' },
  { test: /^bitbucket-pipelines\.ya?ml$/, family: 'bitbucket-pipelines', category: 'ci', format: 'yaml' },
  { test: /^\.travis\.ya?ml$/, family: 'travis', category: 'ci', format: 'yaml' },
  { test: /^\.buildkite\/.+\.ya?ml$/, family: 'buildkite', category: 'ci', format: 'yaml' },
  { test: /^\.(?:drone|woodpecker)\.ya?ml$|^\.woodpecker\/.+\.ya?ml$/, family: 'drone', category: 'ci', format: 'yaml' },
  { test: at('(?:GNUmakefile|[Mm]akefile|[^/]+\\.mk)'), family: 'make', category: 'ci', format: 'make' },
  { test: /^\.pre-commit-config\.ya?ml$/, family: 'pre-commit', category: 'hooks', format: 'yaml' },
  { test: /^\.husky\/[^_/][^/]*$/, family: 'husky', category: 'hooks', format: 'shell' },
  { test: at('\\.?lefthook(?:-local)?\\.ya?ml'), family: 'lefthook', category: 'hooks', format: 'yaml' },
  { test: at('(?:\\.eslintrc(?:\\.[a-z]+)?|eslint\\.config\\.[cm]?[jt]s)'), family: 'eslint', category: 'lint', format: 'json' },
  { test: at('\\.eslintignore'), family: 'eslint', category: 'lint', format: 'lines' },
  { test: at('(?:\\.stylelintrc(?:\\.[a-z]+)?|stylelint\\.config\\.[cm]?[jt]s)'), family: 'stylelint', category: 'lint', format: 'json' },
  { test: at('\\.stylelintignore'), family: 'stylelint', category: 'lint', format: 'lines' },
  { test: at('biome\\.jsonc?'), family: 'biome', category: 'lint', format: 'json' },
  { test: at('\\.golangci\\.(?:ya?ml|toml|json)'), family: 'golangci', category: 'lint', format: 'yaml' },
  { test: at('\\.flake8'), family: 'flake8', category: 'lint', format: 'ini' },
  { test: at('\\.?pylintrc'), family: 'pylint', category: 'lint', format: 'ini' },
  { test: at('\\.?ruff\\.toml'), family: 'ruff', category: 'lint', format: 'toml' },
  { test: at('[tj]sconfig(?:\\.[^/]*)?\\.json'), family: 'tsconfig', category: 'type', format: 'json' },
  { test: at('\\.?mypy\\.ini'), family: 'mypy', category: 'type', format: 'ini' },
  { test: at('pyrightconfig\\.json'), family: 'pyright', category: 'type', format: 'json' },
  { test: at('\\.(?:nycrc|c8rc)(?:\\.[a-z]+)?'), family: 'nyc', category: 'coverage', format: 'json' },
  { test: at('\\.coveragerc'), family: 'coverage', category: 'coverage', format: 'ini' },
  { test: /^(?:\.github\/)?\.?codecov\.ya?ml$/, family: 'codecov', category: 'coverage', format: 'yaml' },
  { test: at('jest\\.config\\.(?:[cm]?[jt]s|json)'), family: 'jest', category: 'test-runner', format: 'js' },
  { test: at('(?:vitest\\.(?:config|workspace)|vite\\.config)\\.[cm]?[jt]s'), family: 'vitest', category: 'test-runner', format: 'js' },
  { test: at('\\.mocharc(?:\\.[a-z]+)?'), family: 'mocha', category: 'test-runner', format: 'json' },
  { test: at('(?:playwright\\.config|ava\\.config|karma\\.conf)\\.[cm]?[jt]s'), family: 'js-runner', category: 'test-runner', format: 'js' },
  { test: at('pytest\\.ini'), family: 'pytest', category: 'test-runner', format: 'ini' },
  { test: at('pyproject\\.toml'), family: 'pyproject', category: 'project', format: 'toml' },
  { test: at('setup\\.cfg'), family: 'setup-cfg', category: 'project', format: 'ini' },
  { test: at('tox\\.ini'), family: 'tox', category: 'project', format: 'ini' },
  { test: at('package\\.json'), family: 'package-json', category: 'project', format: 'json' },
];

const BY_EXTENSION: Readonly<Record<string, ConfigFormat>> = {
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  js: 'js',
  cjs: 'js',
  mjs: 'js',
  ts: 'js',
  cts: 'js',
  mts: 'js',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
};

/**
 * The lint, type-check, coverage, test-runner, CI and hook config files the guard reads, or null.
 * Paths under `node_modules/` are never config.
 */
export function configFileInfo(path: string): ConfigFileInfo | null {
  if (/(?:^|\/)node_modules\//.test(path)) return null;
  const pattern = PATTERNS.find((p) => p.test.test(path));
  if (pattern === undefined) return null;
  const byExtension = pattern.format === 'make' || pattern.format === 'shell' || pattern.format === 'lines' ? undefined : BY_EXTENSION[extension(path)];
  return { family: pattern.family, category: pattern.category, format: byExtension ?? pattern.format };
}
