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

1. From the loop's worktree, invoke gstack **`/ship`** so it runs tests, bumps version,
   commits, pushes the `feat/<slug>` branch, and opens a **PR for that branch in each repo**
   the loop spans. Cross-link the backend/frontend PRs when there's more than one.
2. Stop the loop's dev servers: `gloop stop <slug>`.
3. Report the PR URL(s). Remind the user the worktree stays until the PR merges, then
   `gloop reap` (or `/gloop-drop`) cleans it up.
