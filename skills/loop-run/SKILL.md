---
name: loop-run
description: |
  Drive a gstack-loops feature loop end-to-end from inside its worktree session:
  build → /review → /qa → /ship, gated at each step (interactive mode). Use when
  you're in a loop's worktree and want to work it to a PR with review + QA gates.
  For unattended runs use `gloop run <slug> --mode bypass|autonomous` instead.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Skill
---

# /loop-run — interactive loop driver

You are inside a feature loop's worktree. Drive it to a shipped PR, pausing for
the user at each gate. This is the *interactive* path: keep the human in control.

## Setup

1. Confirm you're in a loop worktree: there should be a `SPEC.md` in this repo (or
   the sibling repo of a paired loop). If there's no `SPEC.md`, stop and tell the
   user to run `/spec` first — the loop needs an approved spec to build against.
2. Read `SPEC.md`. It is the source of truth. Do not re-scope it.
3. Find this loop's dev URLs from `../.claude/launch.json` (the `port` of each
   configuration). You'll QA against `http://localhost:<port>`.

## Pipeline (stop for the user between stages)

1. **Build** — implement `SPEC.md`. Small, focused commits. Show the user the plan
   before large changes.
2. **Review** — invoke `/review`. Apply every finding. Re-run `/review` until clean
   (max ~2 cycles). If it can't get clean, stop and report — do not paper over it.
3. **QA** — invoke `/qa http://localhost:<port>` for the running app. Fix every bug.
   Re-run until clean.
4. **Build gate** — run `npm run build` in each touched repo. Must pass.
5. **Ship** — invoke `/ship`. It bumps version, commits, pushes, and opens a PR per
   repo. For a paired loop, cross-link the backend and frontend PRs.

## After the PR is raised

- Stop this loop's dev servers: `gloop stop <slug>`.
- Leave the worktree in place until the PR merges. Once merged, `gloop drop <slug>
  --delete-branch` (or `gloop reap`) cleans it up.

## Hard rules

- Never ship red: if review/QA can't pass or the build fails, STOP and report which
  gate failed. Do not push.
- Stay in the worktree. Never edit `main` or the root checkouts.
- The spec is fixed; if it's wrong, stop and raise it with the user.
