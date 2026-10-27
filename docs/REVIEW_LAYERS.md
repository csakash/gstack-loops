# Review layers

How gloop implements the review practice described in
[How the Claude Code team does code review](https://x.com/addyosmani/status/2114604912520921136)
(Addy Osmani, Anthropic, 2026-10-26), and which parts it leaves to GitHub on purpose.

The idea in one line: *did someone read the code?* is the wrong question. The right one is
*what could go wrong with this change, and which check — automated or human — catches it?*
No single layer is reliable; few bugs survive all of them.

## The layers

| # | Layer (article) | In gloop | Where |
|---|---|---|---|
| 1 | **Pre-PR verification.** Show the result, don't say "done"; a fresh-context subagent reviews the diff. | Every claim needs saved evidence: `proof/tests.txt`, `proof/qa.md`, and `PROOF.md` with Testing / Risk / How to revert, which becomes the PR body. The build gate's output is captured by the driver, not paraphrased by an agent. No proof, no ship. | `lib/pipeline.js` (build, qa, buildgate, proof stages); `/gloop-build` steps 1, 4, 5 |
| 2 | **AI review on every PR**, findings tagged important / nit / pre-existing; every finding fixed or closed with a reason. | A separate, read-only reviewer process (no shell, no write tools) reads the diff the driver hands it. Same severities; only `important` blocks. `fixed` needs a commit in that repo; `wontfix` needs a reason. Each repo's `REVIEW.md` tells the reviewer what matters. | review stage; `lib/review.js`; `/gloop-build` step 2; `templates/REVIEW.md` |
| 3 | **Security review that can block.** | A second read-only reviewer, security-only, same contract, its own fix budget. An open `important` security finding blocks ship. | security stage; `/gloop-build` step 3 |
| 4 | **Automated checks that block**; PR template asks how it was tested and how to revert it. | Build gate per touched repo. `PROOF.md`'s three sections are the template, filled with evidence. Your CI stays your CI. | buildgate + proof stages |
| 5 | **Human approval scaled by risk**, decided by the change, not the author; agent approvals don't count; an approval covers one commit. | `review.sensitivePaths` (CI, CODEOWNERS, auth, billing, payments, migrations, installers by default). A match stops even an autonomous loop before push and lists the files in the PR body. Only an autonomous `ship` stage may push at all (permission deny + git env + tracking-ref check). GitHub-side rules are recommended by `./setup --team`. | risk stage; `gloop risk`; `templates/branch-protection.md` |
| 6 | **Merge queue, feature flags, staged rollouts.** | Out of scope: gloop stops at the PR. | — |
| 7 | **Fast feedback and rollback**; incidents become the reviewer's eval set. | Every run and every merged loop (interactive too) is recorded in `.loops/history.json`. `gloop reap` re-checks recent merges for reverts; `gloop stats` shows outcomes, where runs block, cycles-to-pass, and revert rate. Turning reverts into a replayable eval set is not built yet. | `lib/history.js`, `lib/outcomes.js`; `gloop stats` |

## Review that converges

The article's sharpest finding: an agent author and an agent reviewer can cycle forever (one PR
looped more than fifty times overnight), and most of what a reviewer flags on later cycles is old
code. gloop enforces the fixes in code, not in a prompt:

- **Budget.** At most `review.fixCycles` fix rounds per reviewer (default 2), then the run stops
  with "did not converge — re-evaluate the approach."
- **Diff-only re-review.** Cycle 1 sees the whole branch; later cycles see only the commits since
  the last review.
- **Class, not line.** Every finding names the class of bug, so one fix clears every instance.
- **No re-reports.** The reviewer gets earlier findings and may only re-raise an id whose fix is
  missing or wrong.
- **Pre-existing never blocks**, so the author is not charged for bugs it did not write.

## Humans in the loop

The article keeps people for: deciding what to build, auditing dangerous code, architecture,
verifying proofs, and owning the result. In gloop:

- **What to build** stays human: headless modes refuse to run without an approved `SPEC.md`.
- **Dangerous code** is defined by `review.sensitivePaths`; tune it to your codebase.
- **Verifying proofs**: `PROOF.md` is the PR body, so the reviewer reads evidence, not claims.
- **Owning it**: gloop never merges. The person who merges owns the change.

## The workflow these layers sit inside

`/gloop-spec` → `/gloop-build` → `/gloop-ship`. The layers are added *inside* those three commands
and never as a new question; `test/workflow.test.js` holds that line.

## Not built (yet)

- A multi-agent vote on findings to filter false positives (the findings schema has room for it).
- Overnight review of the whole codebase for pre-existing bugs.
- Measuring how humans react to findings on the PR (fixed / rejected / intentional).
- An eval set built from reverted changes, replayed against every reviewer prompt change.
