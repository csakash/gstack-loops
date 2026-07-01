---
name: gloop-drop
description: |
  Tear down a loop after its PR merges — stop servers, remove worktrees/branch. Refuses if
  there's unmerged work. Wraps `gloop drop`.
allowed-tools:
  - Bash
---

# /gloop-drop

Run `gloop drop <slug> --delete-branch`. It refuses if the loop has unmerged or uncommitted
work — surface that instead of forcing, unless the user explicitly asks to discard the work
(`--force`). Confirm before any `--force`.
