import { execFile } from 'node:child_process';

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

/**
 * Config pinned on every invocation. Command-line `-c` has the highest precedence, so these
 * override anything the inspected repo's own `.git/config` sets.
 */
export const PINNED_CONFIG: readonly string[] = [
  'core.hooksPath=/dev/null',
  'core.fsmonitor=false',
  'core.untrackedCache=false',
  'protocol.allow=never',
  'submodule.recurse=false',
  'gc.auto=0',
  'maintenance.auto=false',
  'diff.external=',
  'credential.helper=',
];

const GLOBAL_ARGS: readonly string[] = [
  '--no-pager',
  '--no-replace-objects',
  '--literal-pathspecs',
  ...PINNED_CONFIG.flatMap((kv) => ['-c', kv]),
];

/** Inherited variables git needs to find itself and its temp dir; every GIT_* variable is dropped. */
const PASSTHROUGH_ENV = ['PATH', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP'] as const;

export const PINNED_ENV: Readonly<Record<string, string>> = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_NO_LAZY_FETCH: '1',
  GIT_ATTR_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  LC_ALL: 'C',
};

export function buildGitEnv(inherited: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASSTHROUGH_ENV) {
    const value = inherited[key];
    if (value !== undefined && value !== '') env[key] = value;
  }
  return { ...env, ...PINNED_ENV };
}

export interface RunGitOptions {
  readonly gitBinary: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export function gitArgv(args: readonly string[]): string[] {
  return [...GLOBAL_ARGS, ...args];
}

/** Runs git with an argument array (never a shell) and returns raw stdout. */
export function runGit(opts: RunGitOptions, args: readonly string[], input?: string): Promise<Buffer> {
  const argv = gitArgv(args);
  return new Promise((resolve, reject) => {
    const child = execFile(
      opts.gitBinary,
      argv,
      {
        cwd: opts.cwd,
        env: opts.env,
        encoding: 'buffer',
        maxBuffer: opts.maxOutputBytes,
        timeout: opts.timeoutMs,
        killSignal: 'SIGKILL',
        windowsHide: true,
        shell: false,
      },
      (error, stdout, stderr) => {
        if (error) {
          const stderrText = stderr.toString('utf8').trim();
          const code = typeof error.code === 'number' ? error.code : null;
          const detail = stderrText !== '' ? stderrText : error.message;
          reject(new GitError(`git ${args[0] ?? ''} failed: ${detail}`, args, stderrText, code));
          return;
        }
        resolve(stdout);
      },
    );
    // The exec callback reports the real failure; a closed pipe on early exit is not one.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input ?? '');
  });
}
