---
name: gloop-run
description: |
  Drive a loop with the headless stage runner — bypass or autonomous — or hand off to an
  interactive session. Use for an unattended build → fresh-context review → qa → ship pass.
  Wraps `gloop run`.
allowed-tools:
  - Bash
---

# /gloop-run

Run `gloop run <slug> --mode <mode>`. If the user didn't specify a mode, default to
**interactive** (safe) and mention `bypass` / `autonomous` as the headless options. `bypass`
and `autonomous` require a committed `SPEC.md` on the branch — if it's missing, send them to
`/gloop-spec` first.

Headless runs are a stage runner: build → fresh-context review ⇄ fix (diff-only re-review,
budget `--fix-cycles N`, default 2) → qa → build gate → proof check → ship. Each stage is its
own `claude -p`; the reviewer is read-only. `bypass` authors can edit, run tests and commit,
but cannot push: it stops before push and prints the push + PR commands. `autonomous` opens the
PR with `PROOF.md` as the body. In both modes only the final ship stage may push; a stage that
pushes anyway ends the run `BLOCKED: push-guard`.

- Preview every stage's prompt and command: `--dry-run`.
- When a run ends, report the outcome (shipped / needs-human / BLOCKED at <gate>) and point at
  the evidence in `.loops/runs/<slug>/latest/` (`status.json`, `proof/`, `review/`).
- `--legacy-driver` runs the v1 single-process driver (kept for one release as a fallback).
