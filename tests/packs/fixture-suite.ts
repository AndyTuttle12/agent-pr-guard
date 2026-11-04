import { describe, expect, it } from 'vitest';
import type { RulePack } from '../../src/engine/engine.js';
import { expectationMismatch, listFixtures, runFixtureInMemory } from '../helpers/fixtures.js';

/**
 * Runs every fixture in `fixtures/<dir>/` through `packs`, and checks that each rule of `pack` has
 * fixtures in both directions: a case named `<rule>.flag.<case>` that expects the rule, and one
 * named `<rule>.pass.<case>` (an honest change) that expects no finding from it.
 */
export function describeFixtures(dir: string, pack: RulePack, packs: readonly RulePack[] = [pack]): void {
  const fixtures = listFixtures(dir);
  describe(`fixtures/${dir}`, () => {
    it.each(fixtures.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
      expect(expectationMismatch(fixture, runFixtureInMemory(fixture, packs))).toBeNull();
    });

    it.each(pack.rules.map((r) => [r.id] as const))('has flag and pass fixtures for %s', (ruleId) => {
      const name = ruleId.slice(ruleId.indexOf('/') + 1);
      const cases = (direction: string) => fixtures.filter((f) => f.name.startsWith(`${dir}/${name}.${direction}.`));
      const flags = cases('flag');
      const passes = cases('pass');
      expect(flags.length, `${ruleId} needs a ${name}.flag.* fixture`).toBeGreaterThan(0);
      expect(passes.length, `${ruleId} needs a ${name}.pass.* fixture`).toBeGreaterThan(0);
      for (const f of flags) expect(f.findings.some((x) => x.ruleId === ruleId), f.name).toBe(true);
      for (const f of passes) expect(f.findings.some((x) => x.ruleId === ruleId), f.name).toBe(false);
    });
  });
}
