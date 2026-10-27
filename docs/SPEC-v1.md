---
title: gstack-loops v1 — distributable multi-repo loop-engineering harness for Claude Code
status: ready-to-build
owner: csakash
depends_on: gstack (skills /spec, /review, /qa, /ship)
supports: Claude Code only (v1)
created: 2026-07-01
---

# gstack-loops v1 — distributable multi-repo loop-engineering harness for Claude Code

## Context

We built and validated an end-to-end loop-engineering setup inside `bugbot`: paired git
worktrees across multiple repos, port/env auto-wiring, and the gstack
`/spec → build → /review → /qa → /ship` pipeline. It works, but it's bespoke — hand-built
config and scripts living in one workspace. It can't be handed to a teammate.

`gstack-loops` packages that setup into a distributable companion to gstack that any
teammate installs in a few commands and uses across one or many repos, with an autonomous
`/spec→/ship` driver and selectable safety modes. **Claude Code only in v1.**

## Current state (the prototype we're generalizing)

Verified working in the `bugbot` workspace (2026-07-01):

| Artifact | Role | Becomes |
|---|---|---|
| `.claude/workspace.json` | repos, base ports, cross-repo env wiring | generalized `loops.json` config |
| `bin/loop-new` / `loop-ls` / `loop-drop` | paired-worktree lifecycle | the `gloop` CLI |
| `bin/loop.lib.js` | shared git/env helpers | CLI internals |
| `PARALLEL_SHIPPING.md` | conflict-avoidance rules (shared DB, merge order) | shipped docs + a shared-state hook |
| gstack skills | the per-feature work | a dependency, orchestrated, not reimplemented |

Gaps vs. goal: hardcoded to `backend`/`frontend`, no installer, no autonomous driver, no
modes, no server/process tracking, no cleanup lifecycle.

## Proposed change

A companion package `gstack-loops`, cloned to `~/.claude/skills/gstack-loops` and set up via
`./setup` (mirrors gstack). It **requires gstack** and checks for it on setup. It provides:

1. **`gloop` CLI** — worktree lifecycle + the headless autonomous driver.
2. **Slash commands** — `/loop-new`, `/loop-run`, `/loop-ls`, `/loop-drop` (the interactive
   driver + thin CLI wrappers), registered as Claude Code skills.
3. **`loops.json` config** — generalized, repo-agnostic (N repos, per-repo ports /
   dev-commands / env-wiring templates).
4. **Loop registry** — tracks each active loop's slot, branch, ports, server PIDs, status.
5. **Mode engine** — interactive / bypass / autonomous → Claude Code permission mode + gates.
6. **Cleanup engine** — stop servers when a PR is raised; remove the worktree when it merges.

### Install & distribution

```bash
git clone --depth 1 https://github.com/csakash/gstack-loops.git ~/.claude/skills/gstack-loops \
  && cd ~/.claude/skills/gstack-loops && ./setup
```

- `./setup`: verifies gstack is installed (blocks with install instructions if not), verifies
  `gh` auth + `claude` CLI on PATH, symlinks/registers the skills, puts `gloop` on PATH,
  prints next steps.
- `./setup --team` + a per-repo `gloop init`: writes `loops.json` + a `## gstack-loops`
  section into the workspace `CLAUDE.md` and commits it, so teammates who clone the workspace
  get the config and just run the install line above.

### Config: `loops.json` (per workspace, generalized)

```jsonc
{
  "worktreeDir": "worktrees",
  "branchPrefix": "feat/",
  "portStride": 100,
  "repos": [
    {
      "name": "backend",
      "path": "backend",
      "baseBranch": "main",
      "basePort": 4000,
      "dev": ["npm", "run", "dev", "--prefix", "backend"],
      "env": { "PORT": "{{port}}", "FRONTEND_URL": "{{url:frontend}}" }
    },
    {
      "name": "frontend",
      "path": "frontend",
      "baseBranch": "main",
      "basePort": 5173,
      "dev": ["npm", "run", "dev", "--prefix", "frontend"],
      "serve": { "portFlag": "--port" },
      "env": { "VITE_API_URL": "{{url:backend}}" }
    }
  ],
  "hooks": { "preLoop": null, "postShip": null }
}
```

