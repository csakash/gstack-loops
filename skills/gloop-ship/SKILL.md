---
name: gloop-ship
description: |
  Ship the current loop — raise the PR for the worktree's feat/<slug> branch (one per repo,
  cross-linked), then stop the loop's dev servers. The last step of a loop. Use once
  /gloop-build is green. Wraps gstack /ship.
allowed-tools:
  - Bash
  - Read
  - Skill
---

# /gloop-ship — raise the PR for this loop

Precondition: the loop is green (`/gloop-build` passed; `npm run build` clean). If it isn't,
stop and send the user to `/gloop-build` — do not ship red.

1. Run `gloop risk` from the loop's worktree. If it lists sensitive files, add a
   `## Sensitive paths` section to the PR body listing them, and tell the user those files need
   a human reviewer on the PR. **Do not stop or ask** — the user running `/gloop-ship` is that
   human; just make it visible.
2. Check the branch still merges cleanly into the latest base:
   `git fetch origin <base> && git merge-tree --write-tree --name-only origin/<base> HEAD`.
   If it reports conflicts, STOP and tell the user which files conflict: the branch needs to be
   brought up to date and re-verified with `/gloop-build`. Do not open an unmergeable PR.
3. Keep the loop's spec out of the base branch: every loop adds its own `SPEC.md`, so leaving it
   in makes parallel loops conflict at merge. If `SPEC.md` was added on this branch
   (`git cat-file -e origin/<base>:SPEC.md` fails), remove it in a final commit
   (`git rm SPEC.md && git commit -m "chore: keep the loop SPEC.md out of the base branch (it is in the PR body)"`)
   and put its text in the PR body under `## Spec`. A `SPEC.md` that already exists on the base
   branch is the project's own document: leave it alone.
4. From the loop's worktree, invoke gstack **`/ship`** so it runs tests, bumps version,
   commits, pushes the `feat/<slug>` branch, and opens a **PR for that branch in each repo**
   the loop spans. Cross-link the backend/frontend PRs when there's more than one.
   The PR body must include the loop's `PROOF.md` (Testing / Risk / How to revert) verbatim;
   if there is none, stop and send the user back to `/gloop-build` — no proof, no PR.
5. Stop the loop's dev servers: `gloop stop <slug>`.
6. Report the PR URL(s). Remind the user the worktree stays until the PR merges, then
   `gloop reap` (or `/gloop-drop`) cleans it up.
