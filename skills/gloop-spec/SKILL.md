---
name: gloop-spec
description: |
  Spec the current loop — run the gstack /spec interview and land the result as a committed
  SPEC.md on the loop branch, which the build/ship steps require. Use after /gloop-new. Wraps
  gstack /spec, scoped to the loop.
allowed-tools:
  - Bash
  - Read
  - Write
  - Skill
---

# /gloop-spec

Produce the loop's spec and commit it so the rest of the loop can run against it.

1. Confirm you're in a loop worktree (a `feat/<slug>` branch). If not, tell the user to run
   `/gloop-new` first.
2. Invoke gstack **`/spec`** and run the interview with the user.
3. Save the resulting spec as **`SPEC.md`** at the worktree root and commit it:
   `git add SPEC.md && git commit -m "spec: <slug>"`.
4. Tell the user the loop is ready to build: `/gloop-build` (or `/gloop-run` for headless).

`SPEC.md` on the branch is the source of truth `/gloop-build`, `/gloop-run`, and the headless
driver require.
