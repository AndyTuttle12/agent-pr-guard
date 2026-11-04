import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildRegistry, evaluate, type Report, type RulePack } from '../../src/engine/engine.js';
import { loadConfigFromCommit } from '../../src/engine/config.js';
import { GitReader } from '../../src/git/reader.js';
import { ALL_PACKS } from '../../src/packs/index.js';
import { expectationMismatch, FIXTURES_ROOT, listFixtures, readTree, type Fixture } from '../helpers/fixtures.js';
import { cleanupTempDirs, makeRepo } from '../helpers/repo.js';

// The cases run concurrently, so each removes its own repo; afterAll catches any left behind.
afterAll(cleanupTempDirs);

/**
 * Commits a fixture's base/ tree, then replaces it with head/ in a second commit, and runs the
 * engine over the pair through GitReader: real rename detection, blob reads, binary detection
 * and the base-side config loader, with no `renames` hint.
 */
async function runFixtureThroughGit(fixture: Fixture, packs: readonly RulePack[]): Promise<Report> {
  const repo = makeRepo();
  const commitTree = (side: 'base' | 'head'): string => {
    repo.git('rm', '-r', '-q', '--ignore-unmatch', '--', '.');
    for (const [path, content] of readTree(join(fixture.dir, side))) repo.write(path, content);
    return repo.commit(side);
  };
  try {
    const base = commitTree('base');
    const head = commitTree('head');
    const reader = new GitReader({ repoDir: repo.dir });
    const changeSet = await reader.readChangeSet(base, head);
    const { config } = await loadConfigFromCommit(reader, changeSet.base, buildRegistry(packs));
    return evaluate(changeSet, config, packs);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
}

const fixtureDirs = readdirSync(FIXTURES_ROOT)
  .filter((name) => statSync(join(FIXTURES_ROOT, name)).isDirectory())
  .sort();

it('has a registered pack for every fixtures/ directory', () => {
  expect(fixtureDirs.filter((dir) => !ALL_PACKS.some((p) => p.id === dir))).toEqual([]);
});

for (const pack of ALL_PACKS.filter((p) => fixtureDirs.includes(p.id))) {
  describe.concurrent(`fixtures/${pack.id} through git`, () => {
    it.for(listFixtures(pack.id).map((f) => [f.name, f] as const))('%s', async ([, fixture], { expect: expectHere }) => {
      expectHere(expectationMismatch(fixture, await runFixtureThroughGit(fixture, [pack]))).toBeNull();
    });
  });
}
