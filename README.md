# agent-pr-guard

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**Warn-only by default.** agent-pr-guard reads a pull request's diff and flags a change that
weakens what judges it: removed or loosened assertions, skipped or focused tests, deleted test
files, relaxed config (a lowered coverage floor, a disabled lint rule, a dropped or softened CI
gate, a suppression comment), edits to protected paths, and edits to the guard's own config. It
prints what it found and exits 0. Nothing it does can fail a PR, a CI job or an agent's session
unless you opt in (see [Blocking](#blocking-is-opt-in)).

It is deterministic: no AI, no network and no code from the repository runs. Its config is read
from the base branch, so a PR cannot relax its own judge.

This project is parked: it is published as open source, and it is not being developed further.
The checks are heuristics and they have false positives; read [the numbers](#the-numbers) before
you rely on a finding.

```text
agent-pr-guard: 9d151a5a9da4..2a1c45254a84 (base 9d151a5a9da4), config: defaults

CODEOWNERS
  file      warning protected/path: protected path CODEOWNERS (CODEOWNERS) was added

src/math.test.ts
  line 6    error   assertion/removed: 1 assertion removed (2 before, 1 after)

FINDINGS (warn-only, exit 0): 1 error, 1 warning in 2 files. Pass --fail-on error to exit 1 on these.
```

Needs Node 22.12 or newer and git 2.32 or newer. It is not published to npm: use the
[GitHub Action](#github-action), or run it from a clone (below).

## The numbers

Measured on public pull requests written by coding agents; the full write-up, method and caveats
are in [docs/STUDY.md](docs/STUDY.md).

- **Base rate: about 0.3% (2 of 763)** of public agent PRs in the fresh sample weaken their own
  tests. Most agent PRs do not.
- **Precision is low.** On the fresh sample the guard flagged 10 PRs (1.3%). A blind review of
  those found 2 true, 3 arguable and 5 false: 20% strict precision (CI 6-51%), 50% lenient.
- **It was tuned on the first sample and that did not carry over.** Tuning reached 0 false
  positives in-sample; on PRs it had not seen, half the flags or more were not real.
- **The biggest remaining false-positive class** is tests removed along with the feature they
  tested (3 of the 5 false flags).

One rater, small samples, labels written before any rates were computed. Treat a finding as "look
at this", not as proof.

## What it catches

One example per rule pack. Every rule is an error unless your config says otherwise.

| Pack | Example | Rules |
|---|---|---|
| `assertion` | `expect(cart.count()).toBe(2)` deleted, `toEqual(x)` changed to `toBeDefined()`, `toBeCloseTo(x, 4)` lowered to `toBeCloseTo(x, 1)` | `assertion/removed`, `assertion/loosened`, `assertion/tolerance-widened` |
| `skip` | `it(` changed to `it.skip(`, `xit(`, `.only`, `@pytest.mark.skip`, `t.Skip()`, a test commented out, `test_x` renamed to `_test_x`, a Go `//go:build` tag that keeps the file out of `go test` | `skip/skipped`, `skip/focused`, `skip/todo`, `skip/commented-out`, `skip/renamed-out`, `skip/build-tag` |
| `test-deletion` | `src/math.test.ts` deleted, or renamed to `src/math.test.ts.disabled` so the runner stops collecting it | `test-deletion/deleted`, `test-deletion/moved-out` |
| `config` | a coverage floor lowered from 90 to 60, `F401` added to ruff's `ignore`, `vendor/` added to `.eslintignore`, `mypy.ini` deleted, the `npm test` step dropped from CI, `continue-on-error: true` on it, `// @ts-ignore` or a bare `# noqa` added in the code | `config/threshold-lowered`, `config/rule-disabled`, `config/ignore-grown`, `config/file-deleted`, `config/gate-removed`, `config/gate-softened`, `config/inline-suppression` |
| `protected` | `CODEOWNERS` edited (root, `docs/`, `.github/`, `.gitlab/` or `.gitea/`), a golden file under your `protectedPaths` changed, `.agent-pr-guard.json` changed; a new file at a protected path (a first CODEOWNERS, a new golden file) is a warning | `protected/path`, `protected/guard-config` (always an error) |
| `engine` | a test or CI file changed into a binary or a file too large to read: it is reported, never skipped unread | `engine/uninspected` |

Honest changes are not flagged: an assertion moved to another test file, a test file renamed within the
runner's patterns, a test deleted together with the code it tests (reported as a warning, since a
reviewer can tell a retired feature from a hidden failure and the guard cannot).

Honest config changes are not flagged either: a raised floor, a lint tool swapped for another of
the same kind, a gate moved to another workflow, `# noqa` narrowed to `# noqa: E501`. With
`config/inline-suppression` raised to an error, a suppression comment that gives its reason
(`// eslint-disable-next-line no-console -- CLI output`) stays a warning, except `@ts-nocheck`,
which hides a whole file.

Rules have a severity, error or warning, that matters once you opt in to blocking (and for how
the report reads). The config rules that a spot-check of real agent PRs found
often wrong (`config/rule-disabled`, `config/ignore-grown`, `config/file-deleted`,
`config/gate-removed`, `config/inline-suppression`) are warnings unless your config raises them;
`config/gate-softened`, `config/threshold-lowered` and every other rule are errors. Set
`"config": "error"` to make the whole pack report as errors.

## Quick start

### GitHub Action

The repository is a JavaScript action (Node 24). It runs the check on the pull request, annotates
each finding on the changed lines, and writes a summary table to the job page. By default it only
reports: error findings are annotated as warnings and the step passes.

```yaml
name: agent-pr-guard
on: pull_request
permissions:
  contents: read
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: AndyTuttle12/agent-pr-guard@main
```

It fetches the history it needs back to the branch point itself, so the default shallow checkout
is enough; that `git fetch` from your own `origin` is its only network use. Free, no account, no
token beyond the checkout's.

| Input | Default | Meaning |
|---|---|---|
| `base` | the PR's base commit | The commit or branch the PR targets. Required outside `pull_request` events. |
| `head` | the PR's head commit | The PR's tip. Required outside `pull_request` events. |
| `fail-on` | `none` | `error` fails the step on an error finding; `warning` also fails it on warnings. `none` never fails on a finding. |
| `config` | none | A trusted config file outside the checked repository, instead of the base branch's `.agent-pr-guard.json`. |
| `path` | the workspace | The repository to check, when it is checked out into a subdirectory (needed for `config`). |

Outputs: `verdict` (`pass`, `fail`, or `error` when the check could not run), `errors`, `warnings`.
`verdict` describes the findings, so it is `fail` when there is an error finding even though the
step passes under `fail-on: none`. A check that could not run fails the step whatever `fail-on` is.

### CLI, from a clone

```sh
git clone https://github.com/AndyTuttle12/agent-pr-guard
cd agent-pr-guard && npm install && npm run build
node dist/cli.js check --base origin/main --repo path/to/your/repo
```

`--head` defaults to `HEAD`, and `--repo` to the current directory. Add `--fail-on error` to make
the command exit 1 on an error finding, for example in a pre-push hook or a CI step you choose to
make blocking.

### CI

GitLab CI, in a merge request pipeline (the checkout needs the history back to the branch point,
and `agent-pr-guard` is run from a clone of this repository as above):

```yaml
agent-pr-guard:
  image: node:24
  variables:
    GIT_DEPTH: 0
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - git fetch origin "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
    - git clone --depth 1 https://github.com/AndyTuttle12/agent-pr-guard /tmp/guard
    - (cd /tmp/guard && npm install && npm run build)
    - node /tmp/guard/dist/cli.js check --base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" --head "$CI_COMMIT_SHA"
```

Any other CI works the same way: fetch the target branch, then run `check` with it as `--base`.

## Blocking is opt-in

Everything above reports and lets the work go ahead. To make it block:

- **CLI:** `--fail-on error` (exit 1 on an error finding) or `--fail-on warning` (also on warnings).
- **Action:** `fail-on: error` or `fail-on: warning`.
- **Claude Code Stop hook:** set `AGENT_PR_GUARD_BLOCK=1` (or `true`) in the environment you start
  Claude Code from.

Given the numbers above, if you block, expect to be overruled by a human often: about half of what
it flagged in the fresh sample, or more, was not a real weakening.

## Claude Code plugin

`plugin/` is a Claude Code plugin that runs the same check while an agent works. It is not in a
marketplace; load it from a clone for a session:

```sh
claude --plugin-dir path/to/agent-pr-guard/plugin
```

The plugin carries its own bundled code (`plugin/scripts/guard.mjs`), so nothing is installed,
but it needs `node` 22.12 or newer on the `PATH` Claude Code runs hooks with.

**The Stop hook.** When the agent stops, the hook checks the branch against its merge base with
the default branch, counting uncommitted and untracked files: it snapshots the working tree into a
throwaway commit through a temporary index, so your index, branches and files are never written.
By default it is warn-only: on an error finding it shows you a message listing the findings and the
stop goes ahead. With `AGENT_PR_GUARD_BLOCK=1` it instead blocks the stop once and hands the agent
the findings, asking it to undo them or to tell you why one is intended. Warnings never block. A
pass, or a directory that is not a git repository, lets the stop go ahead silently.

**The check skill.** `/agent-pr-guard:check` runs the same check on demand and reports the verdict
and every finding. It changes no file unless you ask.

**`AGENT_PR_GUARD_BASE`.** The default branch is the one `origin/HEAD` names, else the first of
`origin/main`, `origin/master`, `main` and `master` that exists. To compare with another branch,
set it in the environment you start Claude Code from, for example
`AGENT_PR_GUARD_BASE=origin/develop`.

Limits:

- **It is local.** It runs on the agent's machine, where it can be disabled. Run the
  [GitHub Action](#github-action) (or the CLI in CI) on the PR to see the same findings there.
- **With blocking on, it blocks once, then lets the stop go ahead.** If the findings are still
  there when the agent stops again, the stop goes ahead and you see what is left, so a finding the
  agent should not fix never traps the session in a loop.
- **It fails open.** When the check cannot run (no default branch found, no shared history, a git
  error, more than 25 s), the stop goes ahead with a message saying the check did not run.
- **Ignored files are not checked.** The snapshot takes what `git add --all` would, so a file your
  `.gitignore` or global excludes match is not seen.
- **It needs `node` on the `PATH`.** Without it the hook cannot start, and it does not block.
- **Snapshot commits stay in the object store until gc.** A check with uncommitted changes writes
  a commit (and the changed files' blobs) that no branch or ref points at; `git gc` prunes them.
  The same tree on the same HEAD gives the same commit, so repeated stops do not pile them up.

## Usage

```text
agent-pr-guard check --base <rev> [--head <rev>] [--fail-on <none|error|warning>] [--json] [--config <file>] [--repo <path>]
```

| Option | Meaning |
|---|---|
| `--base <rev>` | The branch the PR targets: a branch, tag or commit. Required. |
| `--head <rev>` | The PR's tip. Default `HEAD`. |
| `--fail-on <level>` | Exit 1 when a finding reaches this level: `none` (the default, warn-only), `error`, or `warning`. |
| `--json` | Print the report as JSON (below). |
| `--config <file>` | A trusted config file outside the repository, used instead of the base branch's `.agent-pr-guard.json`. |
| `--repo <path>` | The repository to check. Default: the current directory. |

The diff is `merge-base(base, head)..head`, the same view a forge shows for a PR, so commits that
landed on the base branch after the PR branched are never blamed on it.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | The check ran and no finding reached `--fail-on`. With the default `--fail-on none` that is always the case: findings are printed and the exit stays 0. |
| 1 | At least one finding reached `--fail-on` (`error`: an error finding; `warning`: any finding). Never returned with the default. |
| 2 | Usage or internal error: bad arguments, a revision that does not resolve, an invalid config, not a git repository. The check did not run, so it did not pass. |

### JSON output

`verdict` is `fail` when there is an error finding, whatever `--fail-on` is; the exit code is what
`--fail-on` controls.

```json
{
  "version": 1,
  "base": "<full commit id>",
  "head": "<full commit id>",
  "mergeBase": "<full commit id>",
  "config": "defaults",
  "verdict": "fail",
  "errors": 1,
  "warnings": 0,
  "findings": [
    { "ruleId": "assertion/removed", "severity": "error", "file": "src/math.test.ts", "line": 6, "reason": "1 assertion removed (2 before, 1 after)" }
  ],
  "uninspected": [{ "file": "assets/logo.png", "reason": "binary" }]
}
```

`line` is a line in the head-side file, or `null` for a finding about the whole file. `config`
is `defaults`, `<base commit>:.agent-pr-guard.json`, or the `--config` path. `uninspected` lists
every changed file whose content was not read (`binary`, `too-large`, `submodule`). On exit 2,
`--json` prints `{ "version": 1, "verdict": "error", "error": "<message>" }`. Fields may be
added within version 1; removing or redefining one bumps the version.

## Config

`.agent-pr-guard.json` at the repository root. It is read from the base branch's tip, never from
the PR, and any change the PR makes to it is itself an error (`protected/guard-config`).

```json
{
  "version": 1,
  "testPatterns": ["e2e/**/*.cy.ts"],
  "protectedPaths": ["fixtures/golden/", "**/__snapshots__/"],
  "ignorePaths": ["vendor/"],
  "rules": {
    "skip/todo": "warning",
    "assertion/tolerance-widened": "off"
  }
}
```

| Key | Meaning |
|---|---|
| `version` | Optional; must be `1`. |
| `testPatterns` | Globs added to the built-in test-file patterns (`*.test.*`, `*.spec.*`, `__tests__/`, `test/`, `test_*.py`, `*_test.py`, `tests.py`, `*_test.go`). |
| `protectedPaths` | Globs the PR must not touch, added to the built-in CODEOWNERS locations. |
| `ignorePaths` | Globs no rule inspects, except the protected-path rules: an ignore never lifts a protection. |
| `rules` | `"off"`, `"warning"` or `"error"` per rule id or pack id; a rule id beats its pack. An unlisted rule takes its default (an error, or a warning for the config rules named above). `protected/guard-config` cannot be changed. |

Globs: `*` stays within a path segment, `**` crosses segments, a pattern with no `/` matches the
file name at any depth, one with a `/` is anchored at the root, and a trailing `/` means
everything below that directory.

An unknown key, rule id or severity is an error (exit 2), never ignored. With `--config`, the
named file replaces the base config entirely. It must sit outside the repository being checked,
because a file inside it is the PR's own copy.

## Contributing a fixture

Every rule is proven by fixtures: a small before and after of a real-looking change.

```text
fixtures/<pack>/<case>/
  base/           the files before the PR (and .agent-pr-guard.json, if the case needs config)
  head/           the files after the PR
  expected.json   { "description": "...", "findings": [{ "ruleId": "...", "file": "...", "line": 6, "severity": "error" }] }
```

- Name the case for the rule and the direction. The `assertion` and `skip` packs use
  `<rule>-flags-<case>` and `<rule>-passes-<case>`; the others use `<rule>.flag.<case>` and
  `<rule>.pass.<case>`. Every rule needs at least one of each: a cheat it must catch and an honest
  change it must let through.
- `findings` must list every finding exactly; `line` and `severity` are optional per entry.
- If the case is a rename, add `"renames": { "old/path": "new/path" }` so the in-memory runner
  knows what git will detect.
- `npm test` runs each fixture twice: in memory through the pack, and through real git (a
  throwaway repo with base and head committed, read by the same reader the CLI uses).

## License

[Apache-2.0](LICENSE).
