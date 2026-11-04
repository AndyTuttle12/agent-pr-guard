import type { SideView } from '../engine/analyze.js';

/**
 * `node:assert`, `assert`, `node:assert/strict` or `assert/strict` as a quoted module specifier.
 * The quote is the second group in both statement patterns below.
 */
const MODULE = String.raw`(['"])(?:node:)?assert(?:/strict)?\2`;

/** `import <clause> from '<assert module>'`; type-only imports bind no function. */
const ES_IMPORT = new RegExp(String.raw`\bimport\s+(?!type\b)([^'";]*?)\s*\bfrom\s*${MODULE}`, 'g');

/** `const <name or { destructured }> = require('<assert module>')`, optionally `.strict`. */
const CJS_REQUIRE = new RegExp(String.raw`\b(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*${MODULE}\s*\)`, 'g');

/** The functions the assert module exports that are checks; `strict` is the module again. */
const CHECKS = new Set([
  'ok',
  'equal',
  'notEqual',
  'strictEqual',
  'notStrictEqual',
  'deepEqual',
  'deepStrictEqual',
  'notDeepEqual',
  'notDeepStrictEqual',
  'partialDeepStrictEqual',
  'throws',
  'doesNotThrow',
  'rejects',
  'doesNotReject',
  'match',
  'doesNotMatch',
  'fail',
  'ifError',
]);

const IDENT = /^[A-Za-z_$][\w$]*$/;

/**
 * The local names a JS side binds to the assert module, each mapped to what it stands for:
 * `assert` for the module itself (a default or namespace import, `strict`, or a `require`), or
 * `assert.<check>` for a check imported by name (`{ deepStrictEqual as same }` maps `same`).
 * Read from the view that keeps strings, since the module specifier is a string.
 */
export function assertAliases(codeWithStrings: readonly string[]): Map<string, string> {
  const text = codeWithStrings.join('\n');
  const aliases = new Map<string, string>();
  const bindModule = (local: string): void => {
    if (IDENT.test(local)) aliases.set(local, 'assert');
  };
  const bindNamed = (imported: string, local: string): void => {
    if (!IDENT.test(local)) return;
    if (imported === 'strict' || imported === 'default') aliases.set(local, 'assert');
    else if (CHECKS.has(imported)) aliases.set(local, `assert.${imported}`);
  };
  for (const m of text.matchAll(ES_IMPORT)) {
    const clause = m[1] ?? '';
    const named = /\{([^}]*)\}/.exec(clause);
    for (const spec of named?.[1]?.split(',') ?? []) {
      const parts = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(spec);
      if (parts?.[1] !== undefined) bindNamed(parts[1], parts[2] ?? parts[1]);
    }
    const namespace = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (namespace?.[1] !== undefined) bindModule(namespace[1]);
    const head = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause);
    if (head?.[1] !== undefined) bindModule(head[1]);
  }
  for (const m of text.matchAll(CJS_REQUIRE)) {
    const binding = m[1] ?? '';
    if (!binding.startsWith('{')) {
      bindModule(binding);
      continue;
    }
    for (const spec of binding.slice(1, -1).split(',')) {
      const parts = /^\s*([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?\s*$/.exec(spec);
      if (parts?.[1] !== undefined) bindNamed(parts[1], parts[2] ?? parts[1]);
    }
  }
  return aliases;
}

const viewCache = new WeakMap<SideView, readonly string[]>();

/**
 * A JS side's code view with every call through an alias of the assert module spelled the
 * canonical way (`same(a, b)` → `assert.deepStrictEqual(a, b)`, `nodeAssert.ok(x)` → `assert.ok(x)`),
 * so the assertion and strength patterns see one spelling. Line numbers are kept; columns are not.
 * Other languages, and sides with no alias, get their code view unchanged.
 */
export function assertView(side: SideView): readonly string[] {
  const cached = viewCache.get(side);
  if (cached !== undefined) return cached;
  let view = side.code;
  if (side.language === 'js') {
    const rewrites = [...assertAliases(side.codeWithStrings)].filter(([local, canonical]) => local !== canonical);
    if (rewrites.length > 0) view = side.code.map((line) => rewriteLine(line, rewrites));
  }
  viewCache.set(side, view);
  return view;
}

function rewriteLine(line: string, rewrites: readonly (readonly [string, string])[]): string {
  let out = line;
  for (const [local, canonical] of rewrites) {
    const name = local.replace(/\$/g, '\\$');
    // The module is used as `x(...)` or `x.check(...)`; a named check only as `x(...)`.
    const follow = canonical === 'assert' ? String.raw`(?=\s*[.(])` : String.raw`(?=\s*\()`;
    out = out.replace(new RegExp(String.raw`(?<![\w$.])${name}${follow}`, 'g'), canonical);
  }
  return out;
}
