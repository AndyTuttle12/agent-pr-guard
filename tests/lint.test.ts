import { describe, expect, it } from 'vitest';
import { ROOT, blankNonCode, lintSource, lintTree } from '../scripts/lint.js';

const rules = (source: string): string[] => lintSource('x.ts', source).map((f) => `${f.line}:${f.rule}`);

describe('lint', () => {
  it('flags `: any` and `as any`', () => {
    expect(rules('function f(a: any) {}')).toEqual(['1:no-any']);
    expect(rules('const x = value as any;')).toEqual(['1:no-any']);
    expect(rules('let y:any;')).toEqual(['1:no-any']);
  });

  it('flags a default export', () => {
    expect(rules('const a = 1;\nexport default a;')).toEqual(['2:no-default-export']);
    expect(rules('export default function () {}')).toEqual(['1:no-default-export']);
  });

  it('does not flag lookalikes', () => {
    expect(rules('const company = 1; const many = company as many;')).toEqual([]);
    expect(rules('export const defaults = 1;')).toEqual([]);
    expect(rules('function f(a: unknown, b: anything) {}')).toEqual([]);
  });

  it('skips line, block and doc comments', () => {
    expect(rules('// a: any\nconst a = 1; // as any')).toEqual([]);
    expect(rules('/* export default x */\n/**\n * b: any\n */\nconst c = 1;')).toEqual([]);
  });

  it('skips string, template and regex contents but reads template expressions', () => {
    expect(rules(`const s = 'a: any'; const t = "export default";`)).toEqual([]);
    expect(rules('const t = `x as any ${1} export default`;')).toEqual([]);
    expect(rules('const r = /as any|export default/;')).toEqual([]);
    expect(rules('const r = /[\'"]/; const bad: any = 1;')).toEqual(['1:no-any']);
    expect(rules('const t = `${(v as any).x}`;')).toEqual(['1:no-any']);
    expect(rules('const t = `a ${`b ${1}`} c: any`; const u: any = 1;')).toEqual(['1:no-any']);
  });

  it('keeps the line layout so a hit reports the right line', () => {
    const source = '/* one\ntwo */\nconst s = `a\nb`;\nlet z: any;';
    expect(blankNonCode(source).split('\n')).toHaveLength(5);
    expect(rules(source)).toEqual(['5:no-any']);
  });

  it('src/ is clean', () => {
    expect(lintTree(ROOT)).toEqual([]);
  });
});
