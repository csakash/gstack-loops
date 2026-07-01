# gstack-loops — Quickstart

gloop turns Claude Code + gstack into a parallel feature factory. You describe a feature, and
each one runs as an isolated **loop** — its own branch, its own git worktree(s), its own dev
ports — driven from `/spec` all the way to a pull request. Run several at once; they never
step on each other.

This guide gets you from zero to shipping a PR, and sets expectations for what gloop does and
doesn't do.

---

## The mental model (read this first)

- A **loop** = one feature/bug/improvement, worked in isolation to a merged PR.
- The **pipeline** inside a loop is gstack: `/spec → build → /review → /qa → /ship`.
- gloop's job is the **orchestration around** that pipeline: create the isolated sandbox
  (branch + worktrees + wired ports), drive the pipeline in the mode you choose, and clean up
  afterward.
- Quality stays constant across many parallel loops because every loop runs the *same*
  pipeline against the *same* Definition of Done — not because you babysit each one.

gloop does not replace gstack. It runs gstack inside each sandbox.

---

## Install (once per machine)

```bash
git clone --depth 1 https://github.com/csakash/gstack-loops.git ~/.claude/skills/gstack-loops \
  && cd ~/.claude/skills/gstack-loops && ./setup
```

`./setup` will:
- Install **gstack** for you if it's missing (or point you at the one-liner).
- Register the `/loop-*` slash commands and put `gloop` on your PATH.
- Warn if `gh` (needed to open PRs) or the `claude` CLI (needed for headless modes) is absent.

Requires Node ≥ 18.

---

## Set up a workspace (once per project)

Go to the directory that holds your repo(s) — one repo, or several side by side:

```bash
cd ~/Projects/my-app        # a single repo, OR a container of repos (backend/ frontend/ ...)
gloop init
```

`gloop init` detects your repos, writes **`loops.json`** (the config), and drops a
**gstack-loops conventions section into `CLAUDE.md`** so every Claude Code session here follows
the loop rules and Definition of Done. Then open `loops.json` and set each repo's dev command
and any cross-repo wiring:

```jsonc
{
  "repos": [
    { "name": "backend",  "basePort": 4000, "dev": ["npm","run","dev","--prefix","backend"],
      "env": { "PORT": "{{port}}", "FRONTEND_URL": "{{url:frontend}}" } },
    { "name": "frontend", "basePort": 5173, "dev": ["npm","run","dev","--prefix","frontend"],
      "serve": { "portFlag": "--port" }, "env": { "VITE_API_URL": "{{url:backend}}" } }
  ]
}
```

`{{port}}` / `{{port:repo}}` / `{{url:repo}}` / `{{host:repo}}` resolve to each loop's assigned
ports, so a full-stack feature's halves always find each other. **Commit `loops.json` +
`CLAUDE.md`** so teammates who clone the workspace just run the install line and are ready.

---

## Your first loop

```bash
gloop new signup-fix          # → branch feat/signup-fix, worktree(s), ports (slot 1: :4100/:5273)
cd worktrees/signup-fix       # a session opened here inherits the workspace CLAUDE.md
claude                        # then, inside the session:
  /spec                       # interview → write & commit SPEC.md
  /loop-run                   # build → /review → /qa → /ship, gated at each step
```

That's the interactive path. When the PR is open:

```bash
gloop stop signup-fix         # stop its dev servers (also happens automatically on ship)
# after the PR merges:
gloop drop signup-fix --delete-branch     # or: gloop reap  (drops every merged loop)
```

---

## Running two features at once

```bash
gloop new signup-fix          # slot 1 → :4100 / :5273
gloop new export-csv          # slot 2 → :4200 / :5373   (no port collision)
gloop ls                      # see every loop: branch, ports, server up/down, PR state
```

Open a terminal per loop, or drive them headless (below). Because each loop has its own
worktree and port block, the sessions can't corrupt each other's files or fight over ports.

---

## The three modes

`gloop run <slug> --mode <mode>` drives a loop. What to expect from each:

| Mode | How it runs | You approve… | Best for |
|---|---|---|---|
| **interactive** | in-session `/loop-run`, permission prompts on | every step | building something new, staying in control |
| **bypass** | headless `claude -p`, auto-applies edits | the push/PR (it stops before pushing) | trusted changes you want done fast, reviewed before it leaves your machine |
| **autonomous** | headless, end-to-end from an approved `SPEC.md` | nothing — opens a ready-for-review PR | overnight / parallel batches on well-specified work |

```bash
gloop run export-csv --mode autonomous            # unattended, needs SPEC.md on the branch
gloop run export-csv --mode autonomous --dry-run  # print the exact prompt + command, run nothing
```

**Autonomous and bypass require an approved `SPEC.md`** on the branch — the "what to build"
decision stays human. They refuse to run without it.

---

## What gloop guarantees

- **Isolation** — one branch + worktree(s) + port block per loop; parallel loops never collide.
- **Cross-repo wiring** — a feature spanning repos gets matching ports and env automatically.
- **Never ships red** — if `/review` or `/qa` can't pass, or the build fails, the loop stops
  and reports which gate failed. It does not push broken code.
- **Cleanup** — dev servers stop when a loop finishes; the worktree is kept until its PR
  merges, then `gloop reap` removes it (worktree, branch, registry entry, stray processes).

## What to expect / current limits (v1)

- **Claude Code only.** Codex/Cursor/others are designed for but not built yet.
- **Verification is still yours.** Autonomous mode runs `/review` + `/qa`, but unattended runs
  make unattended mistakes — you review the resulting PR. gloop opens it; it never merges it.
- **Shared databases are the main footgun.** By default every loop points at the same DB.
  Isolate DB-touching loops with the `hooks.preLoop` script in `loops.json`
  (e.g. provision a DB branch). See [docs/PARALLEL_SHIPPING.md](docs/PARALLEL_SHIPPING.md).
- **Landing many PRs at once** — slice features to touch different files, merge producer
  (backend) before consumer (frontend), and rebase + re-verify before each ship. Full rules in
  `docs/PARALLEL_SHIPPING.md`.

---

## Command cheat sheet

```
gloop init                              detect repos → loops.json + CLAUDE.md conventions
gloop new <slug> [--repos a,b]          create the loop's branch + worktree(s) + ports
gloop ls                                list loops: branch, ports, servers, PR state
gloop run <slug> --mode <m> [--dry-run] drive the loop (m: interactive|bypass|autonomous)
gloop stop <slug>                       stop the loop's dev servers
gloop drop <slug> [--delete-branch]     tear down a loop (refuses if unmerged; --force to override)
gloop reap                              drop every loop whose PR has merged
```

Slash commands in a session: `/loop-new`, `/loop-run`, `/loop-ls`, `/loop-drop`.
