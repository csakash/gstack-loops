---
name: loop-drop
description: |
  Tear down a gstack-loops feature loop after its PR is merged — stop its dev
  servers and remove its worktrees/branch. Refuses if there's unmerged or
  uncommitted work. Use after a loop's PR lands. Wraps `gloop drop` / `gloop reap`.
allowed-tools:
  - Bash
---

# /loop-drop — tear down a merged loop

- To drop one loop: `gloop drop <slug> --delete-branch`. It refuses if the loop
  has unmerged commits or uncommitted changes — surface that to the user rather
  than forcing, unless they explicitly ask to discard the work (`--force`).
- To drop every loop whose PR has already merged: `gloop reap`.

Always confirm with the user before running `--force` (it discards unmerged work).