Templating (this is what generalizes the bugbot wiring): `{{port}}` = this repo's assigned
port, `{{port:<repo>}}` = another repo's port, `{{url:<repo>}}` = `http://localhost:<that
repo's port>`. Any repo can reference any sibling's assigned port, so cross-repo wiring is
declarative, not hardcoded. Single-repo projects just list one repo. `hooks.preLoop` (e.g.
provision an isolated DB branch) and `hooks.postShip` are optional user scripts — this is
where the shared-DB hazard from `PARALLEL_SHIPPING.md` gets solved generically.

### `gloop` CLI surface

| Command | Does |
|---|---|
| `gloop init` | scaffold `loops.json` by detecting repos under the workspace |
| `gloop new <slug> [--repos a,b]` | create paired worktrees on `feat/<slug>`, assign a port block, seed+wire `.env`, write per-loop `launch.json` |
| `gloop ls` | list loops: branch, ports, server status, PR status, per-repo ahead/dirty |
| `gloop run <slug> --mode <interactive\|bypass\|autonomous>` | drive the loop (see driver) |
| `gloop stop <slug>` | kill the loop's tracked dev-server processes, free ports |
| `gloop drop <slug> [--if-merged] [--delete-branch]` | tear down worktrees; refuses if unmerged unless `--force` |
| `gloop reap` | drop every loop whose PR has merged (stops servers, removes worktrees, deletes branches) |

### Slash commands (interactive path)

`/loop-new`, `/loop-ls`, `/loop-drop` wrap the CLI. `/loop-run` is the **in-session
interactive driver**: from inside a worktree session it sequences build → `/review` (fix) →
`/qa` (fix) → `/ship`, visible and gated, you approve each stage.

### Modes → permission mapping + gates

| Mode | Claude perm mode | Edits | Risky bash | `/review`+`/qa` | PR step |
|---|---|---|---|---|---|
| **interactive** | `default` (in-session `/loop-run`) | prompt | prompt | you drive | you run `/ship` |
| **bypass** | `acceptEdits` (headless `claude -p`) | auto | prompt/gated | auto, fix loop | **stops, you approve** push+PR |
| **autonomous** | `bypassPermissions` (headless `claude -p`) | auto | auto | auto, fix loop | **auto-opens ready PR** |

### The autonomous driver (`gloop run`, bypass/autonomous)

Spawns `claude -p` in each repo's worktree with a driving prompt and the mode's permission
flag. Pipeline:

1. **Precondition:** `SPEC.md` exists on the branch (bypass/autonomous require an approved
   spec — the human decision stays human). If missing → stop, tell the user to run `/spec`.
2. **Build** against `SPEC.md` (small commits).
3. **Start dev servers** from `launch.json`; record PIDs + ports in the registry.
4. **`/review`** → apply findings; re-review. Max N fix cycles (default 2, configurable).
5. **`/qa http://localhost:<loop frontend port>`** → fix; re-QA. Max N cycles.
6. **`npm run build`** clean in each touched repo (hard gate).
7. **`/ship`** → bump/commit/push, open PR per repo, cross-link backend↔frontend. Bypass
   stops before push for approval; autonomous opens a **ready-for-review** PR.
8. **On PR raised:** stop the loop's servers (kill tracked PIDs, free ports).
9. **Worktree stays** until the PR merges. `gloop reap` (or `drop --if-merged`) removes later.

**Failure handling:** if any gate fails after its retries (review/qa can't pass, build red),
the loop **stops, keeps the worktree + servers, and reports status** — it never ships red.
Escalation status follows gstack's DONE / BLOCKED protocol.

### Server / process tracking (for cleanup)

The registry stores PIDs of every process the driver starts (from `launch.json`). `gloop
stop`, the ship step, and `gloop drop` all consult it to kill processes and free ports.
Orphan guard: on `gloop ls`/`reap`, verify recorded PIDs are alive and reconcile.

## Acceptance criteria

1. A teammate on a fresh machine installs with the one clone+setup line; `setup` blocks
   clearly if gstack / `gh` / `claude` are missing.
2. `gloop init` in a 1-repo workspace AND a 3-repo workspace both produce a valid
   `loops.json`; the driver works in both (multi-repo is not special-cased).
3. `gloop new x` creates one branch `feat/x` and a worktree per selected repo, assigns a
   non-colliding port block, and wires each repo's `.env` from the templates (verified:
   frontend's API URL points at backend's assigned port).
