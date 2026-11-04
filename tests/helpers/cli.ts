import { runCli } from '../../src/cli/run.js';
import { makeRepo, type TestRepo } from './repo.js';

export interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the CLI in-process, from `cwd`, capturing its output. */
export async function cli(argv: readonly string[], cwd = process.cwd()): Promise<CliRun> {
  let stdout = '';
  let stderr = '';
  const code = await runCli(argv, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    version: '0.0.0-test',
  });
  return { code, stdout, stderr };
}

export const MATH = 'export const add = (a: number, b: number): number => a + b;\n';

export const MATH_TEST = `import { expect, it } from 'vitest';
import { add } from './math';

it('adds', () => {
  expect(add(1, 2)).toBe(3);
  expect(add(-1, 1)).toBe(0);
});
`;

/** The same test with its second assertion deleted. */
export const MATH_TEST_WEAKENED = MATH_TEST.replace("  expect(add(-1, 1)).toBe(0);\n", '');

/** A repo whose `main` holds src/math.ts and its test, checked out on a new `feature` branch. */
export function mathRepo(): { repo: TestRepo; base: string } {
  const repo = makeRepo();
  repo.write('src/math.ts', MATH);
  repo.write('src/math.test.ts', MATH_TEST);
  const base = repo.commit('base');
  repo.git('checkout', '-q', '-b', 'feature');
  return { repo, base };
}
