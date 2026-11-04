/**
 * Shell command lines read for what they run, not what they print: the arguments of `echo` and
 * `printf`, and the body of a heredoc fed to anything but a shell, are text, so a gate command
 * written there is documentation. Blanked text keeps its length, so match columns hold.
 */

/** Commands that write their arguments out instead of running them. */
const PRINTERS = new Set(['echo', 'printf']);

/** Commands that run a heredoc fed to them as a script. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ssh', 'exec', 'eval', 'source', '.']);

const SEPARATOR = /^(?:&&|\|\||;;|[;|&()])/;
const HEREDOC = /(?<!<)<<(?!<)-?\s*(["']?)([\w.-]+)\1/;

interface Segment {
  readonly start: number;
  readonly end: number;
}

/** Splits a line at the separators outside quotes: `;`, `&&`, `||`, `|`, `&`, `(`, `)`. */
function segments(line: string): Segment[] {
  const out: Segment[] = [];
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? '';
    if (quote !== null) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    const sep = SEPARATOR.exec(line.slice(i));
    if (sep !== null) {
      out.push({ start, end: i });
      i += sep[0].length - 1;
      start = i + 1;
    }
  }
  out.push({ start, end: line.length });
  return out;
}

/** The command word of a segment: the first word after any `NAME=value` assignments. */
function commandWord(text: string): string {
  const words = text.trim().split(/\s+/);
  const word = words.find((w) => !/^[A-Za-z_]\w*=/.test(w)) ?? '';
  return word.replace(/^.*\//, '');
}

function blank(text: string, from: number, to: number): string {
  return text.slice(0, from) + text.slice(from, to).replace(/\S/g, ' ') + text.slice(to);
}

/**
 * Reads the lines of one script, or of one CI step's command block, in order. A heredoc opened
 * on one line blanks the lines after it up to its delimiter, unless a shell reads it.
 */
export class ShellReader {
  private delimiter: string | null = null;

  /** The line with printed text blanked. */
  line(text: string): string {
    if (this.delimiter !== null) {
      if (text.trim() === this.delimiter) this.delimiter = null;
      return text.replace(/\S/g, ' ');
    }
    let out = text;
    for (const seg of segments(text)) {
      const body = text.slice(seg.start, seg.end);
      const word = commandWord(body);
      if (PRINTERS.has(word)) {
        out = blank(out, seg.start, seg.end);
        continue;
      }
      const doc = HEREDOC.exec(body);
      if (doc !== null && !SHELLS.has(word)) this.delimiter = doc[2] ?? null;
    }
    return out;
  }
}
