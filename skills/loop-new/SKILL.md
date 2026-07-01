---
name: loop-new
description: |
  Create a new gstack-loops feature loop — paired git worktrees across one or
  more repos on a shared feat/<slug> branch, with auto-assigned non-colliding
  ports and wired .env. Use when starting a new feature/bug/improvement that
  should be worked in isolation. Wraps the `gloop new` CLI.
allowed-tools:
  - Bash
---

# /loop-new — start an isolated feature loop

Run `gloop new` for the requested feature. Steps:

1. Confirm a `loops.json` exists in the workspace (`gloop ls` will error if not; if missing, run `gloop init` first and let the user wire cross-repo env).
2. Turn the feature description into a kebab-case slug (e.g. "attachment previews" → `attachment-previews`).
3. Run:
   ```bash
   gloop new <slug>            # or: gloop new <slug> --repos backend,frontend
   ```
4. Report the assigned branch and ports, then tell the user the next step is to write `SPEC.md` (via `/spec`) inside the worktree, then drive the loop with `/loop-run` or `gloop run <slug> --mode <mode>`.

Do not start building here — this skill only sets up the loop's sandbox.
