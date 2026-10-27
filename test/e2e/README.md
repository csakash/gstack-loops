# End-to-end test: gloop on a mock project, with the real agent

`npm test` proves gloop's rules with a fake agent. This harness runs the **real `claude` CLI**
against a small two-repo app, so it shows what the unit tests cannot: whether real agents follow
the stage prompts, whether the dev servers, ports and pushes behave, and whether the whole
lifecycle holds together. It costs real tokens and about 20 minutes, so it is not part of
`npm test`.

## What is here

| File | What it is |
|---|---|
| `mock-project.js` | Builds the workspace: `backend/` (notes API, tests, build) and `frontend/` (static UI that calls the backend through gloop's port wiring), each with a local bare remote standing in for GitHub. Zero dependencies. |
| `bin/gh` | Mock GitHub backed by those remotes. `pr create` refuses an unpushed branch, `pr merge` does a real git merge into the remote, `pr view`/`pr list` answer with the fields gloop reads. Every call is logged. |
| `bin/claude` | Passes every call to the real CLI, except the build stage when `E2E_PLANT_BUILD` names a script: then that script plays the author, so a known bug lands in the diff and the *real* reviewer, fixer and re-reviewer are tested on it. |
| `plants/notes-delete-buggy.js` | A planted author: `DELETE /api/notes/:id` with two seeded defects and happy-path tests that pass. |
| `env.sh` | Puts the mock `gh`, the wrapper and this checkout's `gloop` first on `PATH`. |

## Run it

```bash
export E2E=/tmp/gloop-e2e                      # any scratch dir
node test/e2e/mock-project.js $E2E/ws
. test/e2e/env.sh
cd $E2E/ws && gloop init
# wire the repos (what a user does after init):
node -e "const f='loops.json',c=JSON.parse(require('fs').readFileSync(f));
c.repos[0].env={PORT:'{{port}}',FRONTEND_URL:'{{url:frontend}}'};
c.repos[1].env={VITE_API_URL:'{{url:backend}}'}; c.repos[1].serve={portFlag:'--port'};
require('fs').writeFileSync(f,JSON.stringify(c,null,2))"
```

Then one loop per scenario. Commit a `SPEC.md` in each loop worktree first, as `/gloop-spec`
does.

| Scenario | Command | Expect |
|---|---|---|
| Two-repo feature, bypass | `gloop run notes-search --mode bypass` | `needs-human`; commits in both repos; servers start right before QA; QA tests the running app; nothing pushed; ports free afterwards |
| Planted bug, autonomous | `E2E_PLANT_BUILD=$PWD/../../test/e2e/plants/notes-delete-buggy.js gloop run notes-delete --mode autonomous` (use the absolute path) | the real reviewer reports the seeded defects as `important`; one fix round; diff-only re-review clean; ships a PR whose body is the proof plus the spec |
| Sensitive path, autonomous | a spec that adds `.github/workflows/ci.yml` | `needs-human`, the file named, no push, `## Sensitive paths` in `PR_BODY.md` |
| Lifecycle | run the printed push/PR commands; `gh pr merge <n>`; `gloop reap`; revert a merge on the remote; `gloop reap`; `gloop stats` | merges recorded on the right run; reap leaves open PRs alone; the revert is flagged; stats match |

Evidence for every run is in `.loops/runs/<slug>/latest/` (`status.json`, `proof/`, `review/`,
`security/`, `servers.json`); every agent call is in `$E2E/claude.log`, every GitHub call in
`$E2E/gh.log`.

## Last run (2026-10-27)

All four scenarios passed after the fixes below. The real reviewer caught both planted defects
(an unknown id deleting the last note via `splice(-1)`, and 204 instead of 404) plus two more,
in one cycle; the fixer resolved all four in one commit; QA drove a real browser against the
running servers. Defects the run found in gloop, each fixed with a regression test that fails on
the old code:

1. Dev servers never started in a multi-repo workspace (`npm run dev --prefix <repo>` was run
   from inside the repo).
2. Servers started before the build, so QA tested stale code; an agent's restarted server was
   left running after the run.
3. Every loop committed `SPEC.md` at the repo root, so the second of two parallel loops always
   conflicted on it at merge, and main kept the last loop's spec.
4. A branch that no longer merged into the latest main was shipped anyway.
5. A committed `SPEC.md` satisfied the "build produced no commits" guard.
6. A repo whose branch only carried `SPEC.md` got a spec-only PR, and kept its loop from ever
   being reaped.
7. `gloop new` crashed when a repo had no `dev` command.

Not covered by this run: gstack's own `/qa`, `/review` and `/ship` (gstack's installer was not
run in the test container), and an interactive `/gloop-spec` → `/gloop-build` → `/gloop-ship`
session (starting a full-permission Claude session from the harness was not allowed there).
Run those on your machine with gstack installed.
