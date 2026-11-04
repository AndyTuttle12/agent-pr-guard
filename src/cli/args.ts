import { parseArgs } from 'node:util';
import { DEFAULT_FAIL_ON, parseFailOn, type FailOn } from './fail-on.js';

export const USAGE = `Usage: agent-pr-guard check --base <rev> [--head <rev>] [--fail-on <none|error|warning>] [--json] [--config <file>] [--repo <path>]

Reports when the change merge-base(base, head)..head weakens the tests, gates or config that judge
it. Warn-only by default: findings are printed and the exit code stays 0 unless you ask for more.

Options:
  --base <rev>     The branch the PR targets (a branch, tag or commit). Required.
  --head <rev>     The PR's tip. Default: HEAD.
  --fail-on <lvl>  Exit 1 when a finding reaches this level: none (default, warn-only),
                   error, or warning.
  --json           Print the report as JSON on stdout.
  --config <file>  A trusted guard config outside the repository, used instead of
                   .agent-pr-guard.json from the base commit.
  --repo <path>    The repository to inspect. Default: the current directory.
  -h, --help       Print this help.
  -v, --version    Print the version.

Exit codes: 0 the check ran and no finding reached --fail-on (by default nothing does, so
findings are printed and the exit stays 0); 1 a finding reached --fail-on; 2 usage or internal
error (the check could not run, so it did not pass).`;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface CheckArgs {
  readonly command: 'check';
  readonly base: string;
  readonly head: string;
  readonly failOn: FailOn;
  readonly json: boolean;
  readonly config: string | null;
  readonly repo: string | null;
}

export type CliArgs = CheckArgs | { readonly command: 'help' } | { readonly command: 'version' };

const OPTIONS = {
  base: { type: 'string' },
  head: { type: 'string' },
  'fail-on': { type: 'string' },
  json: { type: 'boolean' },
  config: { type: 'string' },
  repo: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

/** Parses argv (without node and the script). Anything unknown, repeated or missing is a UsageError. */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  let parsed: ReturnType<typeof parseWith>;
  try {
    parsed = parseWith(argv);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals, tokens } = parsed;
  if (values.help === true) return { command: 'help' };
  if (values.version === true) return { command: 'version' };
  const repeated = tokens.find((t, i) => t.kind === 'option' && tokens.findIndex((u) => u.kind === 'option' && u.name === t.name) !== i);
  if (repeated !== undefined && repeated.kind === 'option') throw new UsageError(`option --${repeated.name} given more than once`);
  const [command, ...extra] = positionals;
  if (command === undefined) throw new UsageError('missing command (expected "check")');
  if (command !== 'check') throw new UsageError(`unknown command ${JSON.stringify(command)} (expected "check")`);
  if (extra.length > 0) throw new UsageError(`unexpected argument ${JSON.stringify(extra[0])}`);
  return {
    command,
    base: requiredText(values.base, '--base'),
    head: values.head === undefined ? 'HEAD' : requiredText(values.head, '--head'),
    failOn: failOnOf(values['fail-on']),
    json: values.json === true,
    config: values.config === undefined ? null : requiredText(values.config, '--config'),
    repo: values.repo === undefined ? null : requiredText(values.repo, '--repo'),
  };
}

function parseWith(argv: readonly string[]) {
  return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true, tokens: true });
}

function requiredText(value: string | undefined, flag: string): string {
  if (value === undefined) throw new UsageError(`missing ${flag}`);
  if (value === '') throw new UsageError(`${flag} must not be empty`);
  return value;
}

function failOnOf(value: string | undefined): FailOn {
  if (value === undefined) return DEFAULT_FAIL_ON;
  const parsed = parseFailOn(value);
  if (parsed === null) throw new UsageError(`--fail-on must be none, error or warning, got ${JSON.stringify(value)}`);
  return parsed;
}
