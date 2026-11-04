import type { ConfigFormat } from './config-files.js';

/**
 * One key/value pair read from a config file. `key` is the dotted path from the root; a list item
 * adds `[]` to its list's key (`rules.max-len[]`, `jobs.test.steps[].run`). `value` is the scalar
 * text with quotes removed, or null for a key that holds a table, a list or nothing.
 */
export interface ConfigEntry {
  readonly key: string;
  readonly value: string | null;
  /** 1-based line of the key, or of the list item. */
  readonly line: number;
}

/**
 * Reads the entries of a config file from its comment-masked lines (the `codeWithStrings` view,
 * so a commented-out setting is gone). Format-agnostic and forgiving by design (D6): it never
 * throws, and what it cannot follow it skips.
 * - `json`, `js`: JSON, JSONC, JSON5 and JavaScript or TypeScript object literals, wherever they
 *   sit in the module (`export default defineConfig({ ... })`);
 * - `yaml`: block mappings and sequences, flow collections, block scalars (one entry per line);
 * - `toml`: tables, arrays of tables, dotted keys, inline arrays and tables, multi-line strings;
 * - `ini`: sections, `key = value` or `key: value`, indented continuation lines;
 * - `make`: one entry per recipe line, keyed by its target; `shell`: one `run` entry per line;
 * - `lines`: one `[]` entry per line (ignore files).
 */
