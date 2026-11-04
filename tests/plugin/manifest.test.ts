import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHECK_TIMEOUT_MS } from '../../src/plugin/guard.js';

const ROOT = join(import.meta.dirname, '..', '..');
const PLUGIN = join(ROOT, 'plugin');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`expected an object holding ${key}`);
  return (value as Record<string, unknown>)[key];
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('expected an array');
  return value;
}

/** `${CLAUDE_PLUGIN_ROOT}` resolved against this repo's plugin directory. */
function inPlugin(path: string): string {
  expect(path.startsWith('${CLAUDE_PLUGIN_ROOT}/')).toBe(true);
  return join(PLUGIN, path.slice('${CLAUDE_PLUGIN_ROOT}/'.length));
}

describe('plugin manifest', () => {
  it("has package.json's name and version", () => {
    const plugin = readJson(join(PLUGIN, '.claude-plugin', 'plugin.json'));
    const pkg = readJson(join(ROOT, 'package.json'));
    expect(field(plugin, 'version')).toBe(field(pkg, 'version'));
    expect(field(plugin, 'name')).toBe(field(pkg, 'name'));
  });
});

describe('hooks.json', () => {
  const hooks = field(readJson(join(PLUGIN, 'hooks', 'hooks.json')), 'hooks');

  it('registers only the Stop hook', () => {
    expect(Object.keys(hooks as object)).toEqual(['Stop']);
  });

  const groups = list(field(hooks, 'Stop'));
  const handlers = groups.flatMap((group) => list(field(group, 'hooks')));

  it('runs node in exec form with a 30 s timeout, longer than the check deadline', () => {
    expect(groups).toHaveLength(1);
    expect(field(groups[0], 'matcher')).toBeUndefined();
    expect(handlers).toHaveLength(1);
    const handler = handlers[0];
    expect(field(handler, 'type')).toBe('command');
    expect(field(handler, 'command')).toBe('node');
    expect(list(field(handler, 'args'))).toEqual(['${CLAUDE_PLUGIN_ROOT}/scripts/guard.mjs', 'stop']);
    expect(field(handler, 'timeout')).toBe(30);
    expect(CHECK_TIMEOUT_MS).toBeLessThan(30_000);
  });

  it('points at a script that exists and is executable', () => {
    const script = inPlugin(String(list(field(handlers[0], 'args'))[0]));
    expect(existsSync(script)).toBe(true);
    expect(statSync(script).mode & 0o111).not.toBe(0);
  });
});

describe('check skill', () => {
  it('runs the same script that exists', () => {
    const skill = readFileSync(join(PLUGIN, 'skills', 'check', 'SKILL.md'), 'utf8');
    const command = /```!\n(.*)\n```/.exec(skill)?.[1];
    expect(command).toBe('node "${CLAUDE_PLUGIN_ROOT}/scripts/guard.mjs" check');
    expect(existsSync(inPlugin('${CLAUDE_PLUGIN_ROOT}/scripts/guard.mjs'))).toBe(true);
  });
});
