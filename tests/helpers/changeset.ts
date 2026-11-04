import { createHash } from 'node:crypto';
import type { ChangeSet, ChangeStatus, FileChange, FileSide } from '../../src/changeset.js';

export function side(path: string, text: string | null, skipped?: FileSide['skipped']): FileSide {
  const oid = createHash('sha1').update(`${path}\0${text ?? ''}`).digest('hex');
  const base = { path, mode: '100644', oid, text };
  return skipped === undefined ? base : { ...base, skipped };
}

/** One file change; pass null for an absent side. Status is inferred from the paths. */
export function change(old: FileSide | null, neu: FileSide | null): FileChange {
  let status: ChangeStatus;
  if (old === null && neu === null) throw new Error('a change needs at least one side');
  if (old === null) status = 'added';
  else if (neu === null) status = 'deleted';
  else status = old.path === neu.path ? 'modified' : 'renamed';
  const path = neu?.path ?? old?.path ?? '';
  return { status, path, old, new: neu };
}

export function modified(path: string, oldText: string, newText: string): FileChange {
  return change(side(path, oldText), side(path, newText));
}

/** A change set; `baseCodeowners` lists the CODEOWNERS locations the base has (none by default). */
export function changeSet(files: readonly FileChange[], baseCodeowners: readonly string[] = []): ChangeSet {
  return { base: 'b'.repeat(40), head: 'h'.repeat(40), mergeBase: 'm'.repeat(40), files, baseCodeowners };
}
