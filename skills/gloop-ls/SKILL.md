---
name: gloop-ls
description: |
  List active loops with branch, ports, dev-server status, and PR state. Wraps `gloop ls`.
allowed-tools:
  - Bash
---

# /gloop-ls

Run `gloop ls` and relay the result. Point the user at `/gloop-run`, `/gloop-ship`, or
`/gloop-drop` for a specific loop.
