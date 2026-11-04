export type RawStatus = 'A' | 'C' | 'D' | 'M' | 'R' | 'T';

export interface RawChange {
  readonly status: RawStatus;
  readonly score: number | null;
  readonly oldMode: string;
  readonly newMode: string;
  readonly oldOid: string;
  readonly newOid: string;
  readonly oldPath: string;
  readonly newPath: string;
}

const HEADER = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) ([ACDMRT])(\d{0,3})$/;

/**
 * Parses `git diff-tree -r -z --raw --no-abbrev` output. Unmerged (U) or unknown (X) entries,
 * or anything that does not match the format, throw: an unparseable diff is never a pass.
 */
export function parseRawDiff(output: Buffer): RawChange[] {
  const tokens = output.toString('utf8').split('\0');
  if (tokens.at(-1) === '') tokens.pop();
  const changes: RawChange[] = [];
  let i = 0;
  while (i < tokens.length) {
    const header = tokens[i++] ?? '';
    const match = HEADER.exec(header);
    if (!match) throw new Error(`unexpected diff-tree record: ${JSON.stringify(header.slice(0, 120))}`);
    const [, oldMode = '', newMode = '', oldOid = '', newOid = '', status = '', score = ''] = match;
    const twoPaths = status === 'R' || status === 'C';
    const first = tokens[i++];
    const second = twoPaths ? tokens[i++] : first;
    if (first === undefined || second === undefined || first === '' || second === '') {
      throw new Error(`truncated diff-tree record after ${JSON.stringify(header)}`);
    }
    changes.push({
      status: status as RawStatus,
      score: score === '' ? null : Number(score),
      oldMode,
      newMode,
      oldOid,
      newOid,
      oldPath: first,
      newPath: second,
    });
  }
  return changes;
}
