import { describe, expect, it } from 'vitest';
import { configFileInfo } from '../../src/engine/config-files.js';
import { enginePack } from '../../src/packs/engine.js';
import { describeFixtures } from './fixture-suite.js';

describeFixtures('engine', enginePack);

describe('configFileInfo', () => {
  it.each([
    ['.github/workflows/ci.yml', 'github-actions', 'ci', 'yaml'],
    ['Makefile', 'make', 'ci', 'make'],
    ['.husky/pre-commit', 'husky', 'hooks', 'shell'],
    ['packages/web/.eslintrc', 'eslint', 'lint', 'json'],
    ['eslint.config.mjs', 'eslint', 'lint', 'js'],
    ['.eslintrc.yml', 'eslint', 'lint', 'yaml'],
    ['.eslintignore', 'eslint', 'lint', 'lines'],
    ['tsconfig.build.json', 'tsconfig', 'type', 'json'],
    ['setup.cfg', 'setup-cfg', 'project', 'ini'],
    ['pyproject.toml', 'pyproject', 'project', 'toml'],
    ['.golangci.yml', 'golangci', 'lint', 'yaml'],
    ['codecov.yml', 'codecov', 'coverage', 'yaml'],
    ['vitest.config.ts', 'vitest', 'test-runner', 'js'],
    ['apps/api/package.json', 'package-json', 'project', 'json'],
  ])('classifies %s', (path, family, category, format) => {
    expect(configFileInfo(path)).toEqual({ family, category, format });
  });

  it.each(['src/index.ts', 'node_modules/x/package.json', 'docs/ci.yml', 'src/workflows/ci.yml'])('ignores %s', (path) => {
    expect(configFileInfo(path)).toBeNull();
  });
});
