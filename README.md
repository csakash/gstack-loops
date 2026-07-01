# gstack-loops

Distributable **loop-engineering** harness for [gstack](https://github.com/garrytan/gstack)
on Claude Code. Run one or many features in parallel across one or many git repos, each in an
isolated worktree, driven end-to-end from `/spec` to `/ship` — interactively, in bypass, or
fully autonomous.

> Status: **v1 spec ready to build.** See [SPEC.md](SPEC.md) for the full design and
> acceptance criteria. This repo currently contains the spec; implementation is issue #1.

## What it does

- **Multi-repo, multi-worktree.** A feature spans one or several repos on a shared
  `feat/<slug>` branch, each in its own worktree with auto-assigned, non-colliding ports.
- **End-to-end loop.** Orchestrates gstack's `/spec → build → /review → /qa → /ship` pipeline.
- **Modes.** `interactive` (you drive, prompts on), `bypass` (auto-edits, you approve the PR),
  `autonomous` (unattended, opens a ready-for-review PR).
- **Cleanup.** Stops dev servers when a PR is raised; removes the worktree once it merges.

## Install (planned)

```bash
git clone --depth 1 https://github.com/csakash/gstack-loops.git ~/.claude/skills/gstack-loops \
  && cd ~/.claude/skills/gstack-loops && ./setup
```

Requires: gstack, `gh` (authenticated), and the `claude` CLI on PATH.

## Quick start (planned)

```bash
gloop init                       # detect repos, scaffold loops.json
gloop new attachment-previews    # paired worktrees + wired ports on feat/attachment-previews
gloop run attachment-previews --mode autonomous
```

## Supported agents

Claude Code only in v1. Other agents (Codex, Cursor, opencode) are designed for but not yet
built.
