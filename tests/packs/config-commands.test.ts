import { describe, expect, it } from 'vitest';
import { GATE_COMMANDS, SWALLOWED } from '../../src/packs/config-commands.js';
import { scanLine } from '../../src/packs/scan.js';

const kinds = (line: string): string[] => scanLine(line, GATE_COMMANDS).map((m) => m.tag);

describe('GATE_COMMANDS', () => {
  it.each([
    ['npm test', ['test']],
    ['pnpm run test:unit && npm run lint', ['test', 'lint']],
    ['yarn typecheck', ['typecheck']],
    ['npx vitest run --config vitest.config.ts', ['test']],
    ['./node_modules/.bin/jest --ci', ['test']],
    ['python -m pytest -q', ['test']],
    ['go vet ./... && go test ./...', ['lint', 'test']],
    ['uses: golangci/golangci-lint-action@v6', ['lint']],
    ['mypy src && tsc --noEmit', ['typecheck', 'typecheck']],
    ['node --test', ['test']],
    ['node --experimental-strip-types --import ./tests/setup.mjs --test "src/**/*.test.ts"', ['test']],
    ['node --test-reporter=spec -r ts-node/register --test', ['test']],
    ['node app.js --test', []],
    ['node --test-only', []],
    ['npm run build', []],
    ['npm install -D @vitest/coverage-v8 eslint-plugin-react', []],
  ])('classifies %s', (line, expected) => {
    expect(kinds(line)).toEqual(expected);
  });

  it('spots a swallowed failure', () => {
    expect(SWALLOWED.test('npm test || true')).toBe(true);
    expect(SWALLOWED.test('eslint . || exit 0')).toBe(true);
    expect(SWALLOWED.test('npm test || exit 1')).toBe(false);
  });
});
