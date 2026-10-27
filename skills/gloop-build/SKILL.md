---
name: gloop-build
description: |
  Build the current loop's SPEC.md to green — implement it, then have fresh-context
  reviewers check the diff for bugs and for security holes, fix until both converge, run
  /qa, and save proof of every claim. Stops before shipping. Use after /gloop-spec, when
  you want the work done and verified but not yet PR'd.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Skill
  - Agent
---

# /gloop-build — implement the spec until review + QA are green, with proof

Get the loop from an approved `SPEC.md` to "ready to ship." Do **not** push or open a PR.
This is the interactive mirror of the headless stage runner (`gloop run --mode bypass|autonomous`);
the rules below are the same ones the driver enforces in `lib/pipeline.js`.

## Rules
These are the same rules the headless driver gives every author stage (`lib/rules.js`); keep
them word for word.
- Never ship red: if a gate cannot pass within its fix budget, stop and report which gate failed and why. Do not push.
- The author never reviews its own work: review and security review run in a fresh context and change nothing.
- Only important findings block; nit and pre-existing findings never block.
- A finding is resolved only by a fix with a commit in its repo, or by a wontfix with a reason.
- A re-review looks only at the commits since the last review and never re-reports a resolved finding unless its fix is missing or wrong.
- Show, do not tell: every claim needs saved evidence, and PROOF.md (Testing, Risk, How to revert) becomes the PR body.
- Stay inside the worktrees. Never touch main or the root checkouts.
- The spec is fixed. If it is wrong or ambiguous, stop and report; do not guess.
- Changes to sensitive paths always get a human reviewer before they are pushed.

## Preconditions
- You're in the loop's worktree and `SPEC.md` exists on the branch. If not, tell the user to
  run `/gloop-spec` first.
- Find the loop's dev URL(s) from `../.claude/launch.json` (each configuration's `port`) for QA.
- Evidence goes in `<workspace>/.loops/runs/<slug>/interactive/proof/` (gitignored, never committed).

## 1. Build — show, do not tell
1. Implement `SPEC.md`. Small, focused commits per repo. Do not re-scope the spec.
2. Run each touched repo's tests. Save the command and full output to `proof/tests.txt`.
3. Write `proof/PROOF.md` with exactly three sections: `## Testing`, `## Risk`, `## How to revert`.
   It becomes the PR body. Never claim a result you did not produce.

## 2. Review — fresh context, converging
- The author never grades its own work. Run review in a **new-context subagent** (Agent tool)
  that gets only: the diff, `SPEC.md`, and the repo's `REVIEW.md` / `CLAUDE.md`. It must not edit.
- Cycle 1 reviews the whole branch (`origin/<base>...HEAD`). Every later cycle reviews **only the
  commits since the last review** and is given the earlier findings with: do not re-report an id
  unless its fix is missing or wrong (then reuse the id).
- Findings need `file` + `line`, a bug **class** (fix every instance, not one line), and a severity:
  - `important` — a defect this change introduces. **Blocks.**
  - `nit`, `pre-existing` — **never block.** Fix only if trivial and safe.
- Resolve every `important` finding: `fixed` (with a commit in that repo) or `wontfix` (with a
  reason). A fix with no commit, or a wontfix with no reason, is still open.
- Budget: **2 fix rounds** by default. If `important` findings are still open after that, STOP:
  "review did not converge — re-evaluate the approach." Do not keep cycling.

## 3. Security review — same rules, its own budget
- Once review is clean, run a second **new-context subagent** as a security reviewer over the
  whole branch diff, with the repo's `REVIEW.md`. It looks only for vulnerabilities this change
  introduces (injection, missing auth checks, secrets in code or logs, unsafe eval or
  deserialization, SSRF, XSS, crypto misuse, new dependencies or CI permissions), and reports
  only what it can show is exploitable.
- Same contract as review: `important` = an exploitable vulnerability this change introduces,
  blocks; `nit` and `pre-existing` never block. Fix or `wontfix` with a reason; re-check only the
  fix commits; **2 fix rounds**, then STOP: "security review did not converge."
- Skip this step only if `loops.json` has `"review": {"security": false}`; say that you skipped it.

## 4. QA
- Invoke `/qa http://localhost:<port>`; fix every bug; re-run until clean. Save what you
  exercised and the result to `proof/qa.md` (screenshots under `proof/qa/`); update the Testing
  section of `PROOF.md`.
- If QA changed code, run one more diff-only review and security review of those commits
  (same budgets).

## 5. Build gate and risk
- `npm run build` in each touched repo. Must pass. Save output to `proof/build-<repo>.txt`.
- Run `gloop risk`. If it lists sensitive files (CI, auth, billing, migrations, installers…),
  name them in the `## Risk` section of `PROOF.md`. This does not stop the build: `/gloop-ship`
  flags them on the PR for a human reviewer.

## Outcome
- Green: `PROOF.md` has all three sections, review and security review converged, QA clean,
  build clean. Report "ready to ship — run `/gloop-ship`." Leave the worktree as is; do not
  push.
- **Never ship red:** if review or security review does not converge within the budget, QA
  cannot reach clean, the build fails, or proof is missing, STOP and report which gate failed
  and why.
