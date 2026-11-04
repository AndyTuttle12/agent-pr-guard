# How often do agent PRs weaken their own tests, and can a deterministic check find them?

This is the write-up behind agent-pr-guard's warn-only default. It reports two rounds of
measurement on public pull requests written by coding agents. It claims only the numbers below.

## Short version

- About **0.3% (2 of 763)** of public agent PRs in the fresh sample weaken their own tests.
- The guard's flags were mostly not right. On the fresh sample, **strict precision was 20%**
  (CI 6-51%) and lenient precision 50%, from 10 flags.
- Tuning the rules until they had **0 false positives on the first sample did not hold** on PRs
  the tuning never saw.
- That is why the tool reports and does not block.

## What was measured

The guard runs on a PR's diff and flags changes that weaken the tests, gates or config that judge
it (removed or loosened assertions, skipped tests, deleted test files, relaxed config and so on;
see the README). For each round it was run over a set of public agent PRs, and the flagged PRs
were reviewed by hand.

Precision is reported two ways:

- **Strict:** the share of reviewed flags judged a true weakening.
- **Lenient:** the share judged true or arguable (a reasonable reviewer could go either way).

## Round 1 (in-sample)

| | |
|---|---|
| PRs | 333, across 283 repos |
| Flagged | 21 (6.3%) |
| Hand-checked | 20 of the flags |
| Judged | 4 true, 3 arguable, 13 false |
| Precision | 20% strict (4 of 20), 35% lenient (7 of 20) |

The rules were then tuned against this round's false positives until the guard flagged none of
them. That is the in-sample result: tuning reached 0 false positives on these PRs. Because the
rules were fitted to this round, it says nothing about how they behave on other PRs.

## Round 2 (out-of-sample)

| | |
|---|---|
| PRs collected | 836 |
| PRs analyzed | 763, across 543 repos |
| Window | 2025-10-01 to 2026-04-22 |
| Overlap with round 1 | no repo overlap; a new seed |
| Flagged | 10 (1.3%, CI 0.7-2.4%) |
| Blind review | 2 true, 3 arguable, 5 false |
| Precision | 20% strict (CI 6-51%), 50% lenient |

The guard in round 2 was the tuned version from round 1.

### Base rate

2 of 763 PRs (about 0.3%) were true weakenings of the PR's own tests. This is the number of
confirmed true flags over the PRs analyzed, so it counts only weakenings the guard flagged and a
reviewer confirmed.

### Overfit

Tuning on round 1 reached 0 false positives in-sample. That did not hold out of sample: round 2,
on repos and PRs the tuning never saw, had 5 false flags out of 10 and a further 3 arguable. A
clean in-sample result was not evidence that the rules generalize.

### What the false positives were

The main remaining false-positive class was **tests removed along with their feature**: 3 of the 5
false flags in round 2. The guard's README documents that it cannot tell a retired feature
from a hidden failure from the diff alone.

## Caveats

- **One rater.** The same person judged every flag. There is no agreement measure.
- **Small n.** Round 2 has 10 flags, which is why the strict-precision interval is 6-51%. The
  strict and lenient numbers could each move a lot with a few more labels.
- **Labels came before rates.** The true/arguable/false labels were written before any rate was
  computed, so the rates did not influence the labelling.
- **Only what is listed.** Nothing here measures how many weakenings the guard missed, how the
  numbers differ by agent or language, or whether the result holds outside this sample and window.

## Data

The dataset is not attached to this repository.
