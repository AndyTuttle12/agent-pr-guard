# Decision log

Every dependency and every load-bearing design choice, with the comparison behind it. Rules for
adding a dependency come from the author's stack guide: compare security record, popularity, performance, integrations, maintenance
and community before the first install, and record the pick here.

## D1. Runtime: TypeScript on Node 24 LTS, ESM, no runtime dependencies (2026-10-23)

Chosen by the product spec's stack decision: a TypeScript core over the C git CLI, so one engine ships as
the CLI, a JavaScript GitHub Action, a Claude Code hook and a container image.

- **Runtime dependencies: none.** Git runs through `node:child_process` `execFile`. Planned for
  the rest of M1 chunk 1: argument parsing with `node:util` `parseArgs`, config as JSON via
  `JSON.parse`, and glob matching, the line diff and the comment/string masker as small in-repo
  modules with their own tests. Every
  dependency we skip is one less supply-chain risk in a security tool.
- **Engines field is `>=22.12.0`.** Node 24 LTS is the target and what CI should run. The floor
  is 22.12 because that is what vitest 5 supports and what the build machine (Node
  22.23.2) runs today; nothing in the code needs a Node 24-only API. Andy confirmed on 2026-10-23
  that the floor stays at 22.12 with Node 24 as the target.

## D2. Dev dependencies

Weekly downloads from `api.npmjs.org` for 2026-10-12..18; versions and advisories from the npm
registry and `npm audit` on 2026-10-23 (0 vulnerabilities across the 39 installed packages).

### typescript `^7.0.2`

| Option | Security | Popularity | Maintenance | Notes |
|---|---|---|---|---|
| **typescript 7 (native)** | No published advisories; compiler is not shipped at runtime | 184M/week (whole `typescript` package) | Microsoft; 7.0.2 on 2026-07-08, 7.1 beta out | Native (Go) compiler, much faster `tsc --noEmit`; same package name and CLI |
| typescript 5.9 | Same | Same package | Maintenance line only | No reason to start a new repo on the old compiler |

Pick: typescript 7. the author's other projects already run on it, so its behaviour is known.

### vitest `^5.0.5` (pulls in vite as a peer)

| Option | Security | Popularity | Maintenance | Notes |
|---|---|---|---|---|
| **vitest 5** | 0 advisories in `npm audit`; dev only | 77.5M/week | VoidZero-funded, 5.0.0 on 2026-09-03, six patch releases since | Native ESM and TypeScript with no transform config; the author's standard |
| jest 30 | Dev only | 25.8M/week | Maintained by the OpenJS community | ESM support is still flagged; needs ts-jest or babel for TS |
| node:test | Built in, zero install | n/a | Ships with Node | No TS without `--experimental-strip-types`, weaker matchers and reporting |

Pick: vitest, as the brief asks. node:test is the fallback if the dependency ever becomes a problem.

### @types/node `^24.19.2`

Type definitions only, never shipped. Pinned to the 24 line so the type surface matches the Node 24
LTS target rather than the latest Node (26). 277M/week, DefinitelyTyped.

## D3. Git access: the C git CLI, plumbing only (2026-10-23)

From the spec's stack decision: no git library dependency. `GitReader` runs only
`cat-file --batch-check`, `cat-file --batch`, `merge-base` and `diff-tree -r -z -M --raw`, with no
checkout and no worktree. Hardening on every call:

- `execFile` with an argument array, never a shell. Revisions from the user travel on **stdin** to
  `cat-file --batch-check` (`<rev>^{commit}`), never on argv, so an option-shaped revision cannot
  become a flag. Every later command gets full object ids only.
