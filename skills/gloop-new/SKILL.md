---
name: gloop-new
description: |
  Start a new feature loop — paired worktrees on a shared feat/<slug> branch with wired
  ports. Use when beginning a feature/bug/improvement. Wraps `gloop new`.
allowed-tools:
  - Bash
---

# /gloop-new

Turn the user's feature description into a kebab-case slug, then run `gloop new <slug>`
(add `--repos a,b` if they only want a subset). Report the branch + assigned ports, and point
them at `/gloop-spec` as the next step. Do not start building here.
