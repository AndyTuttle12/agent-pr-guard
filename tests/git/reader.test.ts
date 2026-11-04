import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseBatch, parseBatchCheck } from '../../src/git/cat-file.js';
import { parseRawDiff } from '../../src/git/raw-diff.js';
import {
  assertSafeRevision,
  GitReader,
  isBinary,
  parseGitVersion,
  versionAtLeast,
} from '../../src/git/reader.js';
import { buildGitEnv, gitArgv, PINNED_ENV } from '../../src/git/run.js';
import { cleanupTempDirs, makeRepo as repo, makeTempDir, type TestRepo } from '../helpers/repo.js';

afterEach(cleanupTempDirs);

describe('GitReader.readChangeSet', () => {
  it('reports added, modified, deleted and renamed files with both contents', async () => {
    const r = repo();
    r.write('keep.ts', 'export const a = 1;\n');
    r.write('gone.test.ts', 'it("x", () => {});\n');
    const py = 'def test_a():\n    assert 1 == 1\n'.repeat(5);
    r.write('old/name.py', py);
    const base = r.commit('base');
    r.write('keep.ts', 'export const a = 2;\n');
    r.remove('gone.test.ts');
    r.remove('old/name.py');
    r.write('new/name.py', py);
    r.write('added.go', 'package main\n');
    const head = r.commit('head');

    const cs = await new GitReader({ repoDir: r.dir }).readChangeSet(base, head);
    expect(cs.base).toBe(base);
    expect(cs.head).toBe(head);
    expect(cs.mergeBase).toBe(base);
    const byPath = new Map(cs.files.map((f) => [f.path, f]));
    expect(byPath.get('keep.ts')).toMatchObject({
      status: 'modified',
      old: { text: 'export const a = 1;\n' },
      new: { text: 'export const a = 2;\n' },
    });
    expect(byPath.get('gone.test.ts')).toMatchObject({ status: 'deleted', new: null, old: { path: 'gone.test.ts' } });
    expect(byPath.get('added.go')).toMatchObject({ status: 'added', old: null, new: { text: 'package main\n' } });
    expect(byPath.get('new/name.py')).toMatchObject({
      status: 'renamed',
      similarity: 100,
      old: { path: 'old/name.py' },
      new: { path: 'new/name.py' },
    });
  });

  it('diffs from the merge base, so changes that landed on the base branch are not attributed to head', async () => {
    const r = repo();
    r.write('a.txt', 'a\n');
    const root = r.commit('root');
    r.git('checkout', '-q', '-b', 'feature');
    r.write('feature.txt', 'f\n');
    const head = r.commit('feature');
    r.git('checkout', '-q', 'main');
    r.write('main-only.txt', 'm\n');
    const base = r.commit('main moves on');

    const cs = await new GitReader({ repoDir: r.dir }).readChangeSet(base, head);
    expect(cs.mergeBase).toBe(root);
    expect(cs.files.map((f) => f.path)).toEqual(['feature.txt']);
  });

  it('lists the CODEOWNERS locations the merge base has, changed or not', async () => {
    const r = repo();
    r.write('docs/CODEOWNERS', '* @andy\n');
    r.write('.gitlab/CODEOWNERS', '* @andy\n');
    r.write('src/CODEOWNERS', '* @andy\n');
    const root = r.commit('root');
    r.git('checkout', '-q', '-b', 'feature');
    r.write('.github/CODEOWNERS', '* @someone\n');
    r.remove('.gitlab/CODEOWNERS');
    const head = r.commit('feature');
    r.git('checkout', '-q', 'main');
    r.write('CODEOWNERS', '* @andy\n');
    const base = r.commit('main gains a root CODEOWNERS');

    const cs = await new GitReader({ repoDir: r.dir }).readChangeSet(base, head);
    expect(cs.mergeBase).toBe(root);
    expect(cs.baseCodeowners).toEqual(['docs/CODEOWNERS', '.gitlab/CODEOWNERS']);
  });

  it('accepts branch names and resolves them to full commit ids', async () => {
    const r = repo();
    r.write('a.txt', 'a\n');
    const base = r.commit('root');
    r.git('checkout', '-q', '-b', 'feature');
    r.write('a.txt', 'b\n');
    const head = r.commit('change');
    const cs = await new GitReader({ repoDir: r.dir }).readChangeSet('main', 'feature');
    expect([cs.base, cs.head]).toEqual([base, head]);
  });

  it('marks binary, oversized and submodule sides as skipped instead of decoding them', async () => {
    const r = repo();
    r.write('big.txt', 'x'.repeat(100));
    r.write('img.bin', Buffer.from([1, 2, 0, 3]));
    const base = r.commit('base');
    r.write('big.txt', 'y'.repeat(200));
    r.write('img.bin', Buffer.from([1, 2, 0, 4]));
    r.git('add', '-A');
    r.git('update-index', '--add', '--cacheinfo', `160000,${base},vendor/sub`);
    r.git('commit', '-q', '--no-verify', '-m', 'head');
    const head = r.git('rev-parse', 'HEAD').trim();

    const cs = await new GitReader({ repoDir: r.dir, maxBlobBytes: 150 }).readChangeSet(base, head);
    const byPath = new Map(cs.files.map((f) => [f.path, f]));
    expect(byPath.get('big.txt')?.old).toMatchObject({ text: 'x'.repeat(100) });
    expect(byPath.get('big.txt')?.new).toMatchObject({ text: null, skipped: 'too-large' });
    expect(byPath.get('img.bin')?.new).toMatchObject({ text: null, skipped: 'binary' });
    expect(byPath.get('vendor/sub')?.new).toMatchObject({ text: null, skipped: 'submodule', mode: '160000' });
  });

  it('reports a file replaced by a symlink as a type change', async () => {
    const r = repo();
    r.write('a.test.js', 'expect(1).toBe(1);\n');
    const base = r.commit('base');
    r.remove('a.test.js');
    r.git('-c', 'core.symlinks=true', 'update-index', '--add', '--cacheinfo', `120000,${writeBlob(r, 'elsewhere.js')},a.test.js`);
    r.git('commit', '-q', '--no-verify', '-m', 'symlink');
    const head = r.git('rev-parse', 'HEAD').trim();
    const cs = await new GitReader({ repoDir: r.dir }).readChangeSet(base, head);
    expect(cs.files).toHaveLength(1);
    expect(cs.files[0]).toMatchObject({ status: 'type-changed', new: { mode: '120000', text: 'elsewhere.js' } });
  });

  it('fails when the commits share no history', async () => {
    const r = repo();
    r.write('a.txt', 'a\n');
    const base = r.commit('root');
    r.git('checkout', '-q', '--orphan', 'other');
    r.write('b.txt', 'b\n');
    const head = r.commit('unrelated');
    await expect(new GitReader({ repoDir: r.dir }).readChangeSet(base, head)).rejects.toThrow(/no common ancestor/);
  });

  it('fails on an unknown revision', async () => {
    const r = repo();
    r.write('a.txt', 'a\n');
    const base = r.commit('root');
    await expect(new GitReader({ repoDir: r.dir }).readChangeSet(base, 'f'.repeat(40))).rejects.toThrow(/cannot resolve/);
  });

  it('fails closed when git output exceeds the cap', async () => {
    const r = repo();
    r.write('a.txt', 'a\n');
    const base = r.commit('root');
    for (let i = 0; i < 50; i++) r.write(`f${i}.txt`, `${i}\n`);
    const head = r.commit('many');
    await expect(new GitReader({ repoDir: r.dir, maxOutputBytes: 256 }).readChangeSet(base, head)).rejects.toThrow();
  });
});

