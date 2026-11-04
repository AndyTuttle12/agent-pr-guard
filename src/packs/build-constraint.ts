import { basename } from '../engine/syntax.js';

/** A Go build constraint, parsed from `//go:build`, `// +build` or the file name. */
export type Constraint =
  | { readonly kind: 'true' }
  | { readonly kind: 'tag'; readonly name: string }
  | { readonly kind: 'not'; readonly x: Constraint }
  | { readonly kind: 'and' | 'or'; readonly a: Constraint; readonly b: Constraint };

const TRUE: Constraint = { kind: 'true' };

const GOOS = new Set(
  'aix android darwin dragonfly freebsd hurd illumos ios js linux nacl netbsd openbsd plan9 solaris wasip1 windows zos'.split(' '),
);
const GOARCH = new Set(
  '386 amd64 amd64p32 arm armbe arm64 arm64be loong64 mips mipsle mips64 mips64le mips64p32 mips64p32le ppc ppc64 ppc64le riscv riscv64 s390 s390x sparc sparc64 wasm'.split(
    ' ',
  ),
);

/** Past this many distinct tags the comparison falls back to comparing the text. */
const MAX_TAGS = 14;

export interface FileConstraint {
  readonly constraint: Constraint;
  /** How it reads in a finding, or null when the file has none. */
  readonly text: string | null;
  /** 1-based line of the `//go:build` (or first `// +build`) line, if there is one. */
  readonly line: number | null;
}

/**
 * The constraint `go build` applies to a file: its `//go:build` line (or, without one, its
 * `// +build` lines) in the header before the package clause, and-ed with the GOOS/GOARCH
 * suffix of its name (`x_linux_test.go`). An unparsable line yields null: the caller cannot judge it.
 */
export function fileConstraint(path: string, lines: readonly string[]): FileConstraint | null {
  let goBuild: { text: string; line: number } | null = null;
  const plus: { text: string; line: number }[] = [];
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    if (line.startsWith('package ') || line === 'package') break;
    const go = /^\/\/go:build\s+(.+)$/.exec(line);
    if (go?.[1] !== undefined && goBuild === null) goBuild = { text: go[1].trim(), line: i + 1 };
    const old = /^\/\/\s*\+build\s+(.+)$/.exec(line);
    if (old?.[1] !== undefined) plus.push({ text: old[1].trim(), line: i + 1 });
  }
  let constraint: Constraint = TRUE;
  const texts: string[] = [];
  let line: number | null = null;
  if (goBuild !== null) {
    const parsed = parseGoBuild(goBuild.text);
    if (parsed === null) return null;
    constraint = parsed;
    texts.push(goBuild.text);
    line = goBuild.line;
  } else if (plus.length > 0) {
    constraint = plus.map((p) => parsePlusBuild(p.text)).reduce((a, b) => ({ kind: 'and', a, b }));
    texts.push(plus.map((p) => `+build ${p.text}`).join('; '));
    line = plus[0]?.line ?? null;
  }
  const implied = fileNameConstraint(path);
  if (implied !== null) {
    constraint = constraint.kind === 'true' ? implied.constraint : { kind: 'and', a: constraint, b: implied.constraint };
    texts.push(`file name ${implied.text}`);
  }
  return { constraint, text: texts.length === 0 ? null : texts.join(', '), line };
}

function fileNameConstraint(path: string): { constraint: Constraint; text: string } | null {
  const stem = basename(path).replace(/(?:_test)?\.go$/, '');
  const parts = stem.split('_');
  const n = parts.length;
  const last = parts[n - 1];
  const prev = parts[n - 2];
  if (n < 2 || last === undefined) return null;
  if (n >= 3 && prev !== undefined && GOOS.has(prev) && GOARCH.has(last)) {
    return { constraint: { kind: 'and', a: tag(prev), b: tag(last) }, text: `_${prev}_${last}` };
  }
  if (GOOS.has(last) || GOARCH.has(last)) return { constraint: tag(last), text: `_${last}` };
  return null;
}

function tag(name: string): Constraint {
  return { kind: 'tag', name };
}

/** `// +build a,!b c`: space-separated options are or-ed, comma-separated terms and-ed. */
export function parsePlusBuild(text: string): Constraint {
  const options = text.split(/\s+/).filter((o) => o !== '');
  const term = (t: string): Constraint => (t.startsWith('!') ? { kind: 'not', x: tag(t.slice(1)) } : tag(t));
  const option = (o: string): Constraint =>
    o
      .split(',')
      .filter((t) => t !== '')
      .map(term)
      .reduce((a, b) => ({ kind: 'and', a, b }));
  if (options.length === 0) return TRUE;
  return options.map(option).reduce((a, b) => ({ kind: 'or', a, b }));
}

/** `//go:build` expressions: `||`, `&&`, `!`, parentheses and tags. Null when malformed. */
export function parseGoBuild(text: string): Constraint | null {
  const tokens = text.match(/\|\||&&|!|\(|\)|[\w.]+|\S/g) ?? [];
  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const or = (): Constraint | null => {
    let left = and();
    while (left !== null && peek() === '||') {
      pos++;
      const right = and();
      left = right === null ? null : { kind: 'or', a: left, b: right };
    }
    return left;
  };
  const and = (): Constraint | null => {
    let left = unary();
    while (left !== null && peek() === '&&') {
      pos++;
      const right = unary();
      left = right === null ? null : { kind: 'and', a: left, b: right };
    }
    return left;
  };
  const unary = (): Constraint | null => {
    const token = peek();
    pos++;
    if (token === '!') {
      const x = unary();
      return x === null ? null : { kind: 'not', x };
    }
    if (token === '(') {
      const inner = or();
      if (peek() !== ')') return null;
      pos++;
      return inner;
    }
    return token !== undefined && /^[\w.]+$/.test(token) ? tag(token) : null;
  };
  const result = or();
  return result !== null && pos === tokens.length ? result : null;
}

/**
 * True when `now` excludes a build that `was` included: some assignment of tags makes `was`
 * true and `now` false. Assignments with two GOOS or two GOARCH values set are impossible and
 * skipped. With too many tags to enumerate, any change of text counts.
 */
export function narrows(was: Constraint, now: Constraint, wasText: string, nowText: string): boolean {
  const names = [...new Set([...tagsOf(was), ...tagsOf(now)])];
  if (names.length > MAX_TAGS) return wasText !== nowText;
  for (let bits = 0; bits < 1 << names.length; bits++) {
    const on = new Set(names.filter((_, i) => (bits & (1 << i)) !== 0));
    if ([...on].filter((t) => GOOS.has(t)).length > 1 || [...on].filter((t) => GOARCH.has(t)).length > 1) continue;
    if (evaluate(was, on) && !evaluate(now, on)) return true;
  }
  return false;
}

function tagsOf(c: Constraint): string[] {
  switch (c.kind) {
    case 'true':
      return [];
    case 'tag':
      return [c.name];
    case 'not':
      return tagsOf(c.x);
    default:
      return [...tagsOf(c.a), ...tagsOf(c.b)];
  }
}

function evaluate(c: Constraint, on: ReadonlySet<string>): boolean {
  switch (c.kind) {
    case 'true':
      return true;
    case 'tag':
      return on.has(c.name);
    case 'not':
      return !evaluate(c.x, on);
    case 'and':
      return evaluate(c.a, on) && evaluate(c.b, on);
    case 'or':
      return evaluate(c.a, on) || evaluate(c.b, on);
  }
}
