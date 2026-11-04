import { describe, expect, it } from 'vitest';
import { assertAliases } from '../../src/packs/node-assert.js';

const aliases = (text: string): [string, string][] => [...assertAliases(text.split('\n'))].sort(([a], [b]) => a.localeCompare(b));

describe('assertAliases', () => {
  it('reads default, namespace and named imports of every assert module spelling', () => {
    expect(aliases("import assert from 'node:assert';")).toEqual([['assert', 'assert']]);
    expect(aliases('import * as check from "assert/strict";')).toEqual([['check', 'assert']]);
    expect(aliases("import { strict as assert } from 'node:assert';")).toEqual([['assert', 'assert']]);
    expect(aliases("import nodeAssert, { deepStrictEqual as same, ok } from 'node:assert/strict';")).toEqual([
      ['nodeAssert', 'assert'],
      ['ok', 'assert.ok'],
      ['same', 'assert.deepStrictEqual'],
    ]);
  });

  it('reads an import that spans lines', () => {
    expect(aliases("import {\n  equal,\n  match as like,\n} from 'assert';")).toEqual([
      ['equal', 'assert.equal'],
      ['like', 'assert.match'],
    ]);
  });

  it('reads require calls, plain and destructured', () => {
    expect(aliases("const assert = require('assert');")).toEqual([['assert', 'assert']]);
    expect(aliases("const { equal: eq, throws } = require('node:assert').strict;")).toEqual([
      ['eq', 'assert.equal'],
      ['throws', 'assert.throws'],
    ]);
  });

  it('ignores type-only imports, non-check exports and other modules', () => {
    expect(aliases("import type { AssertionError } from 'node:assert';")).toEqual([]);
    expect(aliases("import { AssertionError, ok } from 'node:assert';")).toEqual([['ok', 'assert.ok']]);
    expect(aliases("import { ok } from './assert';\nimport { equal } from 'chai';\nimport assert from 'power-assert';")).toEqual([]);
  });
});
