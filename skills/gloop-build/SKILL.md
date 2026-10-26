---
name: gloop-build
description: |
  Build the current loop's SPEC.md to green — implement it, then have a fresh-context
  reviewer check the diff, fix until review converges, run /qa, and save proof of every
  claim. Stops before shipping. Use after /gloop-spec, when you want the work done and
  verified but not yet PR'd.
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

## 3. QA
- Invoke `/qa http://localhost:<port>`; fix every bug; re-run until clean. Save what you
  exercised and the result to `proof/qa.md` (screenshots under `proof/qa/`); update the Testing
  section of `PROOF.md`.
- If QA changed code, run one more diff-only review of those commits (same budget).

## 4. Build gate
- `npm run build` in each touched repo. Must pass. Save output to `proof/build-<repo>.txt`.

## Outcome
- Green: `PROOF.md` has all three sections, review converged, QA clean, build clean. Report
  "ready to ship — run `/gloop-ship`." Leave the worktree as is; do not push.
- **Never ship red:** if review does not converge within the budget, QA cannot reach clean, the
  build fails, or proof is missing, STOP and report which gate failed and why.
