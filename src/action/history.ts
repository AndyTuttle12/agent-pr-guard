import { execFile } from 'node:child_process';

export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type Git = (args: readonly string[]) => Promise<GitResult>;

const FETCH_TIMEOUT_MS = 5 * 60_000;
const LOCAL_TIMEOUT_MS = 30_000;

/** Depths tried, in order, on a shallow checkout before falling back to the full history. */
export const FETCH_DEPTHS = [100, 1000] as const;

/**
 * Runs git in `repoDir` with the runner's own config, which carries the checkout's credentials.
 * Fetches never prompt, and hooks are off.
 */
export function gitIn(repoDir: string, env: NodeJS.ProcessEnv): Git {
  return (args) =>
    new Promise((resolve) => {
      const timeout = args[0] === 'fetch' ? FETCH_TIMEOUT_MS : LOCAL_TIMEOUT_MS;
      execFile(
        'git',
        ['-c', 'core.hooksPath=/dev/null', ...args],
        { cwd: repoDir, env: { ...env, GIT_TERMINAL_PROMPT: '0' }, timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
        (error, stdout, stderr) => {
          const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
          resolve({ code, stdout, stderr: error !== null && stderr === '' ? error.message : stderr });
        },
      );
    });
}

export function isObjectId(rev: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(rev);
}

/**
 * Makes sure merge-base(base, head) resolves locally. `actions/checkout` fetches one commit by
 * default, which holds neither the PR's base nor its head history, so this fetches the two
 * commits by id at growing depths, then the whole history. A non-shallow clone only fetches
 * the commits it is missing: deepening it would make it shallow. Fetching only ever adds
 * objects; when it fails, the check runs anyway and reports the revision it cannot resolve.
 * Returns a warning for each failed fetch.
 */
export async function ensureHistory(git: Git, base: string, head: string): Promise<string[]> {
  if (await hasMergeBase(git, base, head)) return [];
  const warnings: string[] = [];
  const ids = [...new Set([base, head].filter(isObjectId))];
  const fetch = async (extra: readonly string[]): Promise<void> => {
    const result = await git(['fetch', '--no-tags', '--no-recurse-submodules', '--quiet', ...extra, 'origin', ...ids]);
    if (result.code !== 0) warnings.push(`${['git fetch', ...extra].join(' ')} failed: ${result.stderr.trim()}`);
  };
  if (!(await isShallow(git))) {
    if (ids.length > 0) await fetch([]);
    return warnings;
  }
  for (const depth of FETCH_DEPTHS) {
    await fetch(ids.length > 0 ? [`--depth=${depth}`] : [`--deepen=${depth}`]);
    if (await hasMergeBase(git, base, head)) return warnings;
  }
  if (await isShallow(git)) await fetch(['--unshallow']);
  return warnings;
}

async function hasMergeBase(git: Git, base: string, head: string): Promise<boolean> {
  return (await git(['merge-base', '--end-of-options', base, head])).code === 0;
}

async function isShallow(git: Git): Promise<boolean> {
  const result = await git(['rev-parse', '--is-shallow-repository']);
  return result.code === 0 && result.stdout.trim() === 'true';
}
