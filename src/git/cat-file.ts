export type ObjectType = 'blob' | 'tree' | 'commit' | 'tag';

export type BatchCheckEntry =
  | { readonly found: true; readonly oid: string; readonly type: ObjectType; readonly size: number }
  | { readonly found: false; readonly query: string; readonly reason: string };

const CHECK_LINE = /^([0-9a-f]{40}|[0-9a-f]{64}) (blob|tree|commit|tag) (\d+)$/;
const MISSING_LINE = /^(.*) (missing|ambiguous)$/;

/** Parses `git cat-file --batch-check` output: one line per query, in query order. */
export function parseBatchCheck(output: Buffer, queries: readonly string[]): BatchCheckEntry[] {
  const lines = output.toString('utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length !== queries.length) {
    throw new Error(`cat-file --batch-check returned ${lines.length} lines for ${queries.length} queries`);
  }
  return lines.map((line, index) => {
    const found = CHECK_LINE.exec(line);
    if (found) {
      const [, oid = '', type = '', size = ''] = found;
      return { found: true, oid, type: type as ObjectType, size: Number(size) };
    }
    const missing = MISSING_LINE.exec(line);
    if (missing) return { found: false, query: queries[index] ?? '', reason: missing[2] ?? 'missing' };
    throw new Error(`unexpected cat-file --batch-check line: ${JSON.stringify(line.slice(0, 120))}`);
  });
}

/** Parses `git cat-file --batch` output into oid -> content. Any missing object throws. */
export function parseBatch(output: Buffer): Map<string, Buffer> {
  const objects = new Map<string, Buffer>();
  let pos = 0;
  while (pos < output.length) {
    const eol = output.indexOf(0x0a, pos);
    if (eol === -1) throw new Error('truncated cat-file --batch header');
    const header = output.subarray(pos, eol).toString('utf8');
    const match = CHECK_LINE.exec(header);
    if (!match) throw new Error(`cat-file --batch could not read object: ${JSON.stringify(header.slice(0, 120))}`);
    const oid = match[1] ?? '';
    const size = Number(match[3]);
    const start = eol + 1;
    const end = start + size;
    if (end + 1 > output.length || output[end] !== 0x0a) throw new Error(`truncated cat-file --batch object ${oid}`);
    objects.set(oid, output.subarray(start, end));
    pos = end + 1;
  }
  return objects;
}
