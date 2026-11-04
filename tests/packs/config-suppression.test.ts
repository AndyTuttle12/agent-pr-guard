import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type GuardConfig } from '../../src/engine/config.js';
import { evaluate } from '../../src/engine/engine.js';
import { configPack } from '../../src/packs/config.js';
import { directivesIn, eslintEnablesIn } from '../../src/packs/config-suppression.js';
import { change, changeSet, modified, side } from '../helpers/changeset.js';

type Row = [string, number | null, string, string];

/** The rule warns by default (D15); raised to error, its own reason-or-not split shows. */
const RAISED: GuardConfig = { ...DEFAULT_CONFIG, rules: { 'config/inline-suppression': 'error' } };

function findings(files: Parameters<typeof changeSet>[0], config: GuardConfig = RAISED): Row[] {
  return evaluate(changeSet(files), config, [configPack])
    .findings.filter((f) => f.ruleId === 'config/inline-suppression')
    .map((f) => [f.file, f.line, f.severity, f.reason]);
}

const added = (path: string, text: string) => change(null, side(path, text));
const ts = 'src/api.ts';

describe('config/inline-suppression: reading directives', () => {
  it('reads tool, scope, sorted codes and reason', () => {
    expect(directivesIn('foo(); // eslint-disable-line quotes, no-console -- CLI output */')).toEqual([
      { tool: 'eslint', scope: 'line', label: 'eslint-disable-line', codes: ['no-console', 'quotes'], reason: 'CLI output' },
    ]);
    expect(directivesIn('x = 1  # noqa: e501,W291  # long URL')).toEqual([{ tool: 'noqa', scope: 'line', label: 'noqa', codes: ['E501', 'W291'], reason: 'long URL' }]);
    expect(directivesIn('# ruff: noqa: F401')).toEqual([{ tool: 'noqa', scope: 'file', label: 'ruff: noqa', codes: ['F401'], reason: '' }]);
    expect(directivesIn('defer f.Close() //nolint:errcheck,gosec // best effort')[0]).toMatchObject({ tool: 'nolint', codes: ['errcheck', 'gosec'], reason: 'best effort' });
    expect(directivesIn('/* c8 ignore next 3 */')).toEqual([{ tool: 'c8', scope: 'next', label: 'c8 ignore next', codes: [], reason: '' }]);
    expect(directivesIn('/* istanbul ignore else -- @preserve */')[0]?.reason).toBe('');
    expect(directivesIn('if x:  # pragma: no cover')[0]).toMatchObject({ tool: 'coverage', scope: 'line' });
  });

  it('@ts-ignore and @ts-expect-error share a key; @ts-nocheck is file-wide', () => {
    expect(directivesIn('// @ts-expect-error: the lib types are wrong')[0]).toMatchObject({ tool: 'ts', scope: 'next-line', reason: 'the lib types are wrong' });
    expect(directivesIn('/** @ts-ignore */')[0]).toMatchObject({ tool: 'ts', scope: 'next-line', reason: '' });
    expect(directivesIn('// @ts-nocheck')[0]).toMatchObject({ tool: 'ts', scope: 'file' });
  });

  it('a reason ends at the next directive', () => {
    expect(directivesIn('x()  # noqa  # pragma: no cover  (CLI entry)').map((d) => [d.tool, d.reason])).toEqual([
      ['noqa', ''],
      ['coverage', '(CLI entry)'],
    ]);
  });

  it('a directive must open its comment', () => {
    expect(directivesIn('// we no longer need @ts-ignore or eslint-disable here')).toEqual([]);
    expect(directivesIn('x = "noqa"  # see noqa docs')).toEqual([]);
    expect(directivesIn('// nolintable')).toEqual([]);
  });
});

