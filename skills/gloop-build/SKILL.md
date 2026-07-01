---
name: gloop-build
description: |
  Build the current loop's SPEC.md to green — implement it, then loop build → /review → /qa
  until both pass clean. Stops before shipping. Use after /gloop-spec, when you want the work
  done and verified but not yet PR'd.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Skill
---

# /gloop-build — implement the spec until review + QA are green

Get the loop from an approved `SPEC.md` to "ready to ship." Do **not** push or open a PR.

## Preconditions
- You're in the loop's worktree and `SPEC.md` exists on the branch. If not, tell the user to
  run `/gloop-spec` first.
- Find the loop's dev URL(s) from `../.claude/launch.json` (each configuration's `port`) for QA.

## Loop until green
1. **Implement** `SPEC.md`. Small, focused commits per repo. Do not re-scope the spec.
2. **Review** — invoke `/review`; apply every finding; re-run. Repeat until clean (default up
   to 2 cycles).
3. **QA** — invoke `/qa http://localhost:<port>`; fix every bug; re-run until clean.
4. Re-run review + QA together once more if step 3 changed code — both must end clean.
5. **Build gate** — `npm run build` in each touched repo. Must pass.

## Outcome
- Green: report "ready to ship — run `/gloop-ship`." Leave the worktree as is; do not push.
- **Never ship red:** if review/QA can't reach clean within the cycle budget, or the build
  fails, STOP and report which gate failed and why. Do not proceed to ship.
