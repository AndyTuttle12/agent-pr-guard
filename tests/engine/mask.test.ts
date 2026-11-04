import { describe, expect, it } from 'vitest';
import { mask } from '../../src/engine/mask.js';

function views(text: string, syntax: Parameters<typeof mask>[1]) {
  const m = mask(text, syntax);
  for (const view of [m.code, m.codeWithStrings, m.comments]) {
    expect(view.length).toBe(text.length);
    expect(view.split('\n').length).toBe(text.split('\n').length);
  }
  return m;
}

describe('mask (js)', () => {
  it('blanks comments and string contents but keeps columns and delimiters', () => {
    const src = 'expect(a).toBe("it.skip(") // it.only(\n';
    const m = views(src, 'js');
    expect(m.code).toBe(`expect(a).toBe("${' '.repeat(8)}")${' '.repeat(12)}\n`);
    expect(m.code.indexOf('toBe')).toBe(src.indexOf('toBe'));
    expect(m.code).not.toContain('skip');
    expect(m.code).not.toContain('only');
    expect(m.codeWithStrings).toContain('"it.skip("');
    expect(m.codeWithStrings).not.toContain('only');
    expect(m.comments.trim()).toBe('// it.only(');
  });

  it('handles block comments across lines', () => {
    const src = 'a();\n/* it("x", () => {\n  expect(1).toBe(1);\n}) */\nb();\n';
    const m = views(src, 'js');
    expect(m.code.split('\n').map((l) => l.trim())).toEqual(['a();', '', '', '', 'b();', '']);
    expect(m.comments).toContain('expect(1).toBe(1);');
  });

  it('masks template literal text but keeps code inside ${}', () => {
    const src = 'const s = `it.skip ${expect(x).toBe(1)} // not a comment`; it.only("a");\n';
    const m = views(src, 'js');
    expect(m.code).toContain('expect(x).toBe(1)');
    expect(m.code).not.toContain('it.skip');
    expect(m.code).not.toContain('not a comment');
    expect(m.code).toContain('it.only(');
    expect(m.comments.trim()).toBe('');
  });

  it('handles nested templates and braces inside ${}', () => {
    const src = 'f(`a ${ {k: `b ${c}`}.k } d`); g();\n';
    const m = views(src, 'js');
    expect(m.code).toContain('{k:');
    expect(m.code).toContain('c');
    expect(m.code).toContain('g();');
    expect(m.code).not.toMatch(/\bd`/);
  });

  it('treats a slash after an operand as division and after an operator as a regex', () => {
    const division = views('const x = a / b; // c\n', 'js');
    expect(division.code).toContain('a / b;');
    expect(division.comments.trim()).toBe('// c');
    const regex = views("const r = /it.skip('/; it.only('x');\n", 'js');
    expect(regex.code).not.toContain('it.skip');
    expect(regex.code).toContain("it.only('");
    const afterReturn = views('return /"/.test(s); it.only("y")\n', 'js');
    expect(afterReturn.code).toContain('it.only("');
  });

  it('keeps escaped quotes inside strings', () => {
    const m = views('a("x\\"); it.skip(", b); it.only()\n', 'js');
    expect(m.code).not.toContain('skip');
    expect(m.code).toContain('it.only()');
  });

  it('ends an unterminated string at the line break', () => {
    const m = views('a("oops\nit.only()\n', 'js');
    expect(m.code.split('\n')[1]).toBe('it.only()');
  });
});

describe('mask (python)', () => {
  it('blanks comments, prefixed strings and docstrings', () => {
    const src = [
      'def test_a():',
      '    """Docstring with assert x."""',
      '    s = rb"pytest.mark.skip"  # assert y',
      "    assert f'{x}' == 'z'",
      '',
    ].join('\n');
    const m = views(src, 'python');
    const code = m.code.split('\n');
    expect(code[1]?.trim()).toBe(`"""${' '.repeat('Docstring with assert x.'.length)}"""`);
    expect(m.code).not.toContain('Docstring');
    expect(m.code).not.toContain('pytest.mark.skip');
    expect(code[2]).toContain('s = rb"');
    expect(code[3]).toContain("assert f'   ' == ' '");
    expect(m.comments.split('\n')[2]?.trim()).toBe('# assert y');
  });

  it('handles multi-line triple-quoted strings', () => {
    const src = "x = '''\n@pytest.mark.skip\n'''\n@pytest.mark.xfail\ndef test_b(): pass\n";
    const m = views(src, 'python');
    expect(m.code).not.toContain('skip');
    expect(m.code).toContain('@pytest.mark.xfail');
  });

  it('does not treat an identifier ending in a prefix letter as a prefix', () => {
    const m = views("bar'x' + 1\n", 'python');
    expect(m.code).toBe("bar' ' + 1\n");
  });
});

describe('mask (go)', () => {
  it('blanks raw strings, runes and comments', () => {
    const src = 'x := `t.Skip()\nmore`\nr := \'"\'\nt.Skip() // t.Errorf\n';
    const m = views(src, 'go');
    const code = m.code.split('\n');
    expect(code[0]).toBe(`x := \`${' '.repeat('t.Skip()'.length)}`);
    expect(code[1]).toBe('    `');
    expect(code[3]).toBe(`t.Skip()${' '.repeat(' // t.Errorf'.length)}`);
    expect(m.comments.split('\n')[3]?.trim()).toBe('// t.Errorf');
  });
});

describe('mask (hash and json)', () => {
  it('treats # as a comment only at a line start or after whitespace', () => {
    const src = 'url: http://x#y\nrun: npm test || true # fine\n# whole line\n';
    const m = views(src, 'hash');
    expect(m.codeWithStrings.split('\n')[0]).toBe('url: http://x#y');
    expect(m.codeWithStrings.split('\n')[1]?.trimEnd()).toBe('run: npm test || true');
    expect(m.comments.split('\n')[2]).toBe('# whole line');
  });

  it('keeps quoted values in codeWithStrings and ignores # inside them', () => {
    const src = 'key = "a # b"\nrun: echo don\'t # c\n; ini comment\n';
    const m = views(src, 'hash');
    expect(m.codeWithStrings.split('\n')[0]).toBe('key = "a # b"');
    expect(m.code.split('\n')[0]).toBe('key = "     "');
    expect(m.codeWithStrings.split('\n')[1]?.trimEnd()).toBe("run: echo don't");
    expect(m.comments.split('\n')[2]).toBe('; ini comment');
  });

  it('masks // and /* */ comments in JSON with comments', () => {
    const src = '{\n  // "rules": {}\n  "a": "//not", /* x */ "b": 1\n}\n';
    const m = views(src, 'json');
    expect(m.codeWithStrings).not.toContain('rules');
    expect(m.codeWithStrings).toContain('"//not"');
    expect(m.codeWithStrings).toContain('"b": 1');
  });

  it('leaves plain text untouched', () => {
    const m = views('a # b // c\n', 'plain');
    expect(m.code).toBe('a # b // c\n');
    expect(m.comments).toBe('          \n');
  });
});
