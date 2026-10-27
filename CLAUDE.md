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
                     driver (agent-specific), pipeline (stage runner), review, rules,
                     history, outcomes, risk
commands/            init | new | ls | run | stop | risk | drop | reap | stats
skills/loop-*/       slash commands (registered by ./setup)
templates/           loops.json + REVIEW.md scaffolds (gloop init), branch-protection.md (setup --team)
test/                node:test suites
test/fixtures/       fake `claude` (bin/) and fake `gh` (gh-bin/) the tests put on PATH
docs/                REVIEW_LAYERS.md, PARALLEL_SHIPPING.md, SPEC-v1.md
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
  (fresh-context read-only reviewer, convergence, proof, never ship red) in code.
- The rules themselves live once, in `lib/rules.js`. The driver quotes them in every author
  prompt and `/gloop-build` lists them verbatim; `test/rules.test.js` fails on drift. Change a
  rule there, then paste it into the skill.
- **The owner's workflow is `/gloop-spec` → `/gloop-build` → `/gloop-ship`.** Keep those three
  commands' names, order and jobs; improve them by adding checks inside, never by adding a
  question for the user. `test/workflow.test.js` pins this; if a change needs it to fail, the
  change is wrong.
- Only an autonomous `ship` stage may push. Every other stage is push-guarded in
  `lib/driver.js` (deny rule + git env) and `lib/pipeline.js` (tracking-ref check).
- Anything that talks to GitHub goes through `lib/gh.js` and must return null, not throw,
  when `gh` is missing. Tests use the fake `gh` in `test/fixtures/gh-bin/`; none touch GitHub.
- Pipeline tests use the fake `claude` in `test/fixtures/bin/`. Add a failure scenario there
  for every new way a stage can lie or half-finish, before its happy path.

## Supported agents

Claude Code only in v1. Other agents are designed for but not yet built — keep agent-specific
assumptions (permission-mode flags, `claude -p`) isolated in `lib/driver.js`.
