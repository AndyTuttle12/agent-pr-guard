import { CODEOWNERS_PATHS } from '../changeset.js';
import type { AnalyzedFile } from '../engine/analyze.js';
import { GUARD_CONFIG_PATH } from '../engine/config.js';
import type { RulePack } from '../engine/engine.js';
import type { RuleHit } from '../engine/finding.js';
import { GlobSet } from '../engine/glob.js';

/** Every path the config loader reads the guard's config from. */
export const GUARD_CONFIG_PATHS: readonly string[] = [GUARD_CONFIG_PATH];

/**
 * Always protected: the CODEOWNERS locations forges read (`CODEOWNERS_PATHS`). Anchored, so a
 * `CODEOWNERS` file deeper in the tree is not one a forge enforces and is not protected.
 */
export const BUILT_IN_PROTECTED_PATHS: readonly string[] = CODEOWNERS_PATHS.map((path) => `/${path}`);

const BUILT_IN = new GlobSet(BUILT_IN_PROTECTED_PATHS);

/**
 * Files the PR must not touch, judged on paths alone and on both sides of the change, so an
 * edit, a deletion, a rename in or out, an addition and a mode or type change all count. The
 * protected globs come from the base side's config (D5), and the pack sees `ignorePaths` files,
 * so neither the PR nor an ignore glob can lift a protection. A protected path the PR creates is
 * capped at warning (D18): adding a golden file or a first CODEOWNERS weakens nothing.
 */
export const protectedPack: RulePack = {
  id: 'protected',
  seesIgnoredFiles: true,
  rules: [
    {
      id: 'protected/path',
      summary: 'A file under a protected path (`protectedPaths` or a built-in CODEOWNERS location) was changed.',
    },
    { id: 'protected/guard-config', summary: "The guard's own config file was changed.", locked: true },
  ],
  check({ files, config, baseCodeowners }) {
    const configured = new GlobSet(config.protectedPaths);
    const hits: RuleHit[] = [];
    for (const file of files) {
      const paths = sidePaths(file);
      const what = describeChange(file);
      const guardConfig = paths.find((p) => GUARD_CONFIG_PATHS.includes(p));
      if (guardConfig !== undefined) {
        hits.push({ ruleId: 'protected/guard-config', file: file.path, line: null, reason: `guard config ${guardConfig} ${what}` });
        continue;
      }
      for (const path of paths) {
        const why = protectionOf(path, configured);
        if (why === null) continue;
        const hit: RuleHit = { ruleId: 'protected/path', file: file.path, line: null, reason: `protected path ${path} (${why}) ${what}` };
        const creates = createsProtectedPath(file, path, configured) && (why !== 'CODEOWNERS' || baseCodeowners.length === 0);
        hits.push(creates ? { ...hit, severity: 'warning' } : hit);
        break;
      }
    }
    return hits;
  },
};

/** Why a path is protected, for the message, or null when it is not. */
function protectionOf(path: string, configured: GlobSet): string | null {
  if (BUILT_IN.matches(path)) return 'CODEOWNERS';
  const glob = configured.firstMatch(path);
  return glob === null ? null : `protectedPaths "${glob}"`;
}

/**
 * True when the PR brings `path` into being rather than changing what the base had there: it is
 * the file's head path, the base had no file at it, and the file did not come from a protected
 * path (an addition, or a rename from an unprotected path, which git may as well report as a
 * deletion and an addition). An edit, a deletion, a rename away and a mode or type change are
 * never creations.
 */
function createsProtectedPath(file: AnalyzedFile, path: string, configured: GlobSet): boolean {
  const { status } = file.change;
  if (status !== 'added' && status !== 'renamed') return false;
  if (path !== file.newPath || path === file.oldPath) return false;
  return file.oldPath === null || protectionOf(file.oldPath, configured) === null;
}

function sidePaths(file: AnalyzedFile): string[] {
  return [...new Set([file.oldPath, file.newPath].filter((p): p is string => p !== null))];
}

function describeChange(file: AnalyzedFile): string {
  const { status, old, new: neu } = file.change;
  if (status === 'added') return 'was added';
  if (status === 'deleted') return 'was deleted';
  if (status === 'renamed') return `was renamed from ${file.oldPath ?? '?'} to ${file.newPath ?? '?'}`;
  if (status === 'type-changed') return 'changed type';
  if (old !== null && neu !== null && old.mode !== neu.mode) {
    return old.oid === neu.oid ? `changed mode ${old.mode} to ${neu.mode}` : `was modified and changed mode ${old.mode} to ${neu.mode}`;
  }
  return 'was modified';
}
