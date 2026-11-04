import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConfigError,
  DEFAULT_CONFIG,
  GUARD_CONFIG_PATH,
  loadConfigFromCommit,
  loadConfigFromFile,
  parseGuardConfig,
  severityFor,
  type RuleRegistry,
} from '../../src/engine/config.js';
import { GitReader } from '../../src/git/reader.js';
import { cleanupTempDirs, makeRepo, makeTempDir } from '../helpers/repo.js';

afterEach(cleanupTempDirs);

const registry: RuleRegistry = {
  ruleIds: new Set(['skips/focused', 'skips/skipped', 'protected/guard-config']),
  packIds: new Set(['skips', 'protected']),
  locked: new Set(['protected/guard-config']),
  defaults: new Map([['skips/skipped', 'warning']]),
};

const parse = (value: unknown): ReturnType<typeof parseGuardConfig> =>
  parseGuardConfig(JSON.stringify(value), 'cfg', registry);

describe('parseGuardConfig', () => {
  it('accepts a full config', () => {
    expect(
      parse({
        $schema: 'x',
        version: 1,
        testPatterns: ['e2e/**/*.ts'],
        protectedPaths: ['fixtures/'],
        ignorePaths: ['vendor/'],
        rules: { skips: 'warning', 'skips/focused': 'error' },
      }),
    ).toEqual({
      testPatterns: ['e2e/**/*.ts'],
      protectedPaths: ['fixtures/'],
      ignorePaths: ['vendor/'],
      rules: { skips: 'warning', 'skips/focused': 'error' },
    });
    expect(parse({})).toEqual(DEFAULT_CONFIG);
  });

  it.each([
    ['not json', '{', /not valid JSON/],
    ['an array', '[]', /must be a JSON object/],
    ['an unknown key', '{"rule": {}}', /unknown key "rule"/],
    ['a bad version', '{"version": 2}', /version/],
    ['a non-array glob list', '{"testPatterns": "a"}', /must be an array/],
    ['an empty glob', '{"ignorePaths": [""]}', /non-empty/],
    ['an unknown rule', '{"rules": {"skips/nope": "off"}}', /unknown rule or pack/],
    ['a bad severity', '{"rules": {"skips": "warn"}}', /"off", "warning" or "error"/],
    ['a locked rule', '{"rules": {"protected/guard-config": "off"}}', /cannot be changed/],
    ['a __proto__ rule key', '{"rules": {"__proto__": "off"}}', /unknown rule or pack/],
  ])('rejects %s', (_label, text, message) => {
    expect(() => parseGuardConfig(text, 'cfg', registry)).toThrow(ConfigError);
    expect(() => parseGuardConfig(text, 'cfg', registry)).toThrow(message);
  });
});

describe('severityFor', () => {
  it('falls back to the rule default, then error, when config names neither the rule nor its pack', () => {
    expect(severityFor('skips/skipped', DEFAULT_CONFIG, registry)).toBe('warning');
    expect(severityFor('skips/focused', DEFAULT_CONFIG, registry)).toBe('error');
    expect(severityFor('skips/skipped', parse({ rules: { skips: 'error' } }), registry)).toBe('error');
    expect(severityFor('skips/skipped', parse({ rules: { 'skips/skipped': 'error' } }), registry)).toBe('error');
  });

  it('prefers the rule setting, then the pack setting, then error', () => {
    const config = parse({ rules: { skips: 'warning', 'skips/focused': 'off' } });
    expect(severityFor('skips/focused', config, registry)).toBe('off');
    expect(severityFor('skips/skipped', config, registry)).toBe('warning');
    expect(severityFor('protected/guard-config', config, registry)).toBe('error');
    expect(severityFor('protected/guard-config', DEFAULT_CONFIG, registry)).toBe('error');
  });

  it('never lets a pack setting turn off a locked rule', () => {
    const config = parse({ rules: { protected: 'off' } });
    expect(severityFor('protected/guard-config', config, registry)).toBe('error');
  });
});

describe('loading the config', () => {
  it('reads the config from the given commit, not from a later one', async () => {
    const r = makeRepo();
    r.write(GUARD_CONFIG_PATH, JSON.stringify({ rules: { skips: 'warning' } }));
    const base = r.commit('base');
    r.write(GUARD_CONFIG_PATH, JSON.stringify({ rules: { skips: 'off' } }));
    r.commit('head');
    const loaded = await loadConfigFromCommit(new GitReader({ repoDir: r.dir }), base, registry);
    expect(loaded.config.rules).toEqual({ skips: 'warning' });
    expect(loaded.source).toBe(`${base}:${GUARD_CONFIG_PATH}`);
  });

  it('uses the defaults when the commit has no config', async () => {
    const r = makeRepo();
    r.write('a.txt', 'a\n');
    const base = r.commit('base');
    const loaded = await loadConfigFromCommit(new GitReader({ repoDir: r.dir }), base, registry);
    expect(loaded).toEqual({ config: DEFAULT_CONFIG, source: 'defaults' });
  });

  it('fails on an invalid config in the commit', async () => {
    const r = makeRepo();
    r.write(GUARD_CONFIG_PATH, '{"rules": {"skips": "nope"}}');
    const base = r.commit('base');
    await expect(loadConfigFromCommit(new GitReader({ repoDir: r.dir }), base, registry)).rejects.toThrow(ConfigError);
  });

  it('reads a trusted file and fails on a missing one', async () => {
    const dir = makeTempDir();
    const path = join(dir, 'guard.json');
    writeFileSync(path, '{"ignorePaths": ["vendor/"]}');
    expect((await loadConfigFromFile(path, registry)).config.ignorePaths).toEqual(['vendor/']);
    await expect(loadConfigFromFile(join(dir, 'missing.json'), registry)).rejects.toThrow(/cannot read config/);
  });
});