- `-c core.hooksPath=/dev/null -c core.fsmonitor=false`, `--no-replace-objects` plus
  `GIT_NO_REPLACE_OBJECTS=1`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`,
  `--no-ext-diff --no-textconv`, `diff.external=` and `credential.helper=` reset.
- `protocol.allow=never` and `GIT_NO_LAZY_FETCH=1`: the reader never touches the network. The spec
  suggested `protocol.allow=never` with https re-allowed; that belongs to whatever fetches the
  repo (the hosted service), not the reader. In a blobless partial clone a missing blob is an
  error (exit 2), not a silent fetch. Andy confirmed on 2026-10-23 that refusing every fetch in
  the reader is correct: it fails closed, and fetching is the caller's job.
- The child environment is rebuilt from scratch: only `PATH`, `TMPDIR`/`TEMP`/`TMP` and
  `SystemRoot` are inherited. Every inherited `GIT_*` variable (`GIT_DIR`, `GIT_CONFIG_PARAMETERS`,
  `GIT_EXTERNAL_DIFF`, ...) is dropped, and `HOME` is dropped so no user-level attributes file is read.
- Minimum git 2.32.0 (the release that added `GIT_CONFIG_GLOBAL`); an older git would silently
  read the user's global config, so the reader refuses to run.
- Each call has a timeout and an output cap; blobs over 4 MiB are not read and are marked
  `too-large`.

Not possible with the git CLI: ignoring the inspected repo's own `.git/config` entirely. Command-line
`-c` beats repo config, so every key that can execute something on the commands we run is pinned.

## D4. The diff is merge-base(base, head)..head

The same "three-dot" view a forge shows for a PR, so changes that landed on the base branch after
the PR branched are never attributed to the PR.

## D5. Guard config is read from the base side, never from head (wired into the CLI, D11)

The PR under review must not be able to relax its own judge. `check` reads `.agent-pr-guard.json`
from the resolved `--base` commit via git (`loadConfigFromCommit`), or from `--config <file>` when
the caller passes a trusted file. The base tip rather than the merge base: both are outside the
PR's control, and the base tip is the policy in force now, so a protection added on main after the
PR branched still applies. The diff stays merge-base..head (D4). Any change to
`.agent-pr-guard.json` in the PR is itself a finding (`protected/guard-config`, locked at error).
An unknown key, rule id or severity in the config is an error (exit 2), never ignored.

## D6. Deterministic heuristics, no parser dependencies (engine core built 2026-10-23)

Rules work on lines: a small lexer masks comments and string contents per language (JS/TS, Python,
Go) while keeping column positions, and config files are read with format-agnostic key/value
extraction (JSON, JSONC, YAML, TOML, INI and JS object literals). This trades some precision for
zero dependencies and one code path across formats. If a rule needs real ASTs later, the
candidates are web-tree-sitter (wasm) and `@ast-grep/napi`; that needs its own comparison here
before install.

## D7. License: Apache-2.0 (Andy, 2026-10-23)

`LICENSE` is the unmodified Apache License 2.0 text (sha256 `cfc7749b…3d30`, the apache.org
`LICENSE-2.0.txt`), and package.json says `"license": "Apache-2.0"`. Chosen over MIT for the
explicit patent grant and patent-retaliation clause.

## D8. Engine core shape (2026-10-23)

- `src/engine/mask.ts`: one small lexer per syntax (js, python, go, json, hash, plain) returns three
  views of the file with the input's exact length and line layout: code (comments and string
  contents blanked), code with strings (comments blanked), comments only. Rules match on these,
  so a commented-out or quoted `it.skip(` never counts as code.
- `src/engine/line-diff.ts`: Myers on interned lines after prefix/suffix trimming. Past an edit
  distance of 2000 the middle is reported as one replaced block (bounded memory); file-level
  counts are unaffected.
- `src/engine/glob.ts`: in-repo globs (`*`, `**`, `?`, classes, braces); a slash-free pattern
  matches the file name at any depth.
- Findings point at head-side lines; a removal is anchored on the head line that now follows it.
- A deleted and an added test file with the same unique name are paired as a move, so a move
  that git does not detect as a rename is compared, not reported as a deleted test.
- `engine/uninspected`: a changed test file the reader skipped (binary, too large) is a finding,
  never a silent pass.

## D9. Test-deletion pack (2026-10-23)

- `test-deletion/deleted` and `test-deletion/moved-out` judge paths only (built-in test patterns
  plus `testPatterns`), so a deleted test file the reader could not open is still reported.
- A move that stays collected passes: a git rename to another test path, or the engine's
  same-name delete plus add pairing (D8). A move out of the runner's patterns (`x.test.ts` to
  `x.test.ts.disabled`, `test_api.py` to `api_checks.py`) is `moved-out`.
- Deleting a test together with the code it tests is still reported, but as a warning (amended
  2026-10-23): the guard cannot tell a retired feature from a test removed to get green, and a
  reviewer can, while an error there would block every honest feature removal. "The code it
  tests" is a deleted non-test file with the test's name stem in the same language, anywhere in
  the change: `foo.test.ts`/`foo.spec.tsx`/`__tests__/foo.ts` with `foo.{js,ts,...}`,
  `test_foo.py`/`foo_test.py` with `foo.py`, `foo_test.go` with `foo.go`. A name that says
  nothing (`tests.py`, a custom `testPatterns` match) never downgrades. The rule hit carries the
  cap (`RuleHit.severity`); `off` still wins, and a locked rule ignores a cap.
- Fixture convention for every pack: `fixtures/<pack>/<rule>.flag.<case>` must expect the rule
  and `<rule>.pass.<case>` (an honest change) must not; `tests/packs/fixture-suite.ts` enforces
  both directions for every rule a pack declares.

## D10. Protected pack (2026-10-23)

- `protected/path` and `protected/guard-config` judge paths only, on both sides of a change, so an
  edit, a deletion, a rename in or out, an addition (a copy included) and a mode or type change
  all count, and a file the reader could not open is still reported.
- The pack sees `ignorePaths` files (`seesIgnoredFiles`): an ignore glob never lifts a protection.
- Protected globs are the base config's `protectedPaths` (D5) plus the built-in CODEOWNERS
  locations a forge reads: `/CODEOWNERS`, `/docs/CODEOWNERS`, and each forge's own directory,
  `/.github/CODEOWNERS` (GitHub), `/.gitlab/CODEOWNERS` (GitLab) and `/.gitea/CODEOWNERS` (Gitea
  and Forgejo), so the guard is forge-agnostic. Anchored, so `src/CODEOWNERS` is not protected.
- `protected/guard-config` is locked at error and covers every path the loader reads
  (`GUARD_CONFIG_PATHS`, today only the root `.agent-pr-guard.json`); a same-named file in a
  subdirectory is not the guard config. Adding a config where none existed counts too: it would
  govern every later PR. A config change is reported once, under guard-config, even when
  `protectedPaths` also lists it.

## D11. CLI contract (2026-10-23)

- `agent-pr-guard check --base <rev> [--head <rev>] [--json] [--config <file>] [--repo <path>]`,
  parsed with `node:util` `parseArgs` in strict mode. An unknown option, a repeated option, an
  extra argument or a missing `--base` is a usage error. `--head` defaults to `HEAD` and `--repo`
  to the current directory.
- Exit codes: 0 no error finding (warnings are printed and still exit 0); 1 at least one error
  finding; 2 usage or internal error. A check that could not run (bad revision, bad config, not a
  repository, old git) is never a pass.
- `--json` prints schema version 1: `version`, `base`, `head`, `mergeBase` (full ids), `config`
  (where the config came from), `verdict` (`pass`/`fail`), `errors`, `warnings`, `findings[]`
  (`ruleId`, `severity`, `file`, `line`, `reason`) and `uninspected[]` (`file`, `reason`: every
  changed file whose content was not read). On exit 2 it prints `{version, verdict: "error",
  error}` instead. Fields may be added within a version; removing or redefining one bumps it.
- `--config` replaces the base config entirely and must be a file outside the inspected working
  tree (the nearest directory with a `.git` entry at or above `--repo`). A file inside it is the
  head's copy, which the PR can edit, so it is refused with exit 2 rather than trusted.

## D12. Bundler for the committed action and plugin code: rolldown (2026-10-23)

A JavaScript action runs straight from the repository with no `npm install`, so its code is
committed as one file (`action/dist/index.mjs`, built by `npm run bundle`, `scripts/bundle.ts`).
`tests/action/action.test.ts` rebuilds each bundle and fails when the committed copy differs, so
the committed code always matches the reviewed sources. The bundle is not minified, so a reviewer
can read exactly what runs.

Weekly downloads from `api.npmjs.org` for 2026-10-12..18; advisories from the GitHub Advisory
Database on 2026-10-23.

| Option | Security | Popularity | Maintenance | Notes |
|---|---|---|---|---|
| **rolldown 1.2** | No advisories | 69.5M/week | VoidZero-funded (the vite team); 1.2.15 on 2026-10-21 | Already in our tree as vite 8's bundler (vitest 5 pulls it in), so pinning it directly adds **zero** packages; reads TS natively |
| esbuild 0.28 | 3 advisories, all in its dev server or Deno install path (GHSA-67mh-4wv8-2f99, GHSA-g7r4-m6w7-qqqr, a withdrawn one); none touch bundling | 184M/week | One main maintainer; 0.28.2 on 2026-08-08 | Still 0.x; a new package (plus a native binary) in our tree |
| @vercel/ncc 0.45 | No advisories | 0.6M/week | Vercel; 0.45.0 on 2026-08-13 | The classic choice for actions, but a webpack bundle with a small community |
| tsdown 0.23 | No advisories | 2.5M/week | Built on rolldown; 0.23.1 on 2026-10-10 | A library-packaging layer we do not need, with 14 more dependencies |

Pick: rolldown, pinned `~1.2.15` to the same minor as vite's own `~1.2.14` range so the lockfile
keeps one copy. `npm audit`: 0 vulnerabilities. The action needs no runtime dependency either: it
reads `INPUT_*`, writes workflow commands to stdout and appends to `$GITHUB_STEP_SUMMARY` and
`$GITHUB_OUTPUT` itself rather than pulling in `@actions/core`.

## D13. GitHub Action (2026-10-23)

- `runs.using: node24`, the newest JavaScript runtime the metadata syntax lists (docs.github.com,
  "Metadata syntax for GitHub Actions", read 2026-10-23: `node20` and `node24`).
- Inputs `base` and `head` default to `github.event.pull_request.base.sha` and `.head.sha`; outside
  a `pull_request` event they are empty and the step fails, asking for them, rather than guessing.
  `fail-on` is `error` (default) or `warning`. `path` (an addition to the brief's four inputs)
  names the repository inside the workspace, because `--config` must be a file outside the
  checked repository, which in a workspace means the repository is checked out into a subdirectory.
- History: `actions/checkout` fetches one commit by default. The action checks whether
  merge-base(base, head) resolves; on a shallow clone it fetches the base and head commits by id
  at depth 100, then 1000, then unshallows. A full clone only fetches commits it lacks (deepening
  would make it shallow). This `git fetch` from the checkout's own `origin`, with the checkout's
  credentials, is the action's only network use; the reader itself still refuses every fetch (D3).
  A failed fetch is a warning, and the check then fails with the revision it cannot resolve.
- The bundle runs the CLI in process with `--json` and turns the report into one annotation per
  finding (`::error`/`::warning` with `file`, `line` and the rule as title, escaped as the toolkit
  does so a path or reason cannot inject a command), a job summary table (cells HTML- and
  pipe-escaped, capped at 500 rows) and the outputs `verdict`, `errors`, `warnings`. The step fails
  on an error finding, on a warning with `fail-on: warning`, and whenever the check could not run.

## D14. Claude Code plugin (2026-10-23)

- **In-process checker, not an installed CLI.** The Stop hook and the `check` skill run
  `plugin/scripts/guard.mjs`, a rolldown bundle (D12) of `src/plugin/` that calls `runCli` in
  process: the engine the CLI and the Action run. Shelling out to `npx agent-pr-guard` instead
  would need the package installed (it is not published yet), would run whatever version the
  `PATH` or a download at stop time supplies (network and latency inside the hook's budget), and
  could pick up the repository's own `node_modules/.bin/agent-pr-guard`, which the agent can edit.
  The bundle has no runtime dependency and needs only `node`; a test keeps `plugin.json`'s version
  equal to `package.json`'s. The hook is exec form (`command: "node"` plus `args`), so no shell
  parses the plugin path.
- **Uncommitted work is snapshotted through a temporary index.** An agent usually stops before it
  commits, so checking HEAD alone would miss the weakening. The hook copies the real index to a
  temp file, runs `git add --all` with `GIT_INDEX_FILE` pointing at the copy, then `write-tree` and
  `commit-tree` with HEAD as the only parent, and checks merge-base..snapshot. The real index, the
  refs and the working tree are never written, so the user's staging survives. Untracked files
  count and ignored files do not; the user's global excludes and clean filters apply exactly as
  `git add` would, which is why the plugin keeps global and system git config (unlike the reader,
  D3) and only pins hooks, fsmonitor, the untracked cache, split index, helpers and the network
  off. The copy's mtime is set one second before the original's: git compares by content any entry
  modified at or after its index file's mtime (racily clean), so an older mtime only makes git
  hash more, while a fresh one would hide an edit made in the same second the real index was
  written. When the snapshot's tree equals HEAD's, HEAD itself is checked and no commit is made.
- **Fixed identity and date.** Snapshot commits use `agent-pr-guard <agent-pr-guard@localhost>`
  at `@0 +0000`, so the same tree on the same HEAD always gives the same commit id: repeated stops
  do not accumulate objects, and the commit never depends on the user's identity config. Nothing
  references the commits, so `git gc` prunes them.
- **Block once, then let the stop go ahead.** An error finding blocks the first stop, with the
  findings as the reason and an instruction to undo them or tell the user why one is intended.
  When the agent stops again with `stop_hook_active` true, the stop goes ahead with a
  `systemMessage` listing what is still there. A finding the agent should not fix (a feature
  retired on purpose, a config change the user asked for) would otherwise trap the session in a
  loop. Warnings never block.
- **Fail open.** When the check cannot run (no default branch, no shared history, a git or snapshot
  error, the 25 s internal deadline, an internal error), the stop goes ahead with a message saying
  the check did not run, and the hook exits 0. The plugin is a local nudge and the Action on the
  PR is the gate, which fails closed (D13); a broken local setup that blocked every stop would just
  get the plugin removed. The 25 s deadline sits under the hook's 30 s timeout, so the message
  comes from the guard rather than from Claude Code killing the hook.

## D15. Per-rule default severities: only high-precision rules fail a PR (2026-10-23)

- **Why.** The first agent-PR study (333 PRs) flagged 21; a hand spot-check of 20 found 4 true
  positives, 3 arguable and 13 false positives (20% strict precision). The product rule that
  followed: only rules with high precision fail a PR, lower-confidence rules warn. A rule now
  carries an optional `defaultSeverity` (`RuleInfo`); `severityFor` uses it when the config names
  neither the rule nor its pack, and error when the rule sets none. A locked rule must default to
  error. A config setting, for the rule or its pack, still beats the default in both directions,
  and a hit's own `warning` cap still applies on top. Warnings exit 0 (D11), so a warning-only
  report passes.
- **Config pack defaults, with the spot-check evidence per rule:**
  - `config/gate-softened`: error. One flagged PR, a true positive (`make test` became
    `pytest -v || true`). A softened gate is a direct, unambiguous edit.
  - `config/threshold-lowered`: error. Not flagged in the sample; a lowered floor or raised limit
    is a number moving the wrong way, with no honest reading the rule cannot already tell apart
    (raised floors and moved settings pass).
  - `config/gate-removed`: warning. Three flagged PRs, all false positives: tests moved behind a
    wrapper script, a vitest to node:test migration, and command text printed by a deleted doc
    script.
  - `config/file-deleted`: warning. One flagged PR, a false positive (vitest.config deleted with
    vitest in a runner migration).
  - `config/rule-disabled`: warning. One flagged PR, a false positive (a flat-config list item
    becoming its own spread, which enabled the shared rules).
  - `config/ignore-grown`: warning. One flagged PR, noise inside a true positive found by another
    rule (`--exclude=__pycache__`).
  - `config/inline-suppression`: warning. Five reviewed PRs, all false positives: suppressions for
    a linter or type checker the repo does not run (4), and a `noqa` whose reason sat on the
    comment line above. Raised to error, a directive with a reason still warns, except a type
    checker turned off for a whole file.
- Every other rule keeps error until its own evidence says otherwise; the next spot-check
  (a fresh 20 PRs, at least 80% strict precision before launch) decides.

## D16. Assertion pack precision, round B1 (2026-10-23)

- **Why.** The spot-check (D15) left five assertion findings that were not true positives:
  three false positives and two arguable. Each fix keeps the two true positives flagging
  (`assertion/removed` on a dropped auth check, and on removed e2e assertions with no matching
  source removal).
- **Wrapped Python asserts are judged as one statement.** The strength check (`loosened`) scans
  each Python logical line once, joined across open brackets and trailing backslashes (capped at
  40 lines), and reports it at its first line. A formatter moving `assert x == y, (msg)` to
  `assert (x == y), msg` is a strong check on both sides, and a change to a continuation line
  alone (`assert (total == 3)` to `assert (total)`) is still seen. JS and Go stay per line: their
  matchers name the strength on the line they sit on, and a JS block would join a whole file.
- **An `expect` chain broken after a bare `expect` is an assertion.** A line holding only `expect`
  (after an optional `await` or `return`) counts as one assertion when the next line starts with
  `.`, as in a polled check a formatter split into `await expect` / `.poll(...)` /
  `.toBeGreaterThanOrEqual(0.9)`; the count was zero and a measured `expect` moved into a poll
  read as removed. Without the continuing line, a bare `expect` is a value, not a check.
  `expect.element(...)` (Vitest browser mode) joins `soft`, `poll` and the other recognised
  `expect.` forms.
- **Assertions removed with the code they tested warn.** `assertion/removed` is capped at warning
  (per hit, as a consolidation is) when the test file's subject, by the D9 name match (now the
  shared `subjectsOf`, which `test-deletion` uses too), was deleted in the change; or when the
  subject was modified and every hunk that lost assertions names something the old subject
  declared at top level (a JS/TS function, class, variable, type or enum at the start of a line, a
  Python `def` or `class`, methods included, a Go `func`, `type`, `var` or `const`) and that
  neither the new subject nor the new test file names any more (strings kept, comments not). The
  reason says which: `removed along with src/x.ts, the code they tested`, or `` removed along with
  `migrateLegacy`, which src/settings.ts no longer declares ``. Locals are not declarations, so a
  rewritten function body never stands in for a retired one, and a subject that could not be read
  never downgrades. A test whose assertions moved to another file's subject is not covered: the
  rule follows the test's own name only, which is why a removed check in a test of untouched code
  (a page-level `live-data.test.js` asserting on a deleted loader's markup) stays an error. Both
  study findings this answers were arguable (a one-time settings migration retired with its
  tests; a helper retired with its feature); the two true positives keep flagging, since their
  subjects kept every top-level name the removed assertions used.
- **A move from `expect` to `node:assert` is judged across the file (round 2b).** When a JS test
  file's assertion style switches completely (the base side calls `expect` and never the assert
  module, the head side calls the assert module and never `expect`), `assertion/loosened` no
  longer pairs checks hunk by hunk, which matched unrelated lines across a rewritten file. It
  counts exact and weak checks over each whole side and reports once, at the first weak check on
  the head side, when exact checks fell and weak ones rose: the smaller of the two changes is the
  number replaced. Exact checks that were dropped without a weak replacement are
  `assertion/removed`'s to report. In such a port `toBe(true)` and `toBe(false)` count as weak, the
  same as `assert.ok`, and `assert(...)` or `assert.ok(...)` whose first argument compares values
  (`==`, `!=`, `<`, `>` and their variants; `=>` is not one) counts as exact; outside a port both
  keep their old strength, since a `toEqual` turned into `assert.ok(x > 0)` within a file that
  still uses `expect` is a loosening. Everywhere, not only in ports: `assert.strict.<check>` has
  the strength of `assert.<check>`, and checks bound from `node:assert`, `assert` or their
  `/strict` forms by import or `require` (default, namespace, `strict`, or a check named with or
  without `as`) count as assertions with their check's strength. The bindings are read from the
  view that keeps strings, since the module name is a string. The study false positive this
  answers (a vitest-to-`node:test` migration whose new file has more exact checks than the old)
  now passes; both true positives above keep flagging.

## D17. Skip and test-deletion precision, round B2 (2026-10-23)

- **Why.** Two spot-check false positives (D15) were still failing: an environment fallback in
  newly added tests read as a skipped test, and a deleted scratch script named `test_*.py` read as
  a deleted test file. Each fix keeps its true positive flagging (`skip/skipped` on a tenancy test
  whose failure became a skip; `test-deletion/deleted` on nine deleted unit test files).
- **A conditional skip in a new test is not a weakening.** `skip/skipped` no longer counts a skip
  marker that is an environment fallback in a test the base side did not have: the skip sits in an
  `if`/`elif`/`else` or exception-handler (`except`, `catch`) block of that test, or on the same
  line after such a header, or it is a marker that is conditional by construction
  (`pytest.importorskip`, or a `skipif`/`skipIf`/`skipUnless` decorator whose first argument is
  not a constant or a bare `reason=`). The test is the nearest enclosing Python `def test*`, Go
  `func Test*`/`Benchmark*`/`Fuzz*` or JS `it`/`test`/`specify` call with a literal title, found by
  indentation; a decorator belongs to the `def` below it. "New" is by name (function name, or JS
  title) against the base side, and when any base test name is gone from the head side no test
  counts as new, since a renamed test with a fallback added would otherwise pass. Still flagged: any
  skip, conditional or not, added to an existing test (a fallback there can hide a regression the
  test exists to catch); an unconditional skip in a new test; a constant condition (`if True:`,
  `skipif(True, ...)`); a conditional skip in a helper or fixture outside a test, which can reach
  existing tests; and forms the indentation walk cannot attribute (`it.skipIf(cond)(...)`).
- **A test file is a test by its content, not its name alone.** `test-deletion/deleted` (and
  `moved-out`, the same question) is capped at warning when the file's base side was readable, in a
  language the guard reads, and holds no test by that language's conventions: no Python
  `def test*` or `Test*`/`TestCase` class, no Go `Test*`/`Benchmark*`/`Fuzz*`/`Example*` function
  or Ginkgo container, no JS `it`/`test`/`describe` (and their modifiers) or `Deno.test` call, and
  no test framework import (`pytest`, `unittest`, `nose`, `hypothesis`; `testing`, Ginkgo,
  testify; `vitest`, `jest`, `mocha`, `chai`, `node:test`, `bun:test`, `@playwright/test`, `ava`,
  `tap`, `uvu`). Code is read with comments and strings blanked, so a commented-out test does not
  count; an import is read with strings kept. The reason says only the name matched. This amends
  D9's path-only judgment for readable files only: a side the reader could not open, or a file in
  another language (a custom `testPatterns` match), stays an error, so the guard never relaxes on
  what it could not read. A framework import alone keeps a file a test, which leans toward error
  for test helper modules; that is the cost of not guessing.

## D18. Creating a protected path warns; repeated findings are reported once (2026-10-23)

- **Why.** The v3 study run failed konarsubhojit/study-app#81 on `protected/path` for adding
  `.github/CODEOWNERS` to a repo that had none. Adding review protection strengthens a repo, so
  failing the PR for it is a false positive. Separately, majalen3/Bowling-HQ#5 listed the same
  `config/gate-softened` finding (`'|| true' swallows a failure of pytest`, Makefile line 57) more
  than once.
- **A protected path the PR creates is capped at warning.** `protected/path` sets the per-hit cap
  (`RuleHit.severity`, D9) when the protected path is the file's head path, the base had no file
  there, and the file did not come from a protected path: an addition, or a rename from an
  unprotected path (git may report the same move as a deletion plus an addition, so the two are
  judged alike). An edit, a deletion, a rename away from a protected path, a rename between two
  protected paths, and a mode or type change stay at the configured severity (error by default).
  Config `off` still mutes the rule. This amends D10, which counted an addition like any change.
- **A CODEOWNERS file is new only where none existed.** Forges read one CODEOWNERS file and pick
  it by location (GitHub reads `.github/` before the root and `docs/`), so adding one beside an
  existing one can replace the owners without touching the old file. An added CODEOWNERS is
  capped only when the merge base has no file at any built-in location (`CODEOWNERS_PATHS`),
  changed or not: the reader looks them up at the merge base (`ChangeSet.baseCodeowners`, one
  `cat-file --batch-check` call), since the change set alone cannot see an unchanged file. This
  also covers a copy of an existing CODEOWNERS: the reader runs `diff-tree -M` without copy
  detection, so git reports a copy as an addition, and the source's presence in the base keeps it
  an error. A configured `protectedPaths` glob has no such precedence the guard knows of, so an
  added golden file or snapshot warns; a project that wants additions there to fail has no knob
  for it today.
- **`protected/guard-config` is unchanged.** It is locked at error, and adding a guard config where
  none existed still fails: it governs every later PR.
- **Repeated findings are reported once.** The engine keeps one finding per (rule, file, line,
  reason), at the higher severity if the copies differ, so a rule that reaches one line by two
  routes does not inflate the error count. Findings that differ in any of the four stay separate.

## D19. Warn-only by default; blocking is opt-in (2026-10-30)

D16 to D18 record the precision rounds, so this decision follows them.

- **Why.** The study (docs/STUDY.md) measured a base rate of about 0.3% (2 of 763 fresh agent PRs
  weaken their own tests) and a strict precision of 20% (lenient 50%, 10 flags). A check that is
  strictly right once in five flags cannot be allowed to fail a PR or trap an agent
  session by default. Tuning to 0 false positives in-sample did not hold out of sample, so more
  tuning was not the answer either. The project is parked as open source, so the default has to be
  safe for someone who installs it and never reads the docs.
- **`--fail-on none|error|warning`, default `none`.** One setting decides the exit code, and the
  CLI and the Action share it (`src/cli/fail-on.ts`): `none` never fails on a finding, `error`
  fails when there is an error finding, `warning` fails on any finding. The default is `none`, so
  findings are printed and the exit is 0. This amends D11's exit 1 ("at least one error finding"):
  exit 1 now means a finding reached `--fail-on`. Exit 2 is unchanged and still means the check did
  not run, which is never a pass; the Action fails its step in that case whatever `fail-on` is
  (amends D13). Unknown values are a usage error, not a guess.
- **Severities and the report are unchanged.** A finding is still an error or a warning, the
  JSON `verdict` is still `fail` when there is an error finding, and `errors` and `warnings` still
  count the same. Only the exit code and the presentation follow `--fail-on`: the human report ends
  `FINDINGS (warn-only, exit 0)` instead of `FAIL`, and the Action annotates an error finding as a
  warning under `none`, so a PR does not show red for a check that cannot fail it. Keeping the
  verdict a statement about the findings means a script reading the JSON still sees them.
- **The Stop hook blocks only with `AGENT_PR_GUARD_BLOCK=1` (or `true`).** By default it shows the
  user the error findings in a `systemMessage` and lets the stop go ahead, once per turn (a second
  stop in the same turn, `stop_hook_active`, stays silent). With the variable set it behaves as
  D14 describes: block once with the findings as the reason, then let the second stop through. An
  environment variable because the hook already takes its configuration from the environment
  Claude Code starts in (`AGENT_PR_GUARD_BASE`). Any other value, or unset, is warn-only.
- **Rejected: keeping `error` as the default and documenting `--fail-on none`.** The people who
  hit a false positive are the ones who have not read the docs.
- **Rejected: a separate `--warn-only` flag.** Two flags would have to be reconciled when both
  are given; one level setting cannot contradict itself.
- **Consequence.** The README and the plugin text no longer call the guard a gate. The Action is a reporter unless the
  user sets `fail-on`, and the plugin is a local notice unless the user sets the variable.
