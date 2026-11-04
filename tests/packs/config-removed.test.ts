import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/engine/config.js';
import { evaluate } from '../../src/engine/engine.js';
import { configPack } from '../../src/packs/config.js';
import { ShellReader } from '../../src/packs/config-shell.js';
import { change, changeSet, modified, side } from '../helpers/changeset.js';

type Row = [string, string, number | null, string, string];

function findings(files: Parameters<typeof changeSet>[0], rule: string): Row[] {
  return evaluate(changeSet(files), DEFAULT_CONFIG, [configPack])
    .findings.filter((f) => f.ruleId === rule)
    .map((f) => [f.ruleId, f.file, f.line, f.severity, f.reason]);
}

const deleted = (path: string, text: string) => change(side(path, text), null);
const added = (path: string, text: string) => change(null, side(path, text));

describe('config/file-deleted', () => {
  const rule = 'config/file-deleted';

  it('names the tool and says nothing replaces it', () => {
    expect(findings([deleted('tsconfig.json', '{ "compilerOptions": { "strict": true } }\n')], rule)).toEqual([
      [rule, 'tsconfig.json', null, 'warning', 'tsconfig config tsconfig.json deleted; no tsconfig config replaces it'],
    ]);
  });

  it('a config added in a sibling directory does not replace one deleted elsewhere', () => {
    const files = [deleted('packages/web/.eslintrc.json', '{ "rules": { "eqeqeq": "error" } }\n'), added('packages/api/eslint.config.js', 'export default [];\n')];
    expect(findings(files, rule)).toHaveLength(1);
  });

  it('a config moved into a parent directory or a shared project file replaces it', () => {
    expect(findings([deleted('packages/web/.eslintrc.json', '{ "rules": {} }\n'), added('eslint.config.js', 'export default [];\n')], rule)).toEqual([]);
    expect(
      findings([deleted('jest.config.js', 'module.exports = { verbose: true };\n'), modified('package.json', '{ "name": "a" }\n', '{ "name": "a", "jest": { "verbose": true } }\n')], rule),
    ).toEqual([]);
    expect(findings([deleted('.coveragerc', '[report]\nfail_under = 90\n'), modified('setup.cfg', '[metadata]\nname = a\n', '[metadata]\nname = a\n\n[coverage:report]\nfail_under = 90\n')], rule)).toEqual([]);
  });

  it('a shared project file that keeps the same tool settings does not replace it', () => {
    const pyproject = '[tool.mypy]\nstrict = true\n';
    expect(findings([deleted('mypy.ini', '[mypy]\nstrict = True\n'), modified('pyproject.toml', `${pyproject}`, `${pyproject}\n[project]\nname = "a"\n`)], rule)).toHaveLength(1);
  });

  it('ignores CI files, ignore files and project files', () => {
    const files = [deleted('.github/workflows/ci.yml', 'on: push\n'), deleted('.eslintignore', 'dist/\n'), deleted('package.json', '{ "name": "a" }\n')];
    expect(findings(files, rule)).toEqual([]);
  });
});

describe('config/gate-removed', () => {
  const rule = 'config/gate-removed';
  const workflow = (...steps: string[]): string => `on: pull_request\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n${steps.map((s) => `      - run: ${s}\n`).join('')}`;

  it('counts by kind, names what went, and points at where it was', () => {
    const files = [modified('.github/workflows/ci.yml', workflow('npm ci', 'npx eslint .', 'npx tsc --noEmit', 'npx vitest run'), workflow('npm ci', 'npx vitest run'))];
    expect(findings(files, rule)).toEqual([
      [rule, '.github/workflows/ci.yml', 7, 'warning', '1 lint command fewer across CI, hooks and scripts (1 before, 0 after): eslint'],
      [rule, '.github/workflows/ci.yml', 7, 'warning', '1 typecheck command fewer across CI, hooks and scripts (1 before, 0 after): tsc'],
    ]);
  });

  it('a gate moved from a workflow into a package.json script it calls is not a removal', () => {
    const files = [
      modified('.github/workflows/ci.yml', workflow('npx eslint .', 'npm test'), workflow('npm run check')),
      modified('package.json', '{ "scripts": { "test": "vitest run" } }\n', '{ "scripts": { "check": "eslint . && vitest run" } }\n'),
    ];
    expect(findings(files, rule)).toEqual([]);
  });

  it('a call to a script the change does not define still counts as one gate', () => {
    const files = [modified('.github/workflows/ci.yml', workflow('npm run lint', 'npm test'), workflow('npm test'))];
    expect(findings(files, rule)).toEqual([[rule, '.github/workflows/ci.yml', 6, 'warning', '1 lint command fewer across CI, hooks and scripts (1 before, 0 after): npm run lint']]);
  });

  it('counts husky hooks and shell scripts, never commented-out lines', () => {
    expect(findings([modified('.husky/pre-commit', 'npx lint-staged\nnpm run typecheck\n', 'npx lint-staged\n')], rule)).toHaveLength(1);
    expect(findings([modified('scripts/ci.sh', 'set -e\npytest\n', 'set -e\n# pytest\n')], rule)).toHaveLength(1);
    expect(findings([modified('scripts/ci.sh', 'set -e\n# pytest\n', 'set -e\n')], rule)).toEqual([]);
  });

  it('never reads a script whose side could not be read', () => {
    expect(findings([change(side('scripts/ci.sh', 'pytest\n'), side('scripts/ci.sh', null, 'binary'))], rule)).toEqual([]);
  });
});

describe('config/gate-removed: printed text is not a gate', () => {
  const rule = 'config/gate-removed';
  const read = (lines: string[]): string[] => {
    const reader = new ShellReader();
    return lines.map((l) => reader.line(l).trim());
  };

  it('blanks echo and printf arguments but keeps the commands chained after them', () => {
    expect(read(['echo "cd src && pytest && ruff check ."'])).toEqual(['']);
    expect(read(["printf '%s\\n' \"npm test\""])).toEqual(['']);
    expect(read(['echo "running" && npm test'])).toEqual(['&& npm test']);
    expect(read(['LANG=C echo pytest; pytest -q'])).toEqual(['; pytest -q']);
    expect(read(['/bin/echo pytest'])).toEqual(['']);
  });

  it('blanks a heredoc body unless a shell reads it', () => {
    expect(read(["cat <<'DOC' > AGENTS.md", 'Run `npm test` first.', 'DOC', 'npm run lint'])).toEqual(["cat <<'DOC' > AGENTS.md", '', '', 'npm run lint']);
    expect(read(['bash <<EOF', 'pytest', 'EOF'])).toEqual(['bash <<EOF', 'pytest', 'EOF']);
    expect(read(['grep x <<< "$y"', 'pytest'])).toEqual(['grep x <<< "$y"', 'pytest']);
  });

  it('a script that only printed gate commands removes none when deleted; one that ran them does', () => {
    const doc = 'echo "npm test && npm run lint"\ncat <<EOF\nmypy .\nEOF\n';
    expect(findings([deleted('scripts/guide.sh', doc)], rule)).toEqual([]);
    expect(findings([deleted('scripts/ci.sh', `${doc}npm test\n`)], rule)).toHaveLength(1);
  });

  it('a CI step that printed a command passes when the echo goes', () => {
    const before = 'jobs:\n  a:\n    steps:\n      - run: |\n          echo "then run pytest"\n          make build\n';
    const after = 'jobs:\n  a:\n    steps:\n      - run: |\n          make build\n';
    expect(findings([modified('.github/workflows/ci.yml', before, after)], rule)).toEqual([]);
  });
});
