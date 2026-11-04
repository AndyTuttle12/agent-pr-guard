import { existsSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { seedIndex, SNAPSHOT_MESSAGE, snapshotWorkingTree, type Snapshot } from '../../src/plugin/snapshot.js';
import { MATH_TEST, MATH_TEST_WEAKENED, mathRepo } from '../helpers/cli.js';
import { cleanupTempDirs, makeRepo, makeTempDir, type TestRepo } from '../helpers/repo.js';

afterAll(cleanupTempDirs);

/** Git with no user or system config, as the test repos are made. */
const ENV: NodeJS.ProcessEnv = { PATH: process.env['PATH'] ?? '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

interface RepoState {
  readonly index: Buffer | null;
  readonly indexMtimeMs: number | null;
  readonly headFile: string;
  readonly refs: string;
  readonly files: Readonly<Record<string, string | null>>;
}

/** Everything the snapshot must leave alone, read without running a git command that refreshes the index. */
function state(repo: TestRepo, indexPath: string, files: readonly string[]): RepoState {
  const read = (path: string): string | null => (existsSync(join(repo.dir, path)) ? readFileSync(join(repo.dir, path), 'utf8') : null);
  return {
    index: existsSync(indexPath) ? readFileSync(indexPath) : null,
    indexMtimeMs: existsSync(indexPath) ? statSync(indexPath).mtimeMs : null,
    headFile: readFileSync(join(repo.git('rev-parse', '--absolute-git-dir').trim(), 'HEAD'), 'utf8'),
    refs: repo.git('for-each-ref', '--format=%(refname) %(objectname)'),
    files: Object.fromEntries(files.map((f) => [f, read(f)])),
  };
}

async function snapshot(repo: TestRepo, tmpRoot = makeTempDir('apg-snap-'), env = ENV): Promise<Snapshot> {
  const head = repo.git('rev-parse', 'HEAD').trim();
  return snapshotWorkingTree({ repoRoot: repo.dir, head, env, timeoutMs: 10_000, tmpRoot });
}

function treeFiles(repo: TestRepo, commit: string): string[] {
  return repo.git('ls-tree', '-r', '--name-only', commit).trim().split('\n').filter((l) => l !== '');
}

/** A feature branch with a committed change, then uncommitted, staged, untracked, ignored and deleted work on top. */
function dirtyRepo(): TestRepo {
  const { repo } = mathRepo();
  repo.write('.gitignore', 'ignored.log\n');
  repo.write('src/old.test.ts', "it('old', () => {});\n");
  repo.write('src/staged.ts', 'export const a = 1;\n');
  repo.commit('feature work');
  repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
  repo.write('src/staged.ts', 'export const a = 2;\n');
  repo.git('add', 'src/staged.ts');
  repo.write('src/new.ts', 'export const b = 1;\n');
  repo.write('ignored.log', 'noise\n');
  unlinkSync(join(repo.dir, 'src/old.test.ts'));
  return repo;
}

const WATCHED = ['src/math.test.ts', 'src/staged.ts', 'src/new.ts', 'ignored.log', 'src/old.test.ts'];

describe('snapshotWorkingTree', () => {
  it('commits the working tree on top of HEAD: changes, staged edits, untracked files and deletions, not ignored files', async () => {
    const repo = dirtyRepo();
    const head = repo.git('rev-parse', 'HEAD').trim();
    const snap = await snapshot(repo);
    expect(snap.dirty).toBe(true);
    expect(snap.commit).not.toBe(head);
    expect(repo.git('rev-list', '--parents', '-n', '1', snap.commit).trim()).toBe(`${snap.commit} ${head}`);
    expect(repo.git('log', '-1', '--format=%B', snap.commit).trim()).toBe(SNAPSHOT_MESSAGE);
    expect(treeFiles(repo, snap.commit).sort()).toEqual(['.gitignore', 'src/math.test.ts', 'src/math.ts', 'src/new.ts', 'src/staged.ts']);
    expect(repo.git('show', `${snap.commit}:src/math.test.ts`)).toBe(MATH_TEST_WEAKENED);
    expect(repo.git('show', `${snap.commit}:src/staged.ts`)).toBe('export const a = 2;\n');
  });

  it('leaves the real index byte-identical (and its mtime), the refs, HEAD and the working tree untouched', async () => {
    const repo = dirtyRepo();
    const indexPath = join(repo.dir, '.git', 'index');
    const before = state(repo, indexPath, WATCHED);
    expect(before.index).not.toBeNull();
    await snapshot(repo);
    expect(state(repo, indexPath, WATCHED)).toEqual(before);
    expect(repo.git('diff', '--cached', '--name-only').trim()).toBe('src/staged.ts');
  });

  it('removes its temporary index directory, on success and on failure', async () => {
    const repo = dirtyRepo();
    const tmpRoot = makeTempDir('apg-snap-');
    await snapshot(repo, tmpRoot);
    expect(readdirSync(tmpRoot)).toEqual([]);
    await expect(snapshotWorkingTree({ repoRoot: repo.dir, head: 'f'.repeat(40), env: ENV, timeoutMs: 10_000, tmpRoot })).rejects.toThrow(/git /);
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it('returns HEAD itself when the working tree matches it, writing no commit', async () => {
    const { repo } = mathRepo();
    const head = repo.git('rev-parse', 'HEAD').trim();
    expect(await snapshot(repo)).toEqual({ commit: head, dirty: false });
  });

  it('makes the same commit id for the same tree on the same HEAD', async () => {
    const repo = dirtyRepo();
    const first = await snapshot(repo);
    const second = await snapshot(repo);
    expect(second.commit).toBe(first.commit);
  });

  it('works with no real index, starting from an empty one and creating none', async () => {
    const { repo } = mathRepo();
    const head = repo.git('rev-parse', 'HEAD').trim();
    const indexPath = join(repo.dir, '.git', 'index');
    rmSync(indexPath);
    expect(await snapshot(repo)).toEqual({ commit: head, dirty: false });
    repo.write('src/math.test.ts', MATH_TEST_WEAKENED);
    const snap = await snapshot(repo);
    expect(snap.dirty).toBe(true);
    expect(repo.git('show', `${snap.commit}:src/math.test.ts`)).toBe(MATH_TEST_WEAKENED);
    expect(existsSync(indexPath)).toBe(false);
  });

  it('ignores a GIT_INDEX_FILE or GIT_DIR inherited from the environment', async () => {
    const repo = dirtyRepo();
    const indexPath = join(repo.dir, '.git', 'index');
    const before = state(repo, indexPath, WATCHED);
    const stray = join(makeTempDir('apg-stray-'), 'index');
    const other = makeRepo();
    const snap = await snapshot(repo, undefined, { ...ENV, GIT_INDEX_FILE: stray, GIT_DIR: join(other.dir, '.git') });
    expect(repo.git('show', `${snap.commit}:src/math.test.ts`)).toBe(MATH_TEST_WEAKENED);
    expect(existsSync(stray)).toBe(false);
    expect(state(repo, indexPath, WATCHED)).toEqual(before);
  });

  it("uses a linked worktree's own index and leaves it untouched", async () => {
    const { repo } = mathRepo();
    const wtDir = join(makeTempDir('apg-wt-'), 'wt');
    repo.git('worktree', 'add', '-q', '-b', 'other', wtDir);
    const wt: TestRepo = { ...repo, dir: wtDir, git: (...args) => repo.git('-C', wtDir, ...args) };
    writeFileSync(join(wtDir, 'src/math.test.ts'), MATH_TEST_WEAKENED);
    const indexPath = wt.git('rev-parse', '--path-format=absolute', '--git-path', 'index').trim();
    const before = state(wt, indexPath, ['src/math.test.ts']);
    const snap = await snapshot(wt);
    expect(repo.git('show', `${snap.commit}:src/math.test.ts`)).toBe(MATH_TEST_WEAKENED);
    expect(state(wt, indexPath, ['src/math.test.ts'])).toEqual(before);
    expect(readFileSync(join(repo.dir, 'src/math.test.ts'), 'utf8')).toBe(MATH_TEST);
  });
});

describe('seedIndex', () => {
  it('copies the index with an mtime one second older, so same-second edits are compared by content', () => {
    const dir = makeTempDir('apg-seed-');
    const source = join(dir, 'index');
    writeFileSync(source, Buffer.from([0x44, 0x49, 0x52, 0x43, 0, 1, 2]));
    utimesSync(source, new Date(1_700_000_000_000), new Date(1_700_000_005_500));
    const copy = join(dir, 'copy');
    seedIndex(source, copy);
    expect(readFileSync(copy)).toEqual(readFileSync(source));
    expect(statSync(copy).mtimeMs).toBe(1_700_000_004_500);
  });

  it('leaves no file when there is no index to copy', () => {
    const dir = makeTempDir('apg-seed-');
    seedIndex(join(dir, 'missing'), join(dir, 'copy'));
    expect(existsSync(join(dir, 'copy'))).toBe(false);
  });
});