describe('config/inline-suppression: findings', () => {
  it('is a warning by default, bare or not', () => {
    const after = '// @ts-ignore\nexport const a: number = "1";\n// @ts-nocheck\n';
    expect(findings([modified(ts, 'export const a = 1;\n', after)], DEFAULT_CONFIG).map((r) => r[2])).toEqual(['warning', 'warning']);
  });

  it('a bare directive is an error, one with a reason a warning, @ts-nocheck always an error', () => {
    const before = 'export const a = 1;\n';
    const after = '// @ts-ignore\nexport const a: number = "1";\n// eslint-disable-next-line no-console -- CLI output\nconsole.log(a);\n';
    expect(findings([modified(ts, before, after)])).toEqual([
      [ts, 1, 'error', '@ts-ignore added: hides type errors on the next line, with no reason given'],
      [ts, 3, 'warning', 'eslint-disable-next-line no-console added: turns off no-console on the next line (reason: "CLI output")'],
    ]);
    expect(findings([added('src/legacy.ts', '// @ts-nocheck -- migrating\nexport {};\n')])).toEqual([
      ['src/legacy.ts', 1, 'error', '@ts-nocheck added: turns off type checking for the whole file (reason: "migrating")'],
    ]);
  });

  it('widening the codes in a hunk is new; narrowing them or swapping @ts-ignore for @ts-expect-error is not', () => {
    const py = 'app.py';
    expect(findings([modified(py, 'x = 1  # noqa: E501\n', 'x = 1  # noqa\n')])).toEqual([[py, 1, 'error', 'noqa added: hides every lint error on this line, with no reason given']]);
    expect(findings([modified(ts, '// eslint-disable-next-line no-console\nf();\n', '// eslint-disable-next-line no-console, no-alert\nf();\n')])).toHaveLength(1);
    expect(findings([modified(py, 'x = 1  # noqa\n', 'x = 1  # noqa: E501\n')])).toEqual([]);
    expect(findings([modified(ts, '// eslint-disable-next-line no-console, no-alert\nf();\n', '// eslint-disable-next-line no-alert\nf();\n')])).toEqual([]);
    expect(findings([modified(ts, '// @ts-ignore\nf();\n', '// @ts-expect-error\nf();\n')])).toEqual([]);
  });

  it('changing the scope is new, and a hunk does not borrow from another hunk', () => {
    expect(findings([modified(ts, 'f(); // eslint-disable-line no-console\n', '/* eslint-disable no-console */\nf();\n')])).toHaveLength(1);
    const before = '// @ts-ignore\na();\nb();\nc();\nd();\n';
    const after = 'a();\nb();\nc();\n// @ts-expect-error\nd();\n';
    expect(findings([modified(ts, before, after)])).toEqual([[ts, 4, 'error', '@ts-expect-error added: hides type errors on the next line, with no reason given']]);
  });

  it('an edited line that keeps its directive passes, as does a line moved unchanged to another file', () => {
    expect(findings([modified(ts, 'f(a); // eslint-disable-line no-console\n', 'f(a, b); // eslint-disable-line no-console\n')])).toEqual([]);
    const line = '  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n';
    const files = [modified('src/a.ts', `export function f() {\n${line}  return 1 as any;\n}\n`, 'export {};\n'), added('src/b.ts', `export function f() {\n${line}  return 1 as any;\n}\n`)];
    expect(findings(files)).toEqual([]);
  });

  it('a next-line directive moved off the code it covers is new', () => {
    const bare = '@ts-ignore added: hides type errors on the next line, with no reason given';
    expect(findings([modified(ts, '// @ts-ignore\nlegacy();\n', 'legacy();\n// @ts-ignore\nbroken();\n')])).toEqual([[ts, 2, 'error', bare]]);
    expect(findings([modified(ts, '// @ts-ignore\nlegacy();\n', '// @ts-expect-error\nbroken();\nlegacy();\n')])).toEqual([
      [ts, 1, 'error', '@ts-expect-error added: hides type errors on the next line, with no reason given'],
    ]);
    const line = '  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n';
    const files = [modified('src/a.ts', `export function f() {\n${line}  return 1 as any;\n}\n`, 'export {};\n'), added('src/b.ts', `export function g() {\n${line}  return 2 as any;\n}\n`)];
    expect(findings(files)).toEqual([['src/b.ts', 2, 'error', 'eslint-disable-next-line @typescript-eslint/no-explicit-any added: turns off @typescript-eslint/no-explicit-any on the next line, with no reason given']]);
    expect(findings([modified(ts, '/* c8 ignore next */\nexport const a = 1;\nexport const b = 2;\n', 'export const a = 1;\n/* c8 ignore next */\nexport const b = 2;\n')])).toHaveLength(1);
  });

  it('a next-line directive moved with the code it covers, or rewritten along with it, nets out', () => {
    const before = '// @ts-ignore\nlegacy();\na();\nb();\n';
    expect(findings([modified(ts, before, 'a();\nb();\n// @ts-ignore\nlegacy();\n')])).toEqual([]);
    expect(findings([modified(ts, before, 'a();\nb();\n// @ts-ignore\n\n// the lib types are wrong\nlegacy();\n')])).toEqual([]);
    expect(findings([modified(ts, '// @ts-ignore\nconst x = f(a);\n', '// @ts-expect-error\nconst x = f(a, b);\n')])).toEqual([]);
    expect(findings([modified('src/w.svelte', '<script>\n  // @ts-ignore\n  let a = 1;\n  let b;\n</script>\n', '<script>\n  let b;\n  // @ts-ignore\n  let a = 1;\n</script>\n')])).toEqual([]);
  });

  it('never reads docs, strings or unreadable sides', () => {
    expect(findings([added('README.md', '```ts\n// @ts-ignore\n```\n'), added('notes.txt', '# noqa\n')])).toEqual([]);
    expect(findings([modified(ts, 'const s = "";\n', 'const s = "// @ts-ignore";\n')])).toEqual([]);
    expect(findings([modified('app.py', 'X = 1\n', 'X = """\n# noqa\n"""\n')])).toEqual([]);
    expect(findings([change(side(ts, null, 'binary'), side(ts, '// @ts-ignore\n'))])).toEqual([]);
  });

  it('reads files with no lexer from their raw lines, behind a comment marker', () => {
    const svelte = 'src/Widget.svelte';
    expect(findings([modified(svelte, '<script lang="ts">\n</script>\n', '<script lang="ts">\n  // @ts-ignore\n</script>\n<p>use @ts-ignore sparingly</p>\n')])).toEqual([
      [svelte, 2, 'error', '@ts-ignore added: hides type errors on the next line, with no reason given'],
    ]);
    expect(findings([modified('src/App.vue', '<template>\n</template>\n', '<!-- eslint-disable vue/no-v-html -->\n<template>\n</template>\n')])).toHaveLength(1);
  });

  it('names coverage, nolint and file-wide noqa effects', () => {
    expect(findings([added('src/cli.ts', '/* istanbul ignore next */\nmain();\n')])[0]?.[3]).toBe('istanbul ignore next added: excludes the next statement from coverage, with no reason given');
    expect(findings([added('src/x.ts', '/* v8 ignore start */\n')])[0]?.[3]).toBe('v8 ignore start added: excludes the code up to v8 ignore stop from coverage, with no reason given');
    expect(findings([added('main.go', 'package main\n\nfunc f() { g() } //nolint\n')])[0]?.[3]).toBe('nolint added: hides every linter on this line or the statement below, with no reason given');
    expect(findings([added('pkg/__init__.py', '# flake8: noqa\n')])[0]?.[3]).toBe('flake8: noqa added: hides every lint error in the whole file, with no reason given');
    expect(findings([added('pkg/x.py', 'if DEBUG:  # pragma: no cover\n    pass\n')])[0]?.[3]).toBe('pragma: no cover added: excludes this line or block from coverage, with no reason given');
  });

  it('cuts a long reason', () => {
    const reason = 'x'.repeat(100);
    expect(findings([added(ts, `// @ts-expect-error ${reason}\nf();\n`)])[0]?.[3]).toContain(`(reason: "${'x'.repeat(77)}...")`);
  });
});

