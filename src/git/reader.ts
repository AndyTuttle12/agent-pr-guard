import { CODEOWNERS_PATHS, type ChangeSet, type ChangeStatus, type FileChange, type FileSide } from '../changeset.js';
import { parseBatch, parseBatchCheck, type BatchCheckEntry } from './cat-file.js';
import { parseRawDiff, type RawChange, type RawStatus } from './raw-diff.js';
import { buildGitEnv, GitError, runGit, type RunGitOptions } from './run.js';

export interface GitReaderOptions {
  readonly repoDir: string;
  readonly gitBinary?: string;
  /** Per git invocation. */
  readonly timeoutMs?: number;
  /** Cap on any single git invocation's stdout. */
  readonly maxOutputBytes?: number;
  /** Blobs larger than this are not read; their side is marked `skipped: 'too-large'`. */
  readonly maxBlobBytes?: number;
  readonly env?: NodeJS.ProcessEnv;
}

export const MIN_GIT_VERSION: readonly [number, number, number] = [2, 32, 0];

const DEFAULTS = {
  gitBinary: 'git',
  timeoutMs: 60_000,
  maxOutputBytes: 512 * 1024 * 1024,
  maxBlobBytes: 4 * 1024 * 1024,
} as const;

const GITLINK_MODE = '160000';
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ZERO_OID = /^0+$/;
const RENAME_LIMIT = 1000;

const STATUS: Record<RawStatus, ChangeStatus> = {
  A: 'added',
  C: 'added',
  D: 'deleted',
  M: 'modified',
  R: 'renamed',
  T: 'type-changed',
};

