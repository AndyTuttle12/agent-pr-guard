import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parseGuardConfig } from '../src/engine/config.js';
import { buildRegistry } from '../src/engine/engine.js';
import { ALL_PACKS } from '../src/packs/index.js';

const README = readFileSync(join(import.meta.dirname, '..', 'README.md'), 'utf8');

it('the README config example is a valid config', () => {
  const section = README.slice(README.indexOf('\n## Config\n'));
  const example = /```json\n([\s\S]*?)```/.exec(section)?.[1];
  expect(example).toBeDefined();
  const config = parseGuardConfig(example ?? '', 'README.md', buildRegistry(ALL_PACKS));
  expect(Object.keys(config.rules).length).toBeGreaterThan(0);
});
