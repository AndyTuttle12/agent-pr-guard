// Dependency-free lint for the two conventions the type checker does not enforce in src/:
// no `any` (as `: any` or `as any`) and no default exports. Run with `npm run lint`.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface LintFinding {
  readonly file: string;
  readonly line: number;
  readonly rule: 'no-any' | 'no-default-export';
  readonly text: string;
}

const RULES: ReadonlyArray<{ readonly rule: LintFinding['rule']; readonly pattern: RegExp }> = [
  { rule: 'no-any', pattern: /:\s*any\b|\bas\s+any\b/ },
  { rule: 'no-default-export', pattern: /\bexport\s+default\b/ },
];

// A `/` after one of these starts a regex literal, not a division.
const REGEX_PREFIX = /[(,=:[!&|?{};+\-*%<>~^]$|(?:^|[^\w$.])(?:return|typeof|case|in|of)$/;

/**
 * The source with comments and the contents of string, template and regex literals replaced by
 * spaces. Line breaks and columns are kept, so a hit maps back to its line. A heuristic lexer: it
 * never throws, and the worst case is a missed or extra hit that the test fixtures pin.
 */
export function blankNonCode(source: string): string {
  const out = source.split('');
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  const templateDepths: number[] = []; // open `${` braces per enclosing template
  let braces = 0;
  let i = 0;
  const readString = (quote: string): void => {
    const start = i + 1;
    i++;
    while (i < source.length && source[i] !== quote && source[i] !== '\n') i += source[i] === '\\' ? 2 : 1;
    blank(start, Math.min(i, source.length));
    i++;
  };
  const readTemplateText = (): void => {
    const start = i;
    while (i < source.length && source[i] !== '`' && !(source[i] === '$' && source[i + 1] === '{')) i += source[i] === '\\' ? 2 : 1;
    blank(start, Math.min(i, source.length));
    if (source[i] === '`') i++;
    else if (i < source.length) {
      i += 2;
      templateDepths.push(braces);
      braces++;
    }
  };
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const to = end === -1 ? source.length : end;
      blank(i, to);
      i = to;
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const to = end === -1 ? source.length : end + 2;
      blank(i, to);
      i = to;
    } else if (ch === '"' || ch === "'") {
      readString(ch);
    } else if (ch === '`') {
      i++;
      readTemplateText();
    } else if (ch === '{') {
      braces++;
      i++;
    } else if (ch === '}') {
      braces--;
      i++;
      if (templateDepths.length > 0 && templateDepths[templateDepths.length - 1] === braces) {
        templateDepths.pop();
        readTemplateText();
      }
    } else if (ch === '/' && REGEX_PREFIX.test(source.slice(0, i).trimEnd().slice(-12))) {
      const start = ++i;
      let inClass = false;
      while (i < source.length && source[i] !== '\n' && (inClass || source[i] !== '/')) {
        if (source[i] === '[') inClass = true;
        else if (source[i] === ']') inClass = false;
        i += source[i] === '\\' ? 2 : 1;
      }
      blank(start, Math.min(i, source.length));
      i++;
    } else {
      i++;
    }
  }
  return out.join('');
}

export function lintSource(file: string, source: string): LintFinding[] {
  const code = blankNonCode(source).split('\n');
  const original = source.split('\n');
  const findings: LintFinding[] = [];
  code.forEach((text, index) => {
    for (const { rule, pattern } of RULES) {
      if (pattern.test(text)) findings.push({ file, line: index + 1, rule, text: (original[index] ?? '').trim() });
    }
  });
  return findings;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** Lints every .ts file under `<root>/src`, sorted by path. */
export function lintTree(root: string): LintFinding[] {
  return sourceFiles(join(root, 'src'))
    .sort()
    .flatMap((path) => lintSource(relative(root, path), readFileSync(path, 'utf8')));
}

export function main(): number {
  const findings = lintTree(ROOT);
  for (const f of findings) process.stderr.write(`${f.file}:${f.line}  ${f.rule}  ${f.text}\n`);
  process.stdout.write(findings.length === 0 ? 'lint: ok\n' : `lint: ${findings.length} problem${findings.length === 1 ? '' : 's'}\n`);
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
