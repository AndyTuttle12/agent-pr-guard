import type { RuleHit } from '../engine/finding.js';
import type { RulePack } from '../engine/engine.js';
import { configFileInfo } from '../engine/config-files.js';
import type { AnalyzedFile } from '../engine/analyze.js';

const REASONS = {
  binary: 'is binary, so its content was not checked',
  'too-large': 'is larger than the read limit, so its content was not checked',
  submodule: 'is a submodule, so its content was not checked',
} as const;

function kindOf(file: AnalyzedFile): string | null {
  if (file.oldIsTest || file.newIsTest) return 'test file';
  const info = [file.newPath, file.oldPath].map((p) => (p === null ? null : configFileInfo(p))).find((i) => i != null);
  if (info === undefined || info === null) return null;
  return info.category === 'ci' || info.category === 'hooks' ? 'CI file' : 'config file';
}

/**
 * The guard never reports a pass it could not compute: a test, CI or config file it could not
 * read is a finding, not a silent skip.
 */
export const enginePack: RulePack = {
  id: 'engine',
  rules: [{ id: 'engine/uninspected', summary: 'A test, CI or config file changed but its content could not be read.' }],
  check({ files }) {
    const hits: RuleHit[] = [];
    for (const file of files) {
      if (file.uninspected === null) continue;
      const kind = kindOf(file);
      if (kind === null) continue;
      hits.push({ ruleId: 'engine/uninspected', file: file.path, line: null, reason: `${kind} ${REASONS[file.uninspected]}` });
    }
    return hits;
  },
};
