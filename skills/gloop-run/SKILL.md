---
name: gloop-run
description: |
  Drive a loop with the headless mode engine — interactive, bypass, or autonomous. Use for an
  unattended build→verify→ship pass. Wraps `gloop run`.
allowed-tools:
  - Bash
---

# /gloop-run

Run `gloop run <slug> --mode <mode>`. If the user didn't specify a mode, default to
**interactive** (safe) and mention `bypass` / `autonomous` as the headless options. `bypass`
and `autonomous` require a committed `SPEC.md` on the branch — if it's missing, send them to
`/gloop-spec` first. Suggest `--dry-run` if they want to preview the driver's prompt.