describe('GitReader hardening', () => {
  it('never passes a revision on argv, so option-shaped revisions cannot inject flags', async () => {
    const r = repo();
    r.write('a.txt', 'a\n');
    const base = r.commit('root');
    const marker = join(makeTempDir(), 'pwned');
    const reader = new GitReader({ repoDir: r.dir });
    await expect(reader.readChangeSet(base, `--output=${marker}`)).rejects.toThrow(/cannot resolve/);
    await expect(reader.readChangeSet('-h', base)).rejects.toThrow(/cannot resolve/);
    expect(existsSync(marker)).toBe(false);
  });

  it('rejects revisions with whitespace or control characters', () => {
    expect(() => assertSafeRevision('main\nHEAD')).toThrow();
    expect(() => assertSafeRevision('a b')).toThrow();
    expect(() => assertSafeRevision('')).toThrow();
    expect(() => assertSafeRevision('origin/main~2')).not.toThrow();
  });

  it('ignores replace objects', async () => {
    const r = repo();
    r.write('a.test.ts', 'expect(1).toBe(1);\n');
    const base = r.commit('base');
    r.write('a.test.ts', 'expect(2).toBe(2);\n');
    const head = r.commit('head');
    const realBlob = r.git('rev-parse', `${head}:a.test.ts`).trim();
    const fakeBlob = writeBlob(r, 'innocent\n');
    r.git('replace', realBlob, fakeBlob);
    expect(r.git('cat-file', '-p', realBlob)).toBe('innocent\n');

    const cs = await new GitReader({ repoDir: r.dir }).readChangeSet(base, head);
    expect(cs.files[0]?.new?.text).toBe('expect(2).toBe(2);\n');
  });

  it('does not run repo-configured hooks, fsmonitor, filters or textconv', async () => {
    const r = repo();
    const markerDir = makeTempDir();
    const script = join(markerDir, 'evil.sh');
    writeFileSync(script, `#!/bin/sh\ntouch "${markerDir}/ran-$1"\ncat\n`, { mode: 0o755 });
    r.write('.gitattributes', '*.ts filter=evil diff=evil\n');
    r.write('a.ts', 'one\n');
    const base = r.commit('base');
    r.write('a.ts', 'two\n');
    const head = r.commit('head');
    r.git('config', 'core.hooksPath', markerDir);
    r.git('config', 'core.fsmonitor', `${script} fsmonitor`);
    r.git('config', 'filter.evil.smudge', `${script} smudge`);
    r.git('config', 'filter.evil.clean', `${script} clean`);
    r.git('config', 'diff.evil.textconv', `${script} textconv`);
    r.git('config', 'diff.external', `${script} external`);
    for (const hook of ['reference-transaction', 'post-checkout', 'post-index-change']) {
      writeFileSync(join(markerDir, hook), `#!/bin/sh\ntouch "${markerDir}/ran-hook"\n`, { mode: 0o755 });
    }

    const cs = await new GitReader({ repoDir: r.dir }).readChangeSet(base, head);
    expect(cs.files[0]?.new?.text).toBe('two\n');
    for (const name of ['fsmonitor', 'smudge', 'clean', 'textconv', 'external', 'hook']) {
      expect(existsSync(join(markerDir, `ran-${name}`)), name).toBe(false);
    }
  });

  it('drops inherited GIT_* variables and pins the isolation variables', () => {
    const env = buildGitEnv({
      PATH: '/usr/bin',
      HOME: '/home/u',
      GIT_DIR: '/elsewhere',
      GIT_CONFIG_GLOBAL: '/home/u/.gitconfig',
      GIT_CONFIG_PARAMETERS: "'core.hooksPath'='/x'",
      GIT_EXTERNAL_DIFF: '/x',
    });
    expect(env).toEqual({ PATH: '/usr/bin', ...PINNED_ENV });
    expect(env['GIT_CONFIG_GLOBAL']).toBe('/dev/null');
    expect(env['GIT_CONFIG_NOSYSTEM']).toBe('1');
    expect(env['GIT_NO_REPLACE_OBJECTS']).toBe('1');
  });

  it('reads the right repository even when the caller has GIT_DIR set', async () => {
    const r = repo();
    const decoy = repo();
    decoy.write('decoy.txt', 'd\n');
    decoy.commit('decoy');
    r.write('a.txt', 'a\n');
    const base = r.commit('root');
    r.write('a.txt', 'b\n');
    const head = r.commit('head');
    const reader = new GitReader({ repoDir: r.dir, env: { ...process.env, GIT_DIR: join(decoy.dir, '.git') } });
    const cs = await reader.readChangeSet(base, head);
    expect(cs.files.map((f) => f.path)).toEqual(['a.txt']);
  });

  it('pins hooks, fsmonitor and transports off on every invocation', () => {
    const argv = gitArgv(['diff-tree']);
    expect(argv).toEqual(expect.arrayContaining(['--no-replace-objects', '--no-pager']));
    const configs = argv.flatMap((arg, i) => (argv[i - 1] === '-c' ? [arg] : []));
    expect(configs).toEqual(
      expect.arrayContaining(['core.hooksPath=/dev/null', 'core.fsmonitor=false', 'protocol.allow=never']),
    );
    expect(argv.at(-1)).toBe('diff-tree');
  });

  it('refuses a git older than the minimum version', async () => {
    const dir = makeTempDir();
    const fakeGit = join(dir, 'git');
    writeFileSync(fakeGit, '#!/bin/sh\necho "git version 2.20.1"\n', { mode: 0o755 });
    const reader = new GitReader({ repoDir: dir, gitBinary: fakeGit });
    await expect(reader.readChangeSet('a', 'b')).rejects.toThrow(/too old/);
  });

  it('reads a file from a given commit, or null when absent', async () => {
    const r = repo();
    r.write('.agent-pr-guard.json', '{"rules":{}}\n');
    const base = r.commit('base');
    const reader = new GitReader({ repoDir: r.dir });
    expect(await reader.readFileAt(base, '.agent-pr-guard.json')).toBe('{"rules":{}}\n');
    expect(await reader.readFileAt(base, 'missing.json')).toBeNull();
  });
});