describe('config/inline-suppression: type: ignore and pylint', () => {
  const py = 'app/models.py';

  it('reads their codes and reasons', () => {
    expect(directivesIn('x = f()  # type: ignore[attr-defined, arg-type]  # stubs lag the lib')).toEqual([
      { tool: 'type', scope: 'line', label: 'type: ignore', codes: ['arg-type', 'attr-defined'], reason: 'stubs lag the lib' },
    ]);
    expect(directivesIn('# pylint: disable=too-many-locals, C0103 -- generated')).toEqual([
      { tool: 'pylint', scope: 'block', label: 'pylint: disable', codes: ['C0103', 'too-many-locals'], reason: 'generated' },
    ]);
    expect(directivesIn('# pylint: disable=all')[0]?.codes).toEqual([]);
    expect(directivesIn('# pylint: disable-next=unused-import')[0]).toMatchObject({ scope: 'next-line', codes: ['unused-import'] });
    expect(directivesIn('# pylint: skip-file')[0]).toMatchObject({ scope: 'file', codes: [] });
    expect(directivesIn('# the type: ignore comments are gone; pylint: disable is next')).toEqual([]);
    expect(directivesIn('x = 1  # a # type: ignore here would hide the module')).toEqual([]);
  });

  it('a type: ignore above all code covers the file and stays an error with a reason', () => {
    expect(findings([modified(py, 'x: int = 1\n', 'x: int = "1"  # type: ignore[assignment]\n')])).toEqual([
      [py, 1, 'error', 'type: ignore[assignment] added: hides assignment on this line, with no reason given'],
    ]);
    expect(findings([modified(py, '"""Models."""\nx = 1\n', '# type: ignore  # untyped ORM\n"""Models."""\nx = 1\n')])).toEqual([
      [py, 1, 'error', 'type: ignore added: turns off type checking for the whole file (reason: "untyped ORM")'],
    ]);
    expect(findings([modified(py, '"""Models."""\nx = 1\n', '"""Models."""\n# type: ignore\nx = 1\n')])[0]?.[3]).toBe(
      'type: ignore added: hides every type error on this line, with no reason given',
    );
  });

  it('a pylint disable on a code line covers that line; on its own line, the rest of the block', () => {
    expect(findings([modified(py, 'def f(a):\n    return a\n', 'def f(A):  # pylint: disable=invalid-name\n    return A\n')])).toEqual([
      [py, 1, 'error', 'pylint: disable=invalid-name added: turns off invalid-name on this line, with no reason given'],
    ]);
    expect(findings([modified(py, 'def f():\n    pass\n', 'def f():\n    # pylint: disable=broad-except  # retried by the caller\n    pass\n')])).toEqual([
      [py, 2, 'warning', 'pylint: disable=broad-except added: turns off broad-except to the end of the enclosing block or module (reason: "retried by the caller")'],
    ]);
    expect(findings([added('gen/out.py', '# pylint: skip-file\nX = 1\n')])[0]?.[3]).toBe('pylint: skip-file added: turns off pylint for the whole file, with no reason given');
    expect(findings([modified(py, 'x = 1  # pylint: disable=all\n', 'x = 1  # pylint: disable=invalid-name\n')])).toEqual([]);
    expect(findings([modified(py, 'x = 1  # pylint: disable=invalid-name\n', 'x = 1  # pylint: disable=invalid-name,unused-variable\n')])).toHaveLength(1);
  });
});

