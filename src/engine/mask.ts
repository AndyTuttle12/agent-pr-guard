import type { Syntax } from './syntax.js';

/**
 * Three views of one source file. Each has exactly the input's length and line layout: masked
 * characters become spaces, line breaks stay, so a column in a view is the same column in the
 * file. A lexer this small is a heuristic (see docs/decisions.md D6); it never throws.
 */
export interface Masked {
  /** Comments blanked and string, template and regex contents blanked (delimiters kept). */
  readonly code: string;
  /** Comments blanked; strings kept. For config files, whose values are strings. */
  readonly codeWithStrings: string;
  /** Only comments kept, markers included; everything else blanked. */
  readonly comments: string;
}

const CODE = 0;
const STRING = 1;
const COMMENT = 2;

type Classes = Uint8Array;

export function mask(text: string, syntax: Syntax): Masked {
  const cls = new Uint8Array(text.length);
  switch (syntax) {
    case 'js':
      scanCFamily(text, cls, { templates: true, regex: true, rawBacktick: false });
      break;
    case 'go':
      scanCFamily(text, cls, { templates: false, regex: false, rawBacktick: true });
      break;
    case 'json':
      scanCFamily(text, cls, { templates: false, regex: false, rawBacktick: false });
      break;
    case 'python':
      scanPython(text, cls);
      break;
    case 'hash':
      scanHash(text, cls);
      break;
    case 'plain':
      break;
  }
  return {
    code: render(text, cls, (c) => c === CODE),
    codeWithStrings: render(text, cls, (c) => c !== COMMENT),
    comments: render(text, cls, (c) => c === COMMENT),
  };
}

function render(text: string, cls: Classes, keep: (c: number) => boolean): string {
  let out = '';
  let runStart = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 0x0a || ch === 0x0d || keep(cls[i] ?? CODE)) continue;
    out += text.slice(runStart, i) + ' ';
    runStart = i + 1;
  }
  return out + text.slice(runStart);
}

function fill(cls: Classes, from: number, to: number, value: number): void {
  cls.fill(value, from, Math.min(to, cls.length));
}

const REGEX_PRECEDERS = new Set('(,=:[!&|?{};+-*%<>~^}'.split(''));
const REGEX_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

interface CFamilyOptions {
  readonly templates: boolean;
  readonly regex: boolean;
  readonly rawBacktick: boolean;
}

/** JS/TS, Go and JSON-with-comments. Template literal nesting is tracked with a brace stack. */
function scanCFamily(text: string, cls: Classes, opts: CFamilyOptions): void {
  const n = text.length;
  const templateBraces: number[] = [];
  let i = 0;
  let lastSignificant = '';
  let lastWord = '';

  const scanTemplateBody = (from: number): number => {
    // `from` is just after an opening backtick or a closing `}` of `${...}`.
    let j = from;
    while (j < n) {
      const ch = text[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === '`') {
        fill(cls, from, j, STRING);
        return j + 1;
      }
      if (ch === '$' && text[j + 1] === '{') {
        fill(cls, from, j, STRING);
        templateBraces.push(0);
        return j + 2;
      }
      j++;
    }
    fill(cls, from, n, STRING);
    return n;
  };

  while (i < n) {
    const ch = text[i] ?? '';
    const next = text[i + 1] ?? '';
    if (ch === '/' && next === '/') {
      const end = lineEnd(text, i);
      fill(cls, i, end, COMMENT);
      i = end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      fill(cls, i, end, COMMENT);
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = scanQuoted(text, cls, i, ch, true);
      lastSignificant = ch;
      lastWord = '';
      continue;
    }
    if (ch === '`') {
      if (opts.templates) {
        i = scanTemplateBody(i + 1);
      } else if (opts.rawBacktick) {
        const close = text.indexOf('`', i + 1);
        const end = close === -1 ? n : close;
        fill(cls, i + 1, end, STRING);
        i = end + 1;
      } else {
        i++;
      }
      lastSignificant = '`';
      lastWord = '';
      continue;
    }
    if (opts.templates && templateBraces.length > 0 && (ch === '{' || ch === '}')) {
      const top = templateBraces.length - 1;
      if (ch === '{') {
        templateBraces[top] = (templateBraces[top] ?? 0) + 1;
      } else if ((templateBraces[top] ?? 0) === 0) {
        templateBraces.pop();
        i = scanTemplateBody(i + 1);
        lastSignificant = '`';
        lastWord = '';
        continue;
      } else {
        templateBraces[top] = (templateBraces[top] ?? 0) - 1;
      }
    }
    if (opts.regex && ch === '/' && regexAllowed(lastSignificant, lastWord)) {
      const end = regexEnd(text, i);
      if (end !== -1) {
        fill(cls, i + 1, end - 1, STRING);
        i = end;
        lastSignificant = '/';
        lastWord = '';
        continue;
      }
    }
    if (/[A-Za-z0-9_$]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(text[j] ?? '')) j++;
      lastWord = text.slice(i, j);
      lastSignificant = 'a';
      i = j;
      continue;
    }
    if (!/\s/.test(ch)) {
      lastSignificant = ch;
      lastWord = '';
    }
    i++;
  }
}

