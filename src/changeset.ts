/**
 * Where forges read CODEOWNERS from: the root and `docs/` (GitHub, GitLab, Gitea and Forgejo),
 * plus each forge's own directory (`.github/`, `.gitlab/`, `.gitea/`).
 */
export const CODEOWNERS_PATHS: readonly string[] = ['CODEOWNERS', 'docs/CODEOWNERS', '.github/CODEOWNERS', '.gitlab/CODEOWNERS', '.gitea/CODEOWNERS'];

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'type-changed';

export type SkipReason = 'binary' | 'too-large' | 'submodule';

export interface FileSide {
  readonly path: string;
  readonly mode: string;
  readonly oid: string;
  /** Decoded UTF-8 text, or null when the content was not inspected (see `skipped`). */
  readonly text: string | null;
  readonly skipped?: SkipReason;
}

export interface FileChange {
  readonly status: ChangeStatus;
  /** The path the change is reported under: the new path, or the old one for a deletion. */
  readonly path: string;
  readonly old: FileSide | null;
  readonly new: FileSide | null;
  /** Rename similarity index (0-100), present for renames. */
  readonly similarity?: number;
}

export interface ChangeSet {
  readonly base: string;
  readonly head: string;
  /** The commit the diff is taken from: merge-base(base, head). */
  readonly mergeBase: string;
  readonly files: readonly FileChange[];
  /**
   * The `CODEOWNERS_PATHS` that exist at the merge base, changed or not: a CODEOWNERS file the
   * PR adds can take precedence over one the base already had.
   */
  readonly baseCodeowners: readonly string[];
}
