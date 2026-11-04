import { isAbsolute, resolve } from 'node:path';
import { DEFAULT_FAIL_ON, parseFailOn, type FailOn } from '../cli/fail-on.js';

export type { FailOn };

export interface ActionInputs {
  readonly base: string;
  readonly head: string;
  /** A trusted config file outside the checked repository, or null for the base commit's config. */
  readonly config: string | null;
  readonly failOn: FailOn;
  /** Absolute path of the repository to check. */
  readonly repoDir: string;
  /** Absolute path that a relative `config` is resolved against (the workspace). */
  readonly workspace: string;
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

/**
 * GitHub passes input `<name>` as `INPUT_<NAME>`, upper-cased with spaces turned into
 * underscores and hyphens kept (`fail-on` arrives as `INPUT_FAIL-ON`). Values are trimmed, as
 * the toolkit does.
 */
export function readInput(env: NodeJS.ProcessEnv, name: string): string {
  return (env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? '').trim();
}

/** Reads and validates every input. Anything missing or malformed is an InputError: the check never runs on a guess. */
export function parseActionInputs(env: NodeJS.ProcessEnv, cwd: string): ActionInputs {
  const workspace = absolute(env['GITHUB_WORKSPACE'] ?? '', cwd);
  const base = revision(readInput(env, 'base'), 'base');
  const head = revision(readInput(env, 'head'), 'head');
  const config = readInput(env, 'config');
  return {
    base,
    head,
    config: config === '' ? null : config,
    failOn: failOn(readInput(env, 'fail-on')),
    repoDir: absolute(readInput(env, 'path'), workspace),
    workspace,
  };
}

const NO_PR_HINT: Readonly<Record<'base' | 'head', string>> = {
  base: 'it defaults to the pull request base commit, so outside a pull_request event set it explicitly (for example base: origin/main)',
  head: 'it defaults to the pull request head commit, so outside a pull_request event set it explicitly (for example head: HEAD)',
};

function revision(value: string, name: 'base' | 'head'): string {
  if (value === '') throw new InputError(`input ${name} is empty: ${NO_PR_HINT[name]}`);
  if (value.startsWith('-')) throw new InputError(`input ${name} must be a revision, not an option: ${JSON.stringify(value)}`);
  if (/[\s\0]/.test(value)) throw new InputError(`input ${name} must be a single revision: ${JSON.stringify(value)}`);
  return value;
}

function failOn(value: string): FailOn {
  if (value === '') return DEFAULT_FAIL_ON;
  const parsed = parseFailOn(value);
  if (parsed === null) throw new InputError(`input fail-on must be "none", "error" or "warning", got ${JSON.stringify(value)}`);
  return parsed;
}

function absolute(path: string, against: string): string {
  if (path === '') return against;
  return isAbsolute(path) ? path : resolve(against, path);
}

/** The CLI arguments for one check. The base and head were validated above and travel to git on stdin. */
export function checkArgv(inputs: ActionInputs): string[] {
  const argv = ['check', '--base', inputs.base, '--head', inputs.head, '--json', '--repo', inputs.repoDir];
  if (inputs.config !== null) argv.push('--config', inputs.config);
  return argv;
}
