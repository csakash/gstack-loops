---
name: loop-ls
description: |
  List active gstack-loops feature loops with their branch, ports, dev-server
  status, and PR state. Use to see what parallel loops are in flight. Wraps
  `gloop ls`.
allowed-tools:
  - Bash
---

# /loop-ls — show active loops

Run `gloop ls` and relay the result. If the user asks about a specific loop,
point them at `gloop run <slug>`, `gloop stop <slug>`, or `gloop drop <slug>`.
