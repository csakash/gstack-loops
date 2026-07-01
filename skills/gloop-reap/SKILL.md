---
name: gloop-reap
description: |
  Clean up every loop whose PR has merged — stop servers, remove worktrees, delete branches.
  Wraps `gloop reap`.
allowed-tools:
  - Bash
---

# /gloop-reap

Run `gloop reap`. Report which loops were torn down. Needs the `gh` CLI to check merge state.
