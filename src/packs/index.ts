import type { RulePack } from '../engine/engine.js';
import { assertionPack } from './assertion.js';
import { configPack } from './config.js';
import { enginePack } from './engine.js';
import { protectedPack } from './protected.js';
import { skipPack } from './skip.js';
import { testDeletionPack } from './test-deletion.js';

/** Every rule pack, in report order. */
export const ALL_PACKS: readonly RulePack[] = [enginePack, assertionPack, skipPack, testDeletionPack, configPack, protectedPack];
