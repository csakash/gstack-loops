# gstack-loops

Distributable **loop-engineering** harness for [gstack](https://github.com/garrytan/gstack)
on Claude Code. Run one or many features in parallel across one or many git repos, each in an
isolated worktree, driven end-to-end from `/spec` to `/ship` — interactively, in bypass, or
fully autonomous.

## What it does

- **Multi-repo, multi-worktree.** A feature spans one or several repos on a shared
  `feat/<slug>` branch, each in its own worktree with auto-assigned, non-colliding ports.
- **End-to-end loop.** Orchestrates gstack's `/spec → build → /review → /qa → /ship` pipeline.
- **Modes.** `interactive` (you drive, prompts on), `bypass` (headless, auto-edits, stops
  before push for your approval), `autonomous` (headless, unattended, opens a ready-for-review
  PR from an approved `SPEC.md`).
- **Cleanup.** Stops dev servers when the loop finishes; removes the worktree once its PR merges.

## Install

```bash
git clone --depth 1 https://github.com/csakash/gstack-loops.git ~/.claude/skills/gstack-loops \
  && cd ~/.claude/skills/gstack-loops && ./setup
```

Requires [gstack](https://github.com/garrytan/gstack) and Node >= 18. `gh` (authenticated)
and the `claude` CLI are needed for shipping and the headless driver; `setup` warns if they're
missing.

## Use

```bash
cd <your workspace with 1+ git repos>
gloop init                              # detect repos → scaffold loops.json (then wire env)
gloop new attachment-previews           # paired worktrees + wired ports on feat/attachment-previews
# write SPEC.md in the worktree (via /spec), then:
gloop run attachment-previews --mode interactive   # or bypass / autonomous
gloop ls                                # see all loops: ports, servers, PR state
gloop reap                              # tear down loops whose PR has merged
```

Slash commands (in a Claude Code session): `/loop-new`, `/loop-run`, `/loop-ls`, `/loop-drop`.

## Docs

- [QUICKSTART.md](QUICKSTART.md) — zero to shipping a PR; capabilities, modes, what to expect
- [SPEC.md](SPEC.md) — full v1 design + acceptance criteria
- [docs/PARALLEL_SHIPPING.md](docs/PARALLEL_SHIPPING.md) — landing many PRs without conflicts

## Config: `loops.json`

Per-workspace. `gloop init` scaffolds it; each repo declares its dev command, base port, and
env wiring. Cross-repo templates: `{{port}}`, `{{port:<repo>}}`, `{{url:<repo>}}`,
`{{host:<repo>}}`. See [templates/loops.json](templates/loops.json).

## Supported agents

Claude Code only in v1. Other agents (Codex, Cursor, opencode) are designed for but not yet
built.

## Development

Pure Node, zero runtime deps. `npm test` runs the suite (`node --test`).
