/**
 * How a file's comments and strings are lexed:
 * - `js`: JavaScript and TypeScript (`//`, `/* *\/`, quotes, template literals, regex literals);
 * - `python`: `#` comments, prefixed and triple-quoted strings;
 * - `go`: `//`, `/* *\/`, quotes, raw backtick strings, runes;
 * - `json`: JSON, JSONC and JSON5 (`//` and `/* *\/` comments, both quote styles);
 * - `hash`: YAML, TOML, INI, shell and Makefiles (`#` comments, `;` line comments, one-line quotes);
 * - `plain`: no lexing; the whole file is code.
 */
export type Syntax = 'js' | 'python' | 'go' | 'json' | 'hash' | 'plain';

/** The languages whose tests the rule packs understand. */
export type TestLanguage = 'js' | 'python' | 'go';

const BY_EXTENSION: Readonly<Record<string, Syntax>> = {
  js: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  ts: 'js',
  tsx: 'js',
  mts: 'js',
  cts: 'js',
  py: 'python',
  pyi: 'python',
  go: 'go',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  yml: 'hash',
  yaml: 'hash',
  toml: 'hash',
  ini: 'hash',
  cfg: 'hash',
  conf: 'hash',
  sh: 'hash',
  bash: 'hash',
  zsh: 'hash',
  mk: 'hash',
};

const BY_BASENAME: Readonly<Record<string, Syntax>> = {
  makefile: 'hash',
  gnumakefile: 'hash',
  '.coveragerc': 'hash',
  '.flake8': 'hash',
  '.pylintrc': 'hash',
  pylintrc: 'hash',
  '.eslintignore': 'hash',
  '.stylelintignore': 'hash',
  '.prettierignore': 'hash',
  '.eslintrc': 'json',
  '.babelrc': 'json',
  '.nycrc': 'json',
  '.c8rc': 'json',
  '.swcrc': 'json',
  '.mocharc': 'json',
  '.golangci': 'hash',
};

export function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

export function extension(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function syntaxOf(path: string): Syntax {
  const name = basename(path).toLowerCase();
  const byName = BY_BASENAME[name];
  if (byName !== undefined) return byName;
  return BY_EXTENSION[extension(path)] ?? 'plain';
}

export function testLanguageOf(path: string): TestLanguage | null {
  const syntax = syntaxOf(path);
  return syntax === 'js' || syntax === 'python' || syntax === 'go' ? syntax : null;
}
