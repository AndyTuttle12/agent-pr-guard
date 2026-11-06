# agent-pr-guard (Claude Code plugin)

Coding agents sometimes make a failing check pass by weakening the check instead of fixing the
code: they delete an assertion, skip a test, lower a coverage floor, or drop a CI gate. This
plugin looks for that when Claude Code stops, and tells you.

It is deterministic: no AI, no network, and no code from your repository is run. It is **warn-only
by default**: it shows you a message and the stop goes ahead.

## What it does

- **Stop hook.** When the agent stops, the hook compares the branch (including uncommitted and
  untracked files) with its merge base on the default branch and lists what weakened the tests,
  gates or config that judge the work. It never changes your files, index, branches or refs.
- **`/agent-pr-guard:check` skill.** Runs the same check on demand and reports every finding.
  It changes no file unless you ask.
- **Opt-in blocking.** Start Claude Code with `AGENT_PR_GUARD_BLOCK=1` and the hook blocks the stop
  once, handing the agent the findings so it can undo them. A second stop always goes ahead.
- **Fails open.** If the check cannot run (no default branch, no `node`, more than 25 seconds),
  the stop goes ahead with a message saying the check did not run.

## Install

```text
/plugin marketplace add AndyTuttle12/agent-pr-guard
/plugin install agent-pr-guard@agent-pr-guard
```

Needs `node` 22.12 or newer and `git` 2.32 or newer on the `PATH` Claude Code runs hooks with.
The plugin ships its own bundled code (`scripts/guard.mjs`); nothing is installed at run time.

## What it reads, writes and sends

| | |
|---|---|
| **Reads** | The Stop hook's input from Claude Code (the working directory and a loop flag). The repository's git data: the diff between the merge base and your working tree, and the content of changed files and of the guard's own `.agent-pr-guard.json` as it is on the base branch. The environment variables `AGENT_PR_GUARD_BASE`, `AGENT_PR_GUARD_BLOCK` and `CLAUDE_PROJECT_DIR`; the rest of the environment is passed on to `git` only. |
| **Writes** | A temporary directory named `agent-pr-guard-*` in your OS temp directory, holding a copy of your git index; it is deleted when the check ends. A throwaway snapshot commit and the blobs of changed files in `.git/objects`, which no branch points at and `git gc` prunes. Nothing else. |
| **Sends** | Nothing. It makes no network request and has no telemetry or analytics. Every `git` call runs with `protocol.allow=never`, git hooks off and no credential helper. |

What leaves your machine is only what Claude Code itself sends. In blocking mode, and in the output of
the `/agent-pr-guard:check` skill, the findings (file path, line, rule and a short reason; some reasons name a test title,
a config key or an ignored path) become part of the conversation Claude Code sends to the model.
In the default warn-only mode the message is shown to you.

There is no account, no sign-in, and no server run by the author.

## Limits

The checks are heuristics and they have false positives: about half of what it flagged in the
author's measured sample was not a real weakening. Read a finding as something to review, not as
proof. It runs on the agent's machine, where it can be disabled; run the GitHub Action in this
repository on the pull request to see the same findings there. Ignored files are not checked.

## Support and security

- Questions and bug reports: [GitHub Issues](https://github.com/AndyTuttle12/agent-pr-guard/issues).
  Support is best effort.
- Security reports: privately, as described in
  [SECURITY.md](https://github.com/AndyTuttle12/agent-pr-guard/blob/main/SECURITY.md). Do not open a
  public issue for a security problem.
- Method and numbers behind the rules:
  [docs/STUDY.md](https://github.com/AndyTuttle12/agent-pr-guard/blob/main/docs/STUDY.md).

Licensed under Apache-2.0.