4. Two loops created back-to-back get disjoint port blocks; their dev servers run
   simultaneously without collision.
5. `gloop run x --mode interactive` drives build→review→qa→ship with visible permission
   prompts at each stage.
6. `gloop run x --mode bypass` auto-applies edits, runs the review+qa fix loops, then
   **stops before push** and asks for approval.
7. `gloop run x --mode autonomous` runs end-to-end from an existing `SPEC.md` and opens a
   **ready-for-review** PR per repo with backend↔frontend cross-links, no human interaction.
8. Autonomous/bypass **refuse to run** if `SPEC.md` is absent on the branch.
9. If `/review` or `/qa` can't reach clean within the configured fix cycles, or `npm run
   build` fails, the loop stops without shipping and reports a BLOCKED status naming the
   failing gate.
10. When a PR is raised, the loop's dev-server processes are stopped and their ports freed
    (verified: nothing listening on the loop's ports afterward).
11. The worktree persists after the PR is raised; `gloop drop x` refuses while the PR is
    unmerged; `gloop reap` removes it once merged (worktree gone, branch deleted, registry
    entry cleared, no orphan processes).
12. `gloop ls` accurately shows each loop's branch, ports, server up/down, and PR state.
13. Running against a single-repo workspace works with zero multi-repo config.

## Testing plan

| Layer | What | Count |
|---|---|---|
| Unit | port-block assignment, `{{port/url:repo}}` template resolution, registry read/modify/write, PID liveness reconcile | +8 |
| Integration | `gloop new`/`ls`/`drop`/`reap` against throwaway local git repos (1-repo and 3-repo); env-wiring correctness; port non-collision | +6 |
| E2E | full `gloop run` in each mode against a fixture repo with a canned `SPEC.md`; verify PR opened (state per mode), servers stopped on ship, worktree reaped on merge | +3 |

## Rollback

Pure additive tooling in its own repo; nothing mutates target repos except branches/worktrees
it creates. Uninstall = remove `~/.claude/skills/gstack-loops` + the `gloop` PATH entry. Any
loop it created is a normal branch/worktree, removable by hand. A bad `gloop run` is bounded
by the mode's permission gates and the "never ship red" rule.

## Effort estimate (CC-assisted)

- Config + `gloop` CLI (new/ls/drop/reap/stop, templating, registry): ~4h
- Installer + gstack/gh/claude checks + team mode: ~2h
- Mode engine + headless `claude -p` driver + pipeline + retries: ~5h
- Server/process tracking + cleanup lifecycle: ~2h
- Slash commands (`/loop-*`) + `/loop-run` interactive driver: ~2h
- Tests + fixtures + docs (README, CLAUDE.md section, port of PARALLEL_SHIPPING): ~3h

## Files reference (new repo `gstack-loops`)

| Path | Purpose |
|---|---|
| `setup` | installer (gstack/gh/claude checks, skill + PATH registration, `--team`) |
| `bin/gloop` | CLI entry (subcommands) |
| `lib/{config,registry,worktree,ports,env-template,proc}.js` | internals |
| `lib/driver.js` | headless pipeline + mode→permission mapping |
| `skills/loop-new|loop-run|loop-ls|loop-drop/SKILL.md` | slash commands |
| `templates/loops.json` | `gloop init` scaffold |
| `README.md`, `CLAUDE.md`, `docs/PARALLEL_SHIPPING.md` | docs |

## Out of scope (v1)

- Non-Claude-Code agents (Codex/Cursor/opencode) — designed for later, not built.
- Non-git workspaces; monorepo-only single-branch flows.
- A GUI/dashboard (CLI + `gloop ls` only).
- Auto-merging PRs or running deploys (stops at PR; `/land-and-deploy` stays a gstack skill).
- Cross-machine loop state sync.

## Related

- Prototype: `bugbot/bin/loop-*`, `bugbot/.claude/workspace.json`, `bugbot/PARALLEL_SHIPPING.md`
- Depends on: gstack (`/spec`, `/review`, `/qa`, `/ship`)
