import { execFile } from 'node:child_process';

/**
 * Config pinned on every plugin git call. Unlike the reader (D3), the plugin keeps the user's
 * global and system config, because the working-tree snapshot must honour their global excludes
 * file and their clean filters (git-lfs) exactly as `git add` would. These pins only stop git
 * from running hooks or talking to helpers and daemons, and keep it from writing a split index.
 */
const PINNED_CONFIG: readonly string[] = [
  'core.hooksPath=/dev/null',
  'core.fsmonitor=false',
  'core.untrackedCache=false',
  'core.splitIndex=false',
  'protocol.allow=never',
  'gc.auto=0',
  'maintenance.auto=false',
  'credential.helper=',
];

const GLOBAL_ARGS: readonly string[] = ['--no-pager', '--no-replace-objects', ...PINNED_CONFIG.flatMap((kv) => ['-c', kv])];

const PINNED_ENV: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_NO_LAZY_FETCH: '1',
  GIT_NO_REPLACE_OBJECTS: '1',
  LC_ALL: 'C',
};

/** The `GIT_*` variables kept: they say where the user's config lives, not which repository to use. */
const KEPT_GIT_VARS: ReadonlySet<string> = new Set(['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM']);

/**
 * The inherited environment without its other `GIT_*` variables (a `GIT_DIR` or `GIT_INDEX_FILE`
 * left in the hook's environment would point git somewhere else), plus the pins and `extra`.
 */
export function pluginGitEnv(inherited: NodeJS.ProcessEnv, extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (value !== undefined && (!key.startsWith('GIT_') || KEPT_GIT_VARS.has(key))) env[key] = value;
  }
  return { ...env, ...PINNED_ENV, ...extra };
}

export interface GitCall {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  /** Variables set for this call only, such as `GIT_INDEX_FILE`. */
  readonly extraEnv?: Readonly<Record<string, string>>;
}

/** Runs git (never through a shell) and returns trimmed stdout; rejects with git's stderr on failure. */
export function gitOut(args: readonly string[], call: GitCall): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...GLOBAL_ARGS, ...args],
      {
        cwd: call.cwd,
        env: pluginGitEnv(call.env, call.extraEnv),
        timeout: call.timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 16 * 1024 * 1024,
        encoding: 'utf8',
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout.trim());
          return;
        }
        const timedOut = error.killed === true && error.signal === 'SIGKILL';
        const detail = timedOut ? `timed out after ${call.timeoutMs / 1000} s` : stderr.trim().split('\n')[0] || error.message;
        reject(new Error(`git ${args[0] ?? ''} failed: ${detail}`));
      },
    );
  });
}

/** Like gitOut, but a failure is `null`: for probes whose failure is an answer (no repo, no ref). */
export async function gitProbe(args: readonly string[], call: GitCall): Promise<string | null> {
  try {
    return await gitOut(args, call);
  } catch {
    return null;
  }
}
