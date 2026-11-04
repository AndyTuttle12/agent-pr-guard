import { describe, expect, it } from 'vitest';
import type { RulePack } from '../../src/engine/engine.js';
import { expectationMismatch, listFixtures, runFixtureInMemory } from './fixtures.js';

/**
 * Runs every fixture in `fixtures/<pack.id>/` through that pack alone, and checks that each rule
 * has fixtures in both directions: `<rule>-flags-*` expects the rule to fire, and
 * `<rule>-passes-*` is an honest change it must not flag.
 */
export function describePackFixtures(pack: RulePack): void {
  const fixtures = listFixtures(pack.id);

  describe(`${pack.id} pack fixtures`, () => {
    for (const fixture of fixtures) {
      it(`${fixture.name}: ${fixture.description}`, () => {
        expect(expectationMismatch(fixture, runFixtureInMemory(fixture, [pack]))).toBeNull();
      });
    }
  });

  describe(`${pack.id} pack fixture coverage`, () => {
    for (const rule of pack.rules) {
      const short = rule.id.slice(pack.id.length + 1);
      const leaf = (name: string): string => name.slice(pack.id.length + 1);
      it(`${rule.id} has a flagging and a passing fixture`, () => {
        const flags = fixtures.filter((f) => leaf(f.name).startsWith(`${short}-flags-`));
        const passes = fixtures.filter((f) => leaf(f.name).startsWith(`${short}-passes-`));
        expect(flags.length).toBeGreaterThan(0);
        expect(passes.length).toBeGreaterThan(0);
        for (const f of flags) expect(f.findings.some((x) => x.ruleId === rule.id), f.name).toBe(true);
        for (const f of passes) expect(f.findings.some((x) => x.ruleId === rule.id), f.name).toBe(false);
      });
    }
  });
}
