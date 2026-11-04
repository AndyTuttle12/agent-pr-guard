/**
 * Glob matching for repo-relative paths (`/`-separated, no leading `./`).
 *
 * - `*` matches within one path segment, `?` one character, `[abc]` / `[!abc]` a class.
 * - `**` as a whole segment matches any number of segments, including none.
 * - `{a,b}` is an alternation and may hold globs.
 * - A pattern with no `/` matches the file name at any depth (`*.snap`); a pattern with a `/`
 *   is anchored at the repo root (`/` at the start is optional). A trailing `/` matches
 *   everything below that directory.
 * - Matching is case-sensitive, and `*` also matches names starting with a dot.
 */
export function globToRegExp(pattern: string): RegExp {
  let p = pattern.trim();
  if (p === '') throw new Error('empty glob');
  if (p.startsWith('./')) p = p.slice(2);
  const anchored = p.startsWith('/');
  if (anchored) p = p.slice(1);
  if (p.endsWith('/')) p = `${p}**`;
  if (!anchored && !p.includes('/')) p = `**/${p}`;
  return new RegExp(`^${translate(p)}$`);
}

function translate(p: string): string {
  let out = '';
  let i = 0;
  while (i < p.length) {
    const ch = p[i] ?? '';
    if (ch === '*') {
      if (p[i + 1] === '*') {
        const segmentStart = i === 0 || p[i - 1] === '/';
        const afterStars = p[i + 2];
        if (segmentStart && afterStars === '/') {
          out += '(?:[^/]*/)*';
          i += 3;
          continue;
        }
        if (segmentStart && afterStars === undefined) {
          out += '.*';
          i += 2;
          continue;
        }
        out += '[^/]*';
        i += 2;
        continue;
      }
      out += '[^/]*';
      i++;
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      i++;
      continue;
    }
    if (ch === '[') {
      const close = p.indexOf(']', i + 2);
      if (close === -1) {
        out += '\\[';
        i++;
        continue;
      }
      let body = p.slice(i + 1, close);
      const negated = body.startsWith('!') || body.startsWith('^');
      if (negated) body = body.slice(1);
      const escaped = body.replace(/[\\\]^]/g, '\\$&');
      out += negated ? `[^/${escaped}]` : `[${escaped}]`;
      i = close + 1;
      continue;
    }
    if (ch === '{') {
      const close = matchingBrace(p, i);
      if (close === -1) {
        out += '\\{';
        i++;
        continue;
      }
      const alternatives = splitTopLevel(p.slice(i + 1, close));
      out += `(?:${alternatives.map(translate).join('|')})`;
      i = close + 1;
      continue;
    }
    if (ch === '\\' && i + 1 < p.length) {
      out += escapeRegExp(p[i + 1] ?? '');
      i += 2;
      continue;
    }
    out += escapeRegExp(ch);
    i++;
  }
  return out;
}

function matchingBrace(p: string, open: number): number {
  let depth = 0;
  for (let i = open; i < p.length; i++) {
    const ch = p[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

/** A compiled set of globs; a path matches when any of them does. */
export class GlobSet {
  private readonly regexes: readonly RegExp[];

  constructor(readonly patterns: readonly string[]) {
    this.regexes = patterns.map(globToRegExp);
  }

  matches(path: string): boolean {
    return this.regexes.some((re) => re.test(path));
  }

  /** The first pattern that matches, for messages. */
  firstMatch(path: string): string | null {
    const index = this.regexes.findIndex((re) => re.test(path));
    return index === -1 ? null : (this.patterns[index] ?? null);
  }
}