describe('config/inline-suppression: removed eslint-enable', () => {
  const body = (enable: string) => `/* eslint-disable no-console */\nconsole.log(1);\n${enable}\nrun();\n`;

  it('reads the rules an eslint-enable turns back on', () => {
    expect(eslintEnablesIn('/* eslint-enable no-console, no-alert */')).toEqual([['no-alert', 'no-console']]);
    expect(eslintEnablesIn('// eslint-enable')).toEqual([[]]);
    expect(eslintEnablesIn('// we eslint-enable later')).toEqual([]);
  });

  it('removing or moving down the enable that closed a block is an error at the code it now reaches', () => {
    const reason = 'eslint-enable no-console removed: an earlier eslint-disable now keeps no-console off past this point';
    expect(findings([modified(ts, body('/* eslint-enable no-console */'), body(''))])).toEqual([[ts, 4, 'error', reason]]);
    expect(findings([modified(ts, body('/* eslint-enable no-console */'), '/* eslint-disable no-console */\nconsole.log(1);\nrun();\n/* eslint-enable no-console */\n')])).toEqual([[ts, 3, 'error', reason]]);
    expect(findings([modified(ts, body('/* eslint-enable */'), body(''))])).toEqual([[ts, 4, 'error', 'eslint-enable removed: an earlier eslint-disable now keeps no-console off past this point']]);
    const blanket = '/* eslint-disable */\nf();\n/* eslint-enable */\ng();\n';
    expect(findings([modified(ts, blanket, '/* eslint-disable */\nf();\ng();\n')])[0]?.[3]).toBe('eslint-enable removed: an earlier eslint-disable now keeps every ESLint rule off past this point');
  });

  it('removing an enable along with its disable, rewriting it, moving it up, or dropping one that closed nothing passes', () => {
    expect(findings([modified(ts, body('/* eslint-enable no-console */'), 'console.log(1);\nrun();\n')])).toEqual([]);
    expect(findings([modified(ts, body('/* eslint-enable no-console */'), body('/* eslint-enable */'))])).toEqual([]);
    expect(findings([modified(ts, body('/* eslint-enable no-console */'), '/* eslint-disable no-console */\n/* eslint-enable no-console */\nconsole.log(1);\nrun();\n')])).toEqual([]);
    expect(findings([modified(ts, 'f();\n/* eslint-enable no-console */\ng();\n', 'f();\ng();\n')])).toEqual([]);
    expect(findings([modified(ts, body('/* eslint-enable no-alert */'), body(''))])).toEqual([]);
    expect(findings([modified(ts, '/* eslint-disable no-console */\nconsole.log(1);\n/* eslint-enable no-console */\n', '/* eslint-disable no-console */\nconsole.log(1);\n')])).toEqual([]);
  });
});

describe('config/inline-suppression: wording', () => {
  it('writes codes the way each tool does', () => {
    expect(findings([added('app.py', 'x = 1  # noqa: E501,W291\n')])[0]?.[3]).toMatch(/^noqa: E501, W291 added: hides E501, W291 on this line/);
    expect(findings([added('main.go', 'package main\n\nfunc f() { g() } //nolint:gosec,errcheck\n')])[0]?.[3]).toMatch(/^nolint:errcheck,gosec added/);
  });
});
