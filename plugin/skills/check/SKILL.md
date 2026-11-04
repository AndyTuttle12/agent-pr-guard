---
name: check
description: Run agent-pr-guard on the current branch now, including uncommitted and untracked files, and report what it finds. Use when the user asks to check the branch with agent-pr-guard, or whether the change weakens tests, CI gates or guard config.
allowed-tools: ["Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/guard.mjs:*)"]
---

# agent-pr-guard check

The guard compared this branch with its merge base on the default branch. It is warn-only: it
reports findings and never fails or blocks anything unless the user opted in with
`AGENT_PR_GUARD_BLOCK=1`.

```!
node "${CLAUDE_PLUGIN_ROOT}/scripts/guard.mjs" check
```

Report the result above to the user:

- If it says nothing was checked, or that the check did not run, say why in one line. Do not try
  to work around it.
- Otherwise give the verdict and list each error finding with its file, line, rule and reason,
  then the warnings. Mention the uninspected files if there are any. Say these are findings to
  review, not proof of a problem: the guard has false positives, so a finding the user says is
  intended is not an error.
- Do not change any file because of this check unless the user asks you to. If they do, undo the
  weakening itself (restore the assertion, un-skip the test, put the file back); never edit the
  guard's config or move a file to get around a finding.
