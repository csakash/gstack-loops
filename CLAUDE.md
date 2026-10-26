# gstack-loops

Distributable multi-repo loop-engineering harness for Claude Code + gstack. Ships a `gloop`
CLI + `/loop-*` slash commands that run parallel feature loops (`/spec → build → /review →
/qa → /ship`) in isolated git worktrees across one or many repos.

See [SPEC.md](SPEC.md) for the current loop spec (v1.1 review layers) and
[docs/SPEC-v1.md](docs/SPEC-v1.md) for the v1 design and acceptance criteria.

## Layout

```
bin/gloop            CLI entry (subcommand dispatch)
lib/                 config, registry, ports, env-template, worktree, proc, gh,
                     driver (agent-specific), pipeline (stage runner), review, history
commands/            init | new | ls | run | stop | drop | reap
skills/loop-*/       slash commands (registered by ./setup)
templates/loops.json gloop init scaffold
test/                node:test suites
test/fixtures/bin/claude   fake agent the pipeline tests put on PATH
docs/                PARALLEL_SHIPPING.md, SPEC-v1.md
setup                installer
```

## Dev

- Pure Node, **zero runtime dependencies**. Node >= 18.
- Run tests: `npm test` (`node --test test/*.test.js`).
- Lint by reading: match the existing terse, comment-the-why style in `lib/`.

## Conventions

- The CLI must degrade gracefully when `gh`/`claude` are absent (features that need them say
  so; nothing crashes).
- `.env` files are seeded into worktrees and must never be committed (see `.gitignore`).
- Headless runs go through the stage runner in `lib/pipeline.js`; it enforces the rules
  (fresh-context read-only reviewer, convergence, proof, never ship red) in code. Keep the
  stage prompts in `lib/driver.js` and the `/gloop-build` skill body describing the same rules.
- Pipeline tests use the fake `claude` in `test/fixtures/bin/`. Add a failure scenario there
  for every new way a stage can lie or half-finish, before its happy path.

## Supported agents

Claude Code only in v1. Other agents are designed for but not yet built — keep agent-specific
assumptions (permission-mode flags, `claude -p`) isolated in `lib/driver.js`.
