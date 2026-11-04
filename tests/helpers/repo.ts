import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const GIT_ENV: Record<string, string> = {
  PATH: process.env['PATH'] ?? '/usr/bin:/bin',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  LC_ALL: 'C',
};

export interface TestRepo {
  readonly dir: string;
  git(...args: string[]): string;
  write(path: string, content: string | Buffer, mode?: number): void;
  remove(path: string): void;
  commit(message: string): string;
}

const created: string[] = [];

export function makeTempDir(prefix = 'apg-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/** Removes every temp dir this module created. Call from afterEach. */
export function cleanupTempDirs(): void {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
}

/** A throwaway repository in a fresh temp dir, driven by git with no user or system config. */
export function makeRepo(): TestRepo {
  const dir = makeTempDir('apg-repo-');
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main', '.');
  return {
    dir,
    git,
    write(path, content, mode) {
      const full = join(dir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
      if (mode !== undefined) chmodSync(full, mode);
    },
    remove(path) {
      git('rm', '-q', '--', path);
    },
    commit(message) {
      git('add', '-A');
      git('commit', '-q', '--allow-empty', '--no-verify', '-m', message);
      return git('rev-parse', 'HEAD').trim();
    },
  };
}