export function readEntries(lines: readonly string[], format: ConfigFormat): ConfigEntry[] {
  switch (format) {
    case 'json':
    case 'js':
      return readLiteral(lines.join('\n'), 1, null, ':');
    case 'yaml':
      return readYaml(lines);
    case 'toml':
      return readToml(lines);
    case 'ini':
      return readIni(lines);
    case 'make':
      return readMake(lines);
    case 'shell':
      return eachLine(lines, 'run', /^#/);
    case 'lines':
      return eachLine(lines, '[]', /^#/);
  }
}

export function joinKey(path: string, key: string): string {
  if (key === '[]') return `${path}[]`;
  return path === '' ? key : `${path}.${key}`;
}

/** The last key segment without its `[]` suffixes: `rules.max-len[]` → `max-len`. */
export function lastSegment(key: string): string {
  const bare = key.replace(/(?:\[\])+$/, '');
  const dot = bare.lastIndexOf('.');
  return dot === -1 ? bare : bare.slice(dot + 1);
}

export function unquote(text: string): string {
  const t = text.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'" || t[0] === '`') && t.at(-1) === t[0]) return t.slice(1, -1);
  return t;
}

function eachLine(lines: readonly string[], key: string, skip: RegExp): ConfigEntry[] {
  const out: ConfigEntry[] = [];
  lines.forEach((text, i) => {
    const t = text.trim();
    if (t !== '' && !skip.test(t)) out.push({ key, value: t, line: i + 1 });
  });
  return out;
}

// ---- JSON, JS object literals, and YAML/TOML inline collections ----

interface Token {
  readonly kind: 'word' | 'string' | 'punct';
  readonly text: string;
  readonly line: number;
}

function tokenize(text: string, firstLine: number, assign: ':' | '='): Token[] {
  const punct = `{}[](),;${assign}`;
  const tokens: Token[] = [];
  let line = firstLine;
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';
    if (ch === '\n') {
      line++;
      i++;
    } else if (/\s/.test(ch)) {
      i++;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const start = i;
      const startLine = line;
      i++;
      while (i < text.length && text[i] !== ch && (ch === '`' || text[i] !== '\n')) {
        if (text[i] === '\\') i++;
        else if (text[i] === '\n') line++;
        i++;
      }
      i = Math.min(i + 1, text.length);
      tokens.push({ kind: 'string', text: text.slice(start, i), line: startLine });
    } else if (punct.includes(ch)) {
      tokens.push({ kind: 'punct', text: ch, line });
      i++;
    } else {
      const start = i;
      while (i < text.length && !/[\s"'`]/.test(text[i] ?? '') && !punct.includes(text[i] ?? '')) i++;
      tokens.push({ kind: 'word', text: text.slice(start, i), line });
    }
  }
  return tokens;
}

interface Frame {
  readonly kind: 'object' | 'array' | 'value';
  /** For a value frame, where its scalar goes; null at a module's top level. */
  readonly path: string | null;
  /** A value frame inside parentheses hands its text to the frame around it. */
  readonly paren: boolean;
  pendingKey: Token | null;
  buf: Token[];
}

/**
 * Reads object literals out of `text`. With a `basePath`, the text is one value (a YAML or TOML
 * inline collection) and its entries sit under that path; without one, every top-level object in
 * the module is read from the root.
 */
export function readLiteral(text: string, firstLine: number, basePath: string | null, assign: ':' | '='): ConfigEntry[] {
  const out: ConfigEntry[] = [];
  const root: Frame = { kind: 'value', path: basePath, paren: false, pendingKey: null, buf: [] };
  const stack: Frame[] = [root];
  const top = (): Frame => stack[stack.length - 1] ?? root;
  const valueText = (buf: readonly Token[]): string =>
    buf.length === 1 && buf[0]?.kind === 'string'
      ? unquote(buf[0].text)
      : buf.map((t, i) => (i > 0 && !t.text.startsWith('(') ? ` ${t.text}` : t.text)).join('');

  const childPath = (frame: Frame): string | null => {
    if (frame.kind === 'object') return frame.pendingKey === null ? frame.path : joinKey(frame.path ?? '', unquote(frame.pendingKey.text));
    if (frame.kind === 'array') return joinKey(frame.path ?? '', '[]');
    return frame.path;
  };

  const flush = (frame: Frame): void => {
    const first = frame.buf[0];
    if (frame.kind === 'object' && frame.pendingKey !== null && first !== undefined) {
      out.push({ key: joinKey(frame.path ?? '', unquote(frame.pendingKey.text)), value: valueText(frame.buf), line: frame.pendingKey.line });
    } else if (frame.kind === 'array' && first !== undefined) {
      out.push({ key: joinKey(frame.path ?? '', '[]'), value: valueText(frame.buf), line: first.line });
    } else if (frame.kind === 'value' && !frame.paren && frame.path !== null && first !== undefined) {
      out.push({ key: frame.path, value: valueText(frame.buf), line: first.line });
    }
    frame.pendingKey = null;
    frame.buf = [];
  };

  const close = (until: (f: Frame) => boolean): void => {
    while (stack.length > 1) {
      const frame = top();
      flush(frame);
      stack.pop();
      if (until(frame)) return;
    }
  };

  for (const token of tokenize(text, firstLine, assign)) {
    const frame = top();
    if (token.kind !== 'punct') {
      frame.buf.push(token);
      continue;
    }
    switch (token.text) {
      case '{':
      case '[': {
        const path = childPath(frame) ?? '';
        const keyLine = frame.pendingKey?.line ?? token.line;
        const named = frame.kind === 'object' ? frame.pendingKey !== null : frame.kind === 'array' || (frame.path !== null && !frame.paren);
        if (named) out.push({ key: path, value: null, line: keyLine });
        frame.pendingKey = null;
        frame.buf = [];
        stack.push({ kind: token.text === '{' ? 'object' : 'array', path, paren: false, pendingKey: null, buf: [] });
        break;
      }
      case '}':
        close((f) => f.kind === 'object');
        break;
      case ']':
        close((f) => f.kind === 'array');
        break;
      case '(':
        stack.push({ kind: 'value', path: childPath(frame), paren: true, pendingKey: null, buf: [] });
        break;
      case ')': {
        if (!frame.paren) break;
        stack.pop();
        const inner = frame.buf.map((t) => t.text).join(' ');
        top().buf.push({ kind: 'word', text: `(${inner})`, line: token.line });
        break;
      }
      case ',':
      case ';':
        if (frame.paren) frame.buf.push(token);
        else flush(frame);
        break;
      default: {
        // The assignment mark: `key:` in JSON and JS, `key =` in TOML.
        const only = frame.buf.length === 1 ? frame.buf[0] : undefined;
        if (frame.kind === 'object' && frame.pendingKey === null && only !== undefined) {
          frame.pendingKey = only;
          frame.buf = [];
        } else {
          frame.buf.push(token);
        }
      }
    }
  }
  close(() => false);
  flush(root);
  return out;
}

// ---- YAML ----

interface YamlFrame {
  readonly indent: number;
  readonly path: string;
  readonly item: boolean;
}

const YAML_KEY = /^((?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s"'#{[][^:"']*?))\s*:(?:\s+(.*))?$/;

function readYaml(lines: readonly string[]): ConfigEntry[] {
  const out: ConfigEntry[] = [];
  let stack: YamlFrame[] = [];
  let block: { path: string; indent: number } | null = null;
  const parentPath = (): string => stack[stack.length - 1]?.path ?? '';

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const trimmed = raw.trim();
    const indent = raw.length - raw.trimStart().length;
    if (block !== null) {
      if (trimmed === '') continue;
      if (indent > block.indent) {
        out.push({ key: block.path, value: trimmed, line: i + 1 });
        continue;
      }
      block = null;
    }
    if (trimmed === '') continue;
    if (/^(?:---|\.\.\.)(?:\s|$)/.test(raw)) {
      stack = [];
      continue;
    }

    let rest = trimmed;
    let at = indent;
    while (/^-(?:\s|$)/.test(rest)) {
      // A sequence may sit at its parent key's indent, so only items close at the same indent.
      for (let f = stack.at(-1); f !== undefined && (f.indent > at || (f.indent === at && f.item)); f = stack.at(-1)) stack.pop();
      const path = joinKey(parentPath(), '[]');
      stack.push({ indent: at, path, item: true });
      const after = rest.slice(1);
      const pad = after.length - after.trimStart().length;
      at += 1 + pad;
      rest = after.trimStart();
      if (rest === '') out.push({ key: path, value: null, line: i + 1 });
    }
    if (rest === '') continue;

    const m = YAML_KEY.exec(rest);
    if (m === null) {
      const item = stack[stack.length - 1];
      if (item !== undefined && item.item && at > item.indent) i = yamlValue(item.path, rest, i, lines, out);
      continue;
    }
    for (let f = stack.at(-1); f !== undefined && f.indent >= at; f = stack.at(-1)) stack.pop();
    const path = joinKey(parentPath(), unquote(m[1] ?? ''));
    const value = (m[2] ?? '').replace(/^(?:&\S+|!\S+)\s*/, '');
    if (value === '') {
      out.push({ key: path, value: null, line: i + 1 });
      stack.push({ indent: at, path, item: false });
    } else if (/^[|>][-+0-9]*$/.test(value)) {
      out.push({ key: path, value: null, line: i + 1 });
      block = { path, indent: at };
    } else {
      i = yamlValue(path, value, i, lines, out);
    }
  }
  return out;
}

/** One scalar or inline collection; returns the index of the last line it used. */
function yamlValue(path: string, value: string, index: number, lines: readonly string[], out: ConfigEntry[]): number {
  if (value.startsWith('[') || value.startsWith('{')) {
    const { text, last } = gatherBalanced(value, index, lines);
    out.push(...readLiteral(text, index + 1, path, ':'));
    return last;
  }
  out.push({ key: path, value: unquote(value), line: index + 1 });
  return index;
}

/** Collects lines from `first` until brackets outside quotes balance. */
function gatherBalanced(first: string, index: number, lines: readonly string[]): { text: string; last: number } {
  let text = first;
  let last = index;
  while (depth(text) > 0 && last + 1 < lines.length) {
    last++;
    text += `\n${lines[last] ?? ''}`;
  }
  return { text, last };
}

function depth(text: string): number {
  let d = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') d++;
    else if (ch === ']' || ch === '}') d--;
  }
  return d;
}

// ---- TOML ----

function tomlKey(text: string): string {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of text.trim()) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '.') {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  parts.push(current.trim());
  return parts.join('.');
}