function regexAllowed(lastSignificant: string, lastWord: string): boolean {
  if (lastSignificant === '') return true;
  if (lastSignificant === 'a') return REGEX_KEYWORDS.has(lastWord);
  return REGEX_PRECEDERS.has(lastSignificant);
}

/** Index just past a regex literal's flags, or -1 when this `/` does not start one on this line. */
function regexEnd(text: string, start: number): number {
  let inClass = false;
  for (let j = start + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === '\n' || ch === '\r') return -1;
    if (ch === '\\') {
      j++;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === '/') {
      if (j === start + 1) return -1;
      let end = j + 1;
      while (end < text.length && /[a-z]/i.test(text[end] ?? '')) end++;
      return end;
    }
  }
  return -1;
}

/**
 * A one-line quoted string starting at `start`. Contents are classed STRING; an unterminated
 * string ends at the line break. Returns the index after the closing quote.
 */
function scanQuoted(text: string, cls: Classes, start: number, quote: string, escapes: boolean): number {
  let j = start + 1;
  while (j < text.length) {
    const ch = text[j];
    if (escapes && ch === '\\') {
      // Also covers a backslash-newline continuation, which keeps the string open.
      j += 2;
      continue;
    }
    if (ch === quote) {
      fill(cls, start + 1, j, STRING);
      return j + 1;
    }
    if (ch === '\n') break;
    j++;
  }
  const end = Math.min(j, text.length);
  fill(cls, start + 1, end, STRING);
  return end;
}

function lineEnd(text: string, from: number): number {
  const nl = text.indexOf('\n', from);
  return nl === -1 ? text.length : nl;
}

/** Python: `#` comments, string prefixes (r, b, f, u and pairs), triple-quoted strings. */
function scanPython(text: string, cls: Classes): void {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i] ?? '';
    if (ch === '#') {
      const end = lineEnd(text, i);
      fill(cls, i, end, COMMENT);
      i = end;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(text[j] ?? '')) j++;
      const word = text.slice(i, j);
      const quote = text[j];
      if ((quote === '"' || quote === "'") && /^[rRbBuUfF]{1,2}$/.test(word)) {
        i = scanPythonString(text, cls, j);
      } else {
        i = j;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      i = scanPythonString(text, cls, i);
      continue;
    }
    i++;
  }
}

function scanPythonString(text: string, cls: Classes, start: number): number {
  const quote = text[start] ?? '"';
  const triple = text.startsWith(quote.repeat(3), start);
  if (!triple) return scanQuoted(text, cls, start, quote, true);
  const delimiter = quote.repeat(3);
  let j = start + 3;
  while (j < text.length) {
    if (text[j] === '\\') {
      j += 2;
      continue;
    }
    if (text.startsWith(delimiter, j)) {
      fill(cls, start + 3, j, STRING);
      return j + 3;
    }
    j++;
  }
  fill(cls, start + 3, text.length, STRING);
  return text.length;
}

/**
 * YAML, TOML, INI, shell, Makefiles. `#` opens a comment at a line start or after whitespace;
 * `;` opens one at a line start (INI). A quote opens a one-line string only where a value can
 * start, so the apostrophe in `echo don't` stays code.
 */
function scanHash(text: string, cls: Classes): void {
  const n = text.length;
  let i = 0;
  let lineStart = true;
  while (i < n) {
    const ch = text[i] ?? '';
    if (ch === '\n') {
      lineStart = true;
      i++;
      continue;
    }
    const prev = i === 0 ? '\n' : (text[i - 1] ?? '');
    if (ch === '#' && /\s/.test(prev)) {
      const end = lineEnd(text, i);
      fill(cls, i, end, COMMENT);
      i = end;
      continue;
    }
    if (ch === ';' && lineStart) {
      const end = lineEnd(text, i);
      fill(cls, i, end, COMMENT);
      i = end;
      continue;
    }
    if ((ch === '"' || ch === "'") && /[\s:=[,({]/.test(prev)) {
      i = scanQuoted(text, cls, i, ch, ch === '"');
      lineStart = false;
      continue;
    }
    if (!/\s/.test(ch)) lineStart = false;
    i++;
  }
}
