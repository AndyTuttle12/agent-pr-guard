import type { Pattern } from './scan.js';

/** The checks a CI job, hook or script runs that judge a change. */
export type GateKind = 'test' | 'lint' | 'typecheck';

/**
 * A tool name standing alone: `node_modules/.bin/jest` and `jest@29` count, `jest.config.js`,
 * `eslint-plugin-x` and `@vitest/coverage-v8` do not.
 */
function tool(names: string): RegExp {
  return new RegExp(`(?<![\\w\\-@])(?:${names})(?![\\w.\\-/])`, 'g');
}

const PM = '(?:npm|pnpm|yarn|bun)(?:\\s+run(?:-script)?)?';

/**
 * `node --test` with node's own flags before `--test`: `--flag`, `--flag=value`, or one of the
 * flags that take the next word as their value (`--import ./setup.mjs`). A script path ends it,
 * so `node app.js --test` passes `--test` to the app and is not a test run.
 */
const NODE_VALUE_FLAGS = '--import|--require|-r|--loader|--experimental-loader|--env-file|--conditions|-C';
const NODE_TEST = `node(?:\\s+(?:(?:${NODE_VALUE_FLAGS})\\s+[^\\s-]\\S*|--?[\\w-]+(?:=\\S*)?))*?\\s+--test`;

/**
 * One match is one command. Package-manager scripts first, so `npm run lint` is not also
 * matched as something else; then the tools themselves.
 */
export const GATE_COMMANDS: readonly Pattern<GateKind>[] = [
  { tag: 'typecheck', re: new RegExp(`\\b${PM}\\s+(?:typecheck|type-check|check-types|types|tsc)\\b`, 'g') },
  { tag: 'lint', re: new RegExp(`\\b${PM}\\s+lint\\b`, 'g') },
  { tag: 'test', re: new RegExp(`\\b${PM}\\s+test\\b|\\bnpm\\s+t\\b`, 'g') },
  { tag: 'test', re: /\b(?:make|just|task)\s+(?:test|check)\b/g },
  { tag: 'lint', re: /\b(?:make|just|task)\s+lint\b/g },
  { tag: 'typecheck', re: /\b(?:make|just|task)\s+typecheck\b/g },
  { tag: 'typecheck', re: tool('vue-tsc|tsc|svelte-check|mypy|basedpyright|pyright|pytype|flow\\s+check') },
  {
    tag: 'lint',
    re: tool(
      'eslint|oxlint|stylelint|biome\\s+(?:check|lint|ci)|ruff(?:\\s+check)?|flake8|pylint|golangci-lint(?:-action)?|go\\s+vet|staticcheck|cargo\\s+clippy|prettier\\s+(?:--check|-c)|black\\s+--check|rubocop|pre-commit\\s+run',
    ),
  },
  {
    tag: 'test',
    re: tool(
      `vitest|jest|mocha|ava|playwright\\s+test|cypress\\s+run|karma\\s+start|${NODE_TEST}|deno\\s+test|bun\\s+test|pytest|py\\.test|python3?\\s+-m\\s+(?:pytest|unittest)|tox|nox|go\\s+test|gotestsum|cargo\\s+test|rspec|phpunit|mvn\\s+(?:test|verify)|gradlew?\\s+(?:test|check)`,
    ),
  },
];

/** A failure the step swallows: `cmd || true`, `cmd || exit 0`, `cmd || :`, `cmd || echo ...`. */
export const SWALLOWED = /\|\|\s*(?:true\b|:(?:\s|$)|exit\s+0\b|echo\b)/;