function readToml(lines: readonly string[]): ConfigEntry[] {
  const out: ConfigEntry[] = [];
  let prefix = '';
  for (let i = 0; i < lines.length; i++) {
    const t = (lines[i] ?? '').trim();
    if (t === '') continue;
    const arrayTable = /^\[\[\s*(.+?)\s*\]\]$/.exec(t);
    const table = /^\[\s*([^[\]]+?)\s*\]$/.exec(t);
    if (arrayTable !== null) {
      prefix = joinKey(tomlKey(arrayTable[1] ?? ''), '[]');
      out.push({ key: prefix, value: null, line: i + 1 });
      continue;
    }
    if (table !== null) {
      prefix = tomlKey(table[1] ?? '');
      out.push({ key: prefix, value: null, line: i + 1 });
      continue;
    }
    const m = /^((?:"[^"]*"|'[^']*'|[^=])+?)\s*=\s*(.*)$/.exec(t);
    if (m === null) continue;
    const key = joinKey(prefix, tomlKey(m[1] ?? ''));
    const value = m[2] ?? '';
    const triple = /^("""|''')(.*)$/.exec(value);
    if (triple !== null) {
      const close = triple[1] ?? '"""';
      const body = triple[2] ?? '';
      if (body.includes(close)) {
        out.push({ key, value: body.slice(0, body.indexOf(close)), line: i + 1 });
        continue;
      }
      if (body.trim() !== '') out.push({ key, value: body.trim(), line: i + 1 });
      while (i + 1 < lines.length) {
        i++;
        const line = lines[i] ?? '';
        const end = line.indexOf(close);
        const part = (end === -1 ? line : line.slice(0, end)).trim();
        if (part !== '') out.push({ key, value: part, line: i + 1 });
        if (end !== -1) break;
      }
    } else if (value.startsWith('[') || value.startsWith('{')) {
      const { text, last } = gatherBalanced(value, i, lines);
      out.push(...readLiteral(text, i + 1, key, '='));
      i = last;
    } else {
      out.push({ key, value: unquote(value), line: i + 1 });
    }
  }
  return out;
}

// ---- INI ----

function readIni(lines: readonly string[]): ConfigEntry[] {
  const out: ConfigEntry[] = [];
  let section = '';
  let lastKey: string | null = null;
  lines.forEach((raw, i) => {
    const t = raw.trim();
    if (t === '' || t.startsWith(';') || t.startsWith('#')) return;
    const header = /^\[([^\]]+)\]$/.exec(t);
    if (header !== null) {
      section = (header[1] ?? '').trim();
      lastKey = null;
      out.push({ key: section, value: null, line: i + 1 });
      return;
    }
    if (/^\s/.test(raw) && lastKey !== null) {
      out.push({ key: lastKey, value: t, line: i + 1 });
      return;
    }
    const m = /^([^=:]+?)\s*[=:]\s*(.*)$/.exec(t);
    if (m === null) return;
    lastKey = joinKey(section, (m[1] ?? '').trim());
    const value = m[2] ?? '';
    out.push({ key: lastKey, value: value === '' ? null : unquote(value), line: i + 1 });
  });
  return out;
}

// ---- Makefiles ----

function readMake(lines: readonly string[]): ConfigEntry[] {
  const out: ConfigEntry[] = [];
  let target = '';
  lines.forEach((raw, i) => {
    if (raw.startsWith('\t')) {
      const t = raw.trim();
      if (t !== '') out.push({ key: target, value: t, line: i + 1 });
      return;
    }
    const m = /^([^\s:=#][^:=]*?)\s*::?(?!=)/.exec(raw);
    if (m !== null) {
      target = (m[1] ?? '').trim();
      out.push({ key: target, value: null, line: i + 1 });
    }
  });
  return out;
}
