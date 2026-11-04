import { closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gitOut, type GitCall } from './git.js';

/** A commit holding the working tree, or HEAD itself when nothing differs from it. */
export interface Snapshot {
  readonly commit: string;
  /** True when the working tree differs from HEAD and `commit` is the throwaway snapshot. */
  readonly dirty: boolean;
}

export interface SnapshotOptions {
  readonly repoRoot: string;
  /** The full id HEAD resolved to; the snapshot's only parent. */
  readonly head: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  /** Where the temporary index's directory is made. Defaults to the OS temp dir. */
  readonly tmpRoot?: string;
}

/** A fixed identity and date, so the same tree on the same HEAD always makes the same commit id. */
const SNAPSHOT_IDENTITY: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: 'agent-pr-guard',
  GIT_AUTHOR_EMAIL: 'agent-pr-guard@localhost',
  GIT_AUTHOR_DATE: '@0 +0000',
  GIT_COMMITTER_NAME: 'agent-pr-guard',
  GIT_COMMITTER_EMAIL: 'agent-pr-guard@localhost',
  GIT_COMMITTER_DATE: '@0 +0000',
};

export const SNAPSHOT_MESSAGE = 'agent-pr-guard: working tree snapshot';
export const TEMP_PREFIX = 'agent-pr-guard-';

/**
 * Builds a throwaway commit of the working tree (tracked changes, deletions and untracked files
 * that are not ignored) with HEAD as its parent, so the check sees what the agent has not
 * committed yet. Everything goes through a temporary index file: the real index, the refs and
 * the working tree are never written. The commit is referenced by nothing, so `git gc` prunes it.
 */
export async function snapshotWorkingTree(options: SnapshotOptions): Promise<Snapshot> {
  const call: GitCall = { cwd: options.repoRoot, env: options.env, timeoutMs: options.timeoutMs };
  const realIndex = resolve(options.repoRoot, await gitOut(['rev-parse', '--git-path', 'index'], call));
  const dir = mkdtempSync(join(options.tmpRoot ?? tmpdir(), TEMP_PREFIX));
  try {
    const tempIndex = join(dir, 'index');
    seedIndex(realIndex, tempIndex);
    const indexed: GitCall = { ...call, extraEnv: { GIT_INDEX_FILE: tempIndex } };
    await gitOut(['add', '--all', '--', ':/'], indexed);
    const tree = await gitOut(['write-tree'], indexed);
    const headTree = await gitOut(['rev-parse', '--verify', '--end-of-options', `${options.head}^{tree}`], call);
    if (tree === headTree) return { commit: options.head, dirty: false };
    const commit = await gitOut(['commit-tree', '--no-gpg-sign', '-p', options.head, '-m', SNAPSHOT_MESSAGE, tree], { ...call, extraEnv: SNAPSHOT_IDENTITY });
    return { commit, dirty: true };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Starts the temporary index as a copy of the real one, so `git add` only rehashes files whose
 * stat data changed and keeps sparse-checkout (skip-worktree) entries. With no real index it
 * starts empty, and `git add` hashes every file.
 *
 * The copy's mtime is set one second before the original's. Git treats an entry modified at or
 * after its index file's mtime as racily clean and compares content, so an older mtime only makes
 * git check more entries by content; a copy with a fresh mtime would hide an edit made in the same
 * second the real index was written.
 */
export function seedIndex(realIndex: string, tempIndex: string): void {
  let fd: number;
  try {
    fd = openSync(realIndex, 'r');
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return;
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    writeFileSync(tempIndex, readFileSync(fd));
    utimesSync(tempIndex, stat.atime, new Date(stat.mtimeMs - 1000));
  } finally {
    closeSync(fd);
  }
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