describe('plumbing parsers', () => {
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  const Z = '0'.repeat(40);

  it('parses raw diff records including renames', () => {
    const out = Buffer.from(
      `:100644 100644 ${A} ${B} M\0src/x.ts\0:100644 100644 ${A} ${A} R087\0old.ts\0new.ts\0:000000 100644 ${Z} ${B} A\0n.ts\0`,
    );
    expect(parseRawDiff(out)).toEqual([
      { status: 'M', score: null, oldMode: '100644', newMode: '100644', oldOid: A, newOid: B, oldPath: 'src/x.ts', newPath: 'src/x.ts' },
      { status: 'R', score: 87, oldMode: '100644', newMode: '100644', oldOid: A, newOid: A, oldPath: 'old.ts', newPath: 'new.ts' },
      { status: 'A', score: null, oldMode: '000000', newMode: '100644', oldOid: Z, newOid: B, oldPath: 'n.ts', newPath: 'n.ts' },
    ]);
  });

  it('throws on unmerged entries and truncated records', () => {
    expect(() => parseRawDiff(Buffer.from(`:100644 100644 ${A} ${B} U\0x\0`))).toThrow();
    expect(() => parseRawDiff(Buffer.from(`:100644 100644 ${A} ${B} R100\0only-one\0`))).toThrow();
    expect(() => parseRawDiff(Buffer.from('garbage\0'))).toThrow();
  });

  it('parses batch-check results, including missing objects', () => {
    const out = Buffer.from(`${A} blob 12\nnope missing\n`);
    expect(parseBatchCheck(out, [A, 'nope'])).toEqual([
      { found: true, oid: A, type: 'blob', size: 12 },
      { found: false, query: 'nope', reason: 'missing' },
    ]);
    expect(() => parseBatchCheck(out, [A])).toThrow();
  });

  it('parses batch output with binary content containing newlines', () => {
    const content = Buffer.from([0x0a, 0x00, 0x0a]);
    const out = Buffer.concat([Buffer.from(`${A} blob 3\n`), content, Buffer.from('\n')]);
    expect(parseBatch(out).get(A)).toEqual(content);
    expect(() => parseBatch(Buffer.from(`${A} blob 30\nshort\n`))).toThrow();
    expect(() => parseBatch(Buffer.from(`${A} missing\n`))).toThrow();
  });

  it('parses and compares git versions', () => {
    expect(parseGitVersion('git version 2.50.1 (Apple Git-155)\n')).toEqual([2, 50, 1]);
    expect(parseGitVersion('git version 2.32.0.windows.1')).toEqual([2, 32, 0]);
    expect(versionAtLeast([2, 32, 0], [2, 32, 0])).toBe(true);
    expect(versionAtLeast([2, 31, 9], [2, 32, 0])).toBe(false);
    expect(versionAtLeast([3, 0, 0], [2, 32, 0])).toBe(true);
    expect(() => parseGitVersion('not git')).toThrow();
  });

  it('detects binary content by a NUL byte', () => {
    expect(isBinary(Buffer.from('text\n'))).toBe(false);
    expect(isBinary(Buffer.from([65, 0, 66]))).toBe(true);
  });
});

function writeBlob(r: TestRepo, content: string): string {
  const dir = makeTempDir();
  const file = join(dir, 'blob');
  writeFileSync(file, content);
  return r.git('hash-object', '-w', file).trim();
}
