import { appendFileSync } from 'node:fs';
import { runCli } from '../cli/run.js';
import { ensureHistory, gitIn, type Git } from './history.js';
import { checkArgv, InputError, parseActionInputs, type ActionInputs } from './inputs.js';
import { parseCliJson, type CheckOutcome } from '../cli/json-outcome.js';
import { annotations, escapeData, outputs, renderSummary, shouldFail } from './summary.js';

export interface ActionIo {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  /** Workflow commands and log lines go to stdout, where the runner reads them. */
  readonly stdout: (text: string) => void;
  readonly appendFile: (path: string, text: string) => void;
  readonly git?: (repoDir: string) => Git;
}

/** Runs the action and returns the process exit code: 1 when the step should fail, else 0. */
export async function runAction(io: ActionIo): Promise<number> {
  let inputs: ActionInputs;
  try {
    inputs = parseActionInputs(io.env, io.cwd);
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    return finish(io, { kind: 'error', message: error.message }, 'error');
  }
  const git = (io.git ?? ((dir) => gitIn(dir, io.env)))(inputs.repoDir);
  for (const warning of await ensureHistory(git, inputs.base, inputs.head)) io.stdout(`::warning title=agent-pr-guard::${escapeData(warning)}\n`);

  let stdout = '';
  let stderr = '';
  await runCli(checkArgv(inputs), {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd: inputs.workspace,
    version: 'action',
    env: io.env,
  });
  return finish(io, parseCliJson(stdout, stderr), inputs.failOn);
}

function finish(io: ActionIo, outcome: CheckOutcome, failOn: ActionInputs['failOn']): number {
  if (outcome.kind === 'report') for (const line of annotations(outcome.report.findings, failOn)) io.stdout(`${line}\n`);
  const summaryFile = io.env['GITHUB_STEP_SUMMARY'];
  if (summaryFile !== undefined && summaryFile !== '') io.appendFile(summaryFile, renderSummary(outcome, failOn));
  const outputFile = io.env['GITHUB_OUTPUT'];
  if (outputFile !== undefined && outputFile !== '') io.appendFile(outputFile, outputs(outcome));
  if (!shouldFail(outcome, failOn)) return 0;
  const why =
    outcome.kind === 'error'
      ? `the check could not run: ${outcome.message}`
      : `${outcome.report.errors} error and ${outcome.report.warnings} warning findings (fails on ${failOn})`;
  io.stdout(`::error title=agent-pr-guard::${escapeData(`agent-pr-guard failed: ${why}`)}\n`);
  return 1;
}

/** The bundled entry point (`action/dist/index.mjs`). */
export async function main(): Promise<void> {
  try {
    process.exitCode = await runAction({
      env: process.env,
      cwd: process.cwd(),
      stdout: (text) => process.stdout.write(text),
      appendFile: (path, text) => appendFileSync(path, text, 'utf8'),
    });
  } catch (error) {
    process.stdout.write(`::error title=agent-pr-guard::${escapeData(`internal error: ${error instanceof Error ? error.message : String(error)}`)}\n`);
    process.exitCode = 1;
  }
}
