import type { RulePack } from '../engine/engine.js';
import { configFiles } from './config-model.js';
import { fileDeletedHits, gateRemovedHits } from './config-removed.js';
import { ignoreGrownHits, ruleDisabledHits, thresholdHits } from './config-settings.js';
import { gateSoftenedHits } from './config-softened.js';
import { inlineSuppressionHits } from './config-suppression.js';

/**
 * Lint, type-check, coverage, test-runner, CI and hook configuration that the change relaxes, in
 * config files or in suppression comments in the code. A config file with a side the reader could
 * not open is never compared; `engine/uninspected` reports it instead.
 */
export const configPack: RulePack = {
  id: 'config',
  rules: [
    {
      id: 'config/threshold-lowered',
      summary: 'A coverage floor was lowered or removed, or a lint limit (max-len, --max-warnings, codecov threshold) was raised.',
      defaultSeverity: 'error',
    },
    {
      id: 'config/rule-disabled',
      summary:
        'A lint or type-check rule was turned down or off, a strict flag was turned off, a skip flag was turned on, codes were added to an ignore list, or an enable/select/extends list shrank.',
      defaultSeverity: 'warning',
    },
    {
      id: 'config/ignore-grown',
      summary: 'A config file, ignore file or --ignore flag excludes more paths than before.',
      defaultSeverity: 'warning',
    },
    {
      id: 'config/file-deleted',
      summary: 'A lint, type-check, coverage or test-runner config was deleted and no config for the same tool replaces it; a runner config deleted with its runner, which another runner replaced, passes.',
      defaultSeverity: 'warning',
    },
    {
      id: 'config/gate-removed',
      summary:
        'Fewer test, lint or type-check commands run across CI, hooks, Makefiles, package.json scripts, tox and shell scripts; swapping one tool for another of the same kind passes, and fewer test commands in a test-runner migration is a warning at most.',
      defaultSeverity: 'warning',
    },
    {
      id: 'config/gate-softened',
      summary:
        'A test, lint or type-check command can no longer fail the build: continue-on-error, allow_failure or if: false on its step or job, `|| true` on its line, a Makefile `-` prefix, or its workflow no longer runs on push or pull_request.',
      defaultSeverity: 'error',
    },
    {
      id: 'config/inline-suppression',
      summary:
        'A suppression comment was added, widened or moved onto other code: eslint-disable, @ts-ignore, @ts-expect-error, @ts-nocheck, type: ignore, pylint: disable, noqa, nolint, pragma: no cover, istanbul, c8 or v8 ignore; or an eslint-enable was removed so a disable block runs on. A warning by default (D15); raised to error, one that gives a reason stays a warning, except a type checker turned off for a whole file.',
      defaultSeverity: 'warning',
    },
  ],
  check({ files }) {
    const configs = configFiles(files);
    return [...thresholdHits(configs), ...ruleDisabledHits(configs), ...ignoreGrownHits(configs), ...fileDeletedHits(files, configs), ...gateRemovedHits(files, configs), ...gateSoftenedHits(files, configs), ...inlineSuppressionHits(files)];
  },
};
