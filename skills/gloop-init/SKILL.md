---
name: gloop-init
description: |
  Scaffold gstack-loops in this workspace — detect the git repos, write loops.json, and add
  the loop conventions to CLAUDE.md. Use once per workspace before creating loops. Wraps
  `gloop init`.
allowed-tools:
  - Bash
---

# /gloop-init

Run `gloop init` in the workspace root. Then tell the user to set each repo's dev command +
cross-repo env wiring (`{{port}}` / `{{url:<repo>}}`) in `loops.json`, and to commit
`loops.json` + `CLAUDE.md` so teammates inherit the setup.