export function parseGitVersion(output: string): [number, number, number] {
  const match = /^git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(output.trim());
  if (!match) throw new Error(`cannot parse git version from ${JSON.stringify(output.trim())}`);
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

export function versionAtLeast(actual: readonly number[], minimum: readonly number[]): boolean {
  for (let i = 0; i < minimum.length; i++) {
    const a = actual[i] ?? 0;
    const m = minimum[i] ?? 0;
    if (a !== m) return a > m;
  }
  return true;
}

/**
 * A revision is only ever passed to git on stdin (cat-file --batch-check), never on argv, so it
 * cannot become an option. It still has to be one line of printable text.
 */
export function assertSafeRevision(rev: string): void {
  if (rev === '' || rev.length > 256 || /[\x00-\x20\x7f]/.test(rev)) {
    throw new Error(`invalid revision ${JSON.stringify(rev)}`);
  }
}

export function isBinary(content: Buffer): boolean {
  return content.subarray(0, 8000).includes(0);
}

export function decodeText(content: Buffer): string {
  const text = new TextDecoder('utf-8').decode(content);
  return text.startsWith('﻿') ? text.slice(1) : text;
}

/**
 * Read-only access to a git repository through plumbing commands only (`cat-file --batch-check`,
 * `cat-file --batch`, `merge-base`, `diff-tree`). Hooks, fsmonitor, system and global config,
 * replace objects, external diff drivers, textconv, lazy fetches and every transport are off.
 */
export class GitReader {
  private readonly run: RunGitOptions;
  private readonly maxBlobBytes: number;
  private versionChecked = false;

  constructor(options: GitReaderOptions) {
    this.run = {
      gitBinary: options.gitBinary ?? DEFAULTS.gitBinary,
      cwd: options.repoDir,
      env: buildGitEnv(options.env ?? process.env),
      timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULTS.maxOutputBytes,
    };
    this.maxBlobBytes = options.maxBlobBytes ?? DEFAULTS.maxBlobBytes;
  }

  async version(): Promise<[number, number, number]> {
    const out = await runGit(this.run, ['version']);
    return parseGitVersion(out.toString('utf8'));
  }

  /** Fails closed on a git older than MIN_GIT_VERSION, which would ignore GIT_CONFIG_GLOBAL. */
  async ensureSupportedGit(): Promise<void> {
    if (this.versionChecked) return;
    const version = await this.version();
    if (!versionAtLeast(version, MIN_GIT_VERSION)) {
      throw new Error(`git ${version.join('.')} is too old; agent-pr-guard needs ${MIN_GIT_VERSION.join('.')} or newer`);
    }
    this.versionChecked = true;
  }

  async resolveCommit(rev: string): Promise<string> {
    assertSafeRevision(rev);
    const [entry] = await this.batchCheck([`${rev}^{commit}`]);
    if (!entry?.found || entry.type !== 'commit') {
      throw new Error(`cannot resolve ${JSON.stringify(rev)} to a commit in this repository`);
    }
    return entry.oid;
  }

  async mergeBase(a: string, b: string): Promise<string> {
    assertOid(a);
    assertOid(b);
    try {
      const out = await runGit(this.run, ['merge-base', a, b]);
      const oid = out.toString('utf8').trim();
      assertOid(oid);
      return oid;
    } catch (error) {
      if (error instanceof GitError && error.exitCode === 1 && error.stderr === '') {
        throw new Error(`${a} and ${b} have no common ancestor`);
      }
      throw error;
    }
  }

  async diffTree(from: string, to: string): Promise<RawChange[]> {
    assertOid(from);
    assertOid(to);
    const out = await runGit(this.run, [
      'diff-tree',
      '-r',
      '-z',
      '--raw',
      '--no-abbrev',
      '-M',
      `-l${RENAME_LIMIT}`,
      '--no-ext-diff',
      '--no-textconv',
      from,
      to,
      '--',
    ]);
    return parseRawDiff(out);
  }

  async batchCheck(queries: readonly string[]): Promise<BatchCheckEntry[]> {
    if (queries.length === 0) return [];
    for (const query of queries) {
      if (/[\n\r\0]/.test(query)) throw new Error(`invalid object query ${JSON.stringify(query)}`);
    }
    const out = await runGit(this.run, ['cat-file', '--batch-check'], `${queries.join('\n')}\n`);
    return parseBatchCheck(out, queries);
  }

  /** Reads blobs by oid. Every requested oid must exist; a missing one throws. */
  async readBlobs(oids: readonly string[]): Promise<Map<string, Buffer>> {
    const unique = [...new Set(oids)];
    if (unique.length === 0) return new Map();
    unique.forEach(assertOid);
    const out = await runGit(this.run, ['cat-file', '--batch'], `${unique.join('\n')}\n`);
    const blobs = parseBatch(out);
    for (const oid of unique) {
      if (!blobs.has(oid)) throw new Error(`object ${oid} missing from cat-file output`);
    }
    return blobs;
  }

  /** Reads `<commit>:<path>` as text, or null when the path does not exist in that commit. */
  async readFileAt(commit: string, path: string): Promise<string | null> {
    assertOid(commit);
    const [entry] = await this.batchCheck([`${commit}:${path}`]);
    if (!entry?.found) return null;
    if (entry.type !== 'blob') throw new Error(`${path} at ${commit} is a ${entry.type}, not a file`);
    const blobs = await this.readBlobs([entry.oid]);
    const blob = blobs.get(entry.oid);
    if (blob === undefined) throw new Error(`could not read ${path} at ${commit}`);
    return decodeText(blob);
  }

  /** Builds the ChangeSet for merge-base(base, head)..head with old and new contents. */
  async readChangeSet(baseRev: string, headRev: string): Promise<ChangeSet> {
    await this.ensureSupportedGit();
    const base = await this.resolveCommit(baseRev);
    const head = await this.resolveCommit(headRev);
    const mergeBase = await this.mergeBase(base, head);
    const raw = await this.diffTree(mergeBase, head);
    const sizes = await this.blobSizes(raw);
    const wanted = [...sizes].filter(([, size]) => size <= this.maxBlobBytes).map(([oid]) => oid);
    const blobs = await this.readBlobs(wanted);
    const files = raw.map((change) => this.toFileChange(change, sizes, blobs));
    const baseCodeowners = await this.existingPaths(mergeBase, CODEOWNERS_PATHS);
    return { base, head, mergeBase, files, baseCodeowners };
  }

  /** The paths that name any object in `commit`'s tree. */
  private async existingPaths(commit: string, paths: readonly string[]): Promise<string[]> {
    assertOid(commit);
    const entries = await this.batchCheck(paths.map((path) => `${commit}:${path}`));
    return paths.filter((_path, index) => entries[index]?.found === true);
  }

  private async blobSizes(raw: readonly RawChange[]): Promise<Map<string, number>> {
    const oids = new Set<string>();
    for (const change of raw) {
      if (!ZERO_OID.test(change.oldOid) && change.oldMode !== GITLINK_MODE) oids.add(change.oldOid);
      if (!ZERO_OID.test(change.newOid) && change.newMode !== GITLINK_MODE) oids.add(change.newOid);
    }
    const queries = [...oids];
    const entries = await this.batchCheck(queries);
    const sizes = new Map<string, number>();
    entries.forEach((entry, index) => {
      if (!entry.found) throw new Error(`object ${queries[index] ?? ''} is ${entry.reason}`);
      if (entry.type !== 'blob') throw new Error(`object ${entry.oid} is a ${entry.type}, expected a blob`);
      sizes.set(entry.oid, entry.size);
    });
    return sizes;
  }

  private toFileChange(change: RawChange, sizes: Map<string, number>, blobs: Map<string, Buffer>): FileChange {
    const status = STATUS[change.status];
    const side = (path: string, mode: string, oid: string): FileSide | null => {
      if (ZERO_OID.test(oid)) return null;
      if (mode === GITLINK_MODE) return { path, mode, oid, text: null, skipped: 'submodule' };
      const blob = blobs.get(oid);
      if (blob === undefined) {
        if ((sizes.get(oid) ?? 0) > this.maxBlobBytes) return { path, mode, oid, text: null, skipped: 'too-large' };
        throw new Error(`blob ${oid} for ${path} was not read`);
      }
      if (isBinary(blob)) return { path, mode, oid, text: null, skipped: 'binary' };
      return { path, mode, oid, text: decodeText(blob) };
    };
    const oldSide = change.status === 'A' || change.status === 'C' ? null : side(change.oldPath, change.oldMode, change.oldOid);
    const newSide = change.status === 'D' ? null : side(change.newPath, change.newMode, change.newOid);
    const path = change.status === 'D' ? change.oldPath : change.newPath;
    const base = { status, path, old: oldSide, new: newSide };
    return change.status === 'R' && change.score !== null ? { ...base, similarity: change.score } : base;
  }
}

function assertOid(value: string): void {
  if (!OID.test(value)) throw new Error(`expected a full object id, got ${JSON.stringify(value)}`);
}
