import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ConfigError, loadConfigFromCommit, loadConfigFromFile, type LoadedConfig } from '../engine/config.js';
import { buildRegistry, evaluate, type RulePack } from '../engine/engine.js';
import { GitReader } from '../git/reader.js';
import { ALL_PACKS } from '../packs/index.js';
import { exceeds } from './fail-on.js';
import { parseCliArgs, USAGE, UsageError, type CheckArgs } from './args.js';
import { formatHuman, formatJson, formatJsonError, uninspectedFiles, type CheckResult } from './report.js';

export const EXIT_PASS = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_ERROR = 2;

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Resolves a relative `--repo` or `--config`, and is the repo when `--repo` is absent. */
  readonly cwd: string;
  readonly version: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly packs?: readonly RulePack[];
}

/** Runs the CLI and returns its exit code. Never throws: any failure is exit 2 (fail closed). */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  let args: ReturnType<typeof parseCliArgs>;
  try {
    args = parseCliArgs(argv);
  } catch (error) {
    io.stderr(`agent-pr-guard: ${messageOf(error)}\n\n${USAGE}\n`);
    return EXIT_ERROR;
  }
  if (args.command === 'help') {
    io.stdout(`${USAGE}\n`);
    return EXIT_PASS;
  }
  if (args.command === 'version') {
    io.stdout(`${io.version}\n`);
    return EXIT_PASS;
  }
  try {
    const result = await check(args, io);
    io.stdout(args.json ? formatJson(result) : formatHuman(result, args.failOn));
    return exceeds(result.report, args.failOn) ? EXIT_FINDINGS : EXIT_PASS;
  } catch (error) {
    const message = messageOf(error);
    io.stderr(`agent-pr-guard: ${message}\n`);
    if (args.json) io.stdout(formatJsonError(message));
    return EXIT_ERROR;
  }
}

async function check(args: CheckArgs, io: CliIo): Promise<CheckResult> {
  const packs = io.packs ?? ALL_PACKS;
  const registry = buildRegistry(packs);
  const repoDir = repoDirectory(args.repo, io.cwd);
  const trusted = args.config === null ? null : await loadTrustedConfig(resolve(io.cwd, args.config), repoDir, registry);
  const reader = new GitReader({ repoDir, env: io.env ?? process.env });
  const changeSet = await reader.readChangeSet(args.base, args.head);
  const loaded: LoadedConfig = trusted ?? (await loadConfigFromCommit(reader, changeSet.base, registry));
  return {
    report: evaluate(changeSet, loaded.config, packs),
    configSource: loaded.source,
    uninspected: uninspectedFiles(changeSet),
  };
}

function repoDirectory(repo: string | null, cwd: string): string {
  const dir = resolve(cwd, repo ?? '.');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new UsageError(`--repo ${dir} is not a directory`);
  return realpathSync(dir);
}

/**
 * `--config` replaces the base commit's config, so it must be a file the PR cannot edit: one
 * inside the inspected working tree is the head's copy, and is refused.
 */
async function loadTrustedConfig(path: string, repoDir: string, registry: ReturnType<typeof buildRegistry>): Promise<LoadedConfig> {
  let real: string;
  try {
    real = realpathSync(path);
  } catch (error) {
    throw new ConfigError(`cannot read config ${path}: ${messageOf(error)}`);
  }
  const tree = worktreeRoot(repoDir);
  if (isInside(real, tree)) {
    throw new ConfigError(
      `--config ${path} is inside the repository being checked (${tree}), where the PR can edit it; pass a file from outside the repository, or omit --config to use .agent-pr-guard.json from the base commit`,
    );
  }
  return loadConfigFromFile(real, registry);
}

/** The nearest directory at or above `dir` holding a `.git` entry, else `dir` itself (a bare repo). */
function worktreeRoot(dir: string): string {
  for (let current = dir; ; current = dirname(current)) {
    if (existsSync(join(current, '.git'))) return current;
    if (dirname(current) === current) return dir;
  }
}

function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel === '' || (rel.split(sep)[0] !== '..' && !isAbsolute(rel));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
