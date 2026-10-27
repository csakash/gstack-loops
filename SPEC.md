---
title: gstack-loops v1.1 — review layers: proof, fresh-context review, convergence, risk tiers, feedback
status: P0, P1, P2 built
owner: csakash
depends_on: gstack-loops v1 (docs/SPEC-v1.md), gstack (/review, /qa, /ship), Claude Code (/security-review)
supports: Claude Code only
created: 2026-10-26
source: "How the Claude Code team does code review" (Addy Osmani, Anthropic, 2026-10-26)
---

# gstack-loops v1.1 — review layers

## Context

v1 ships the sandbox (branch + worktrees + ports) and a headless driver that runs
`build → /review → /qa → npm run build → /ship` in **one** `claude -p` session with a bounded
fix-cycle count and a "never ship red" rule. That is the right skeleton, and it has four gaps
when measured against how the Claude Code team actually reviews agent-written code:

| Gap | What v1 does | What the article does |
|---|---|---|
| **Proof** | the session ends with a `DONE`/`BLOCKED` line | the agent must *show* the result: test output, build output, screenshots. Claimed 2–3× quality. |
| **Reviewer context** | `/review` runs in the same session that wrote the code | a **fresh-context** reviewer reads the diff; the author never grades its own work |
| **Convergence** | cycle count only | cap cycles, re-review *only the new diff* after the first pass, report the *class* of bug, never re-report, mark pre-existing as non-blocking |
| **Blast radius** | autonomous always opens a ready PR | tier by *what the change touches*; CI workflows, auth, billing, installers always need a human |

Plus two things v1 has none of: a **security gate** that blocks, and a **feedback loop** (per-loop
outcome record → cycles-to-pass, blocked rate, revert rate) so changes to the driver can be
judged instead of guessed.

This spec adds those layers without changing what gloop is: an orchestrator around gstack, not
a reimplementation of it. gloop still stops at the PR.

## Decisions (made 2026-10-26)

1. **Scope:** all seven improvements, in three phases, one loop.
2. **Reviewer isolation:** **two processes, gloop orchestrates.** The driver becomes a small
   stage runner that spawns an *author* `claude -p` and a separate *reviewer* `claude -p` per
   cycle, with a file-based handoff. Not a subagent inside one session.
3. **Sensitive paths:** when an autonomous diff touches one, the loop **stops before push**
   (bypass behaviour) and says why. Nothing leaves the machine without a human.
4. **Spec location:** this file is `SPEC.md` (the loop's source of truth, per gloop convention);
   the v1 design moved to `docs/SPEC-v1.md`.
5. **Phase order:** the two-process decision makes the stage runner a prerequisite for the
   security gate and diff-only re-review, so it leads. A minimal outcome record ships in P0 so
   P1/P2 are measurable from the start.

## Proposed change

### A. The driver becomes a stage runner (`lib/driver.js`)

One headless loop = an ordered list of **stages**. Each stage is its own `claude -p` spawn in
the loop's feature dir, with its own prompt, its own permission mode, and a file contract for
what it must leave behind. The driver checks the contract after each stage and decides the next
one. Interactive mode is unchanged (hands off to a live session).

```
build ──► review ──► fix ──┐  (≤ fixCycles)
            ▲              │
            └──────────────┘
         ──► security ──► fix ──┐  (≤ fixCycles)
               ▲                │
               └────────────────┘
         ──► qa ──► buildgate ──► risk ──► ship | stop
```

| Stage | Process | Perm mode | Must leave behind | Blocks when |
|---|---|---|---|---|
| `build` | author | mode's | commits; `proof/tests.txt`; `PROOF.md` draft | tests not run, no commits |
| `review` | **reviewer** (fresh) | read-only: `Read Grep Glob` only; Bash + write tools denied; driver verifies tree unchanged | findings JSON on stdout → driver writes `review/cycle-N.json` | — |
| `fix` | author | mode's | `review/fix-N.resolutions.json`, commits | — |
| `security` | **reviewer** (fresh) | read-only | `security/cycle-N.json` | — |
| `qa` | author | mode's | `proof/qa.md` + screenshots, commits | `/qa` not clean within budget |
| `buildgate` | driver (no LLM) | — | `proof/build-<repo>.txt` | any repo's build fails |
| `risk` | driver (no LLM) | — | `risk.json` | — (downgrades ship) |
| `ship` | author | mode's | PR URLs in `status.json` | — |

Run directory: `<root>/.loops/runs/<slug>/<ISO-timestamp>/` (gitignored). Contains `proof/`,
`review/`, `security/`, `risk.json`, `status.json`. The latest run is symlinked as `latest`.

**Findings contract** (`review/cycle-N.json`, `security/cycle-N.json`), written by the reviewer:

```jsonc
{
  "cycle": 1,
  "base": "<sha reviewed from>", "head": "<sha reviewed to>",
  "summary": "3 issues (2 important, 1 nit)",     // or exactly "no issues"
  "findings": [
    { "id": "r1-01", "severity": "important|nit|pre-existing",
      "class": "unchecked null from registry.getLoop",   // the *class*, so the author fixes all instances
      "file": "lib/driver.js", "line": 42, "summary": "...", "fix_hint": "..." }
  ]
}
```

Rules the driver enforces (not just the prompt):
- `important` findings block; `nit` and `pre-existing` never block.
- The author's `fix` stage must write `cycle-N.resolutions.json`: `{ "<id>": { "status": "fixed|wontfix", "reason": "..." } }`.
  Any `important` finding without a resolution → next cycle, or BLOCKED if cycles exhausted.
- **Cycle 1** reviews the whole branch diff (`origin/<base>...HEAD`). **Cycle ≥ 2** reviews only
  `<previous head>..HEAD` and receives the previous findings file with the instruction *do not
  re-report an id already listed*.
- After `fixCycles` (default 2, `--fix-cycles N`) with important findings still open, the loop
  stops **BLOCKED** with the message *"review did not converge after N cycles — re-evaluate the
  approach"* and the open findings listed. The article's fifty-cycle overnight loop cannot
  happen here.
- The reviewer stage must not change the worktree. The driver records `HEAD` + `git status
  --porcelain` before and after; any change fails the run (`BLOCKED: reviewer modified tree`).
  Agent-specific flags that restrict tools stay inside `driver.js`.

**Proof contract** (`proof/`), written by author stages and required before ship:
- `tests.txt` — the actual test command and its output per repo.
- `build-<repo>.txt` — `npm run build` output per touched repo.
- `qa.md` + `qa/*.png` — what `/qa` exercised, at which URL, with screenshots.
- `PROOF.md` — a short document with exactly three sections: **Testing**, **Risk**, **How to
  revert**. The `ship` stage pastes `PROOF.md` into the PR body. Missing `PROOF.md` → `BLOCKED:
  no proof`. "Done" without proof is not done.

**Status + outcome record.** `status.json` is updated after every stage. At the end of a run the
driver appends one record to `<root>/.loops/history.json`:

```jsonc
{ "slug": "signup-fix", "mode": "autonomous", "repos": ["backend","frontend"],
  "startedAt": "...", "finishedAt": "...",
  "outcome": "shipped|needs-human|blocked",
  "blockedGate": null | "review|security|qa|buildgate|proof|reviewer-modified-tree",
  "cycles": { "review": 2, "security": 1 },
  "findings": { "important": 3, "nit": 2, "pre-existing": 1, "fixed": 3, "wontfix": 0 },
  "sensitive": [], "prs": { "backend": "https://..." }, "mergedAt": null, "reverted": null }
```

### B. Security gate

After review converges, a fresh-context reviewer runs `/security-review` with the same findings
contract and the same fix/resolve rules. Any open security finding blocks ship; `wontfix` needs
a reason (that is how a false positive is closed). Degrades: if `/security-review` is
unavailable the stage records `skipped: command unavailable` in `status.json`, prints a
warning, and the run continues — gloop never crashes on a missing dependency.

### C. Risk tiers (`risk` stage + `loops.json`)

```jsonc
"review": {
  "fixCycles": 2,
  "sensitivePaths": [".github/workflows/**", "**/auth/**", "**/billing/**",
                     "**/migrations/**", "setup", "**/install*", "**/*.yml"]
}
```

Before `ship`, the driver lists `git diff --name-only origin/<base>...HEAD` per repo and glob-
matches against `sensitivePaths` (zero-dep matcher: `**`, `*`, `?`). On a match in autonomous
mode, `autoPush` is forced off: the loop finishes exactly like bypass (prints the `git push` +
`gh pr create` commands), status becomes `needs-human`, and the reason names the file(s).
`gloop ls` shows `needs-human (touched .github/workflows/ci.yml)`. `gloop init` writes the
default list above; the tier comes from the **change**, never from who ran the loop.

### D. `REVIEW.md` scaffold

`gloop init` writes a `REVIEW.md` into each repo that lacks one, with the five sections the
article recommends, each with one example line:

1. What project failure looks like here (e.g. "the CLI must never crash when `gh` is absent")
2. What *not* to nitpick
3. Ignored paths
4. Require `file:line` references, never guessed filenames
5. Require a top-level summary with a count, or the exact words "no issues"

The reviewer prompt reads `REVIEW.md` (and `CLAUDE.md`) from the worktree when present. The
recurring-finding loop the article describes is: a finding keeps appearing → add a line to
`REVIEW.md` or a lint rule, not another review cycle.

### E. Feedback: `gloop stats` + reap records outcomes

- `gloop reap` / `gloop drop --if-merged`, when a PR is merged, sets `mergedAt` on the matching
  history record and makes a best-effort revert check (`gh pr list --search "Revert" ...`
  mentioning the PR number); records `reverted: true|false|null` (null = could not tell).
- New command **`gloop stats`**: per-loop table (slug, mode, outcome, cycles, findings, merged,
  reverted) and aggregates: loops run, shipped %, needs-human %, blocked % by gate, median and
  p95 review cycles-to-pass, revert rate. Reads only `history.json`; works without `gh`.
- `gloop run --dry-run` prints **every** stage's prompt and command, in order.

### F. Skills + docs kept in sync

- `/gloop-build` mirrors the stage order, the proof requirement, the convergence rules, the
  security step, and the severity rules, for the interactive path. Shared hard-rule strings
  move to `lib/rules.js`; a test asserts each string appears verbatim in `gloop-build/SKILL.md`
  so prompt and skill cannot drift (this replaces the manual "keep in sync" note in `CLAUDE.md`).
- `/gloop-ship` includes `PROOF.md` in the PR body and refuses (asks for explicit confirmation)
  when a sensitive path was touched.
- `gloop init`'s CLAUDE.md conventions block: Definition of Done gains "proof attached",
  "security review clean or resolved with reason", and "REVIEW.md followed".
- `./setup --team` prints the branch-protection settings the article relies on and gloop cannot
  enforce: dismiss approvals on new commits; bot approvals do not satisfy required reviews;
  CODEOWNERS for CI, auth, billing, release paths.
- New `docs/REVIEW_LAYERS.md`: the seven layers from the article and which gloop stage, skill,
  or config line implements each (and which are deliberately out of scope).

### Mode table (updated)

| Mode | Author perm | Reviewer | review+security | PR step |
|---|---|---|---|---|
| interactive | live session | `/gloop-build` runs them in-session (new-context subagents) | you drive | you run `/gloop-ship` |
| bypass | `acceptEdits` + shell; push denied (3 layers) | separate `claude -p`, read-only | auto, converging | **stops before push** |
| autonomous | `bypassPermissions` | separate `claude -p`, read-only | auto, converging | ready PR, **unless sensitive path → stops before push** |

## P0 as built (2026-10-26)

Status: **built**, 58 tests green. Deviations from the design above, each made for a reason
found while building:

- **The reviewer has no shell.** The driver computes each diff (`git diff <range>`) and saves it
  as `review/cycle-N.<repo>.diff`; the reviewer gets `Read`, `Grep`, `Glob` and nothing else.
  Allowing `Bash(git diff:*)` would not match the `git -C <repo> diff` form the reviewer needs
  from the feature folder, and a shell is more than a reviewer needs. Verified against the real
  CLI: the reviewer could not run a command, read the diff file, found a planted bug, and
  returned JSON that passed validation with the tree untouched.
- **The reviewer does not write its findings file.** It replies with one fenced JSON block; the
  driver extracts, validates and writes `review/cycle-N.json`, and keeps the raw reply as
  `cycle-N.raw.txt` for when validation fails.
- **Fix attempts are numbered on their own** (`fix-N.resolutions.json`). A fix that commits
  nothing gets no re-review, so two attempts can follow one review; sharing the review's cycle
  number let a later attempt re-read an earlier attempt's stale resolutions.
- **The build gate is run by the driver**, not an agent: the output saved as proof is the real
  output and cannot be paraphrased.
- **Code changed during QA gets a diff-only review** of those commits, sharing the fix budget,
  so nothing ships unreviewed.
- **Bypass ship spawns no agent**: the driver prints `git push` + `gh pr create --body-file
  PROOF.md` per touched repo.
- **Validation is strict on honesty**: a summary that contradicts the findings list (says
  "1 issue", lists none; or "no issues", lists some) is invalid; a stage that writes no
  `stage-<name>.json` is not done; a build with no commits is blocked.
- Orchestration lives in a new agent-agnostic `lib/pipeline.js`; everything Claude-specific
  (flags, prompts, spawning) stays in `lib/driver.js`.

**Fixed after P0 (2026-10-27): bypass could not commit, and nothing but the prompt stopped
a push.** Bypass authors ran with `acceptEdits`, which auto-accepts edits but not shell
commands; verified against the real CLI, a headless `acceptEdits` session could not run
`git commit`, so every bypass run ended `BLOCKED: build produced no commits`. Now:

- Bypass authors get `--allowedTools Bash` (tests, builds, commits run headlessly).
- **Only an autonomous `ship` stage may push.** Every other stage, in every mode, is guarded
  three ways, because each layer alone leaks (all verified against real git / the real CLI):
  1. Permission deny: `Bash(git push:*)`, `Bash(gh pr create:*)`, `Bash(gh pr merge:*)`.
     Catches `git push ...` and `cd repo && git push`; does **not** match `git -C repo push`.
  2. Git URL rewriting in the agent's env (`url.gloop-push-blocked://.pushInsteadOf` for
     `https://`, `ssh://`, `git@`, `/`, …, appended to any existing `GIT_CONFIG_COUNT`).
     Catches `git -C repo push` and explicit URLs; git does **not** apply it to a remote that
     has its own `pushurl`.
  3. After every author stage, the driver compares `refs/remotes/origin/<branch>`; if it moved,
     the run ends `BLOCKED: push-guard`. Catches the pushurl case after the fact (the branch
     reached the remote, but no PR was opened and the run stops).

## P1 plan (2026-10-27)

### Workflow contract (must not break)

The owner's daily workflow is three slash commands: **`/gloop-spec` → `/gloop-build` →
`/gloop-ship`**. P1 keeps their names, their order, what each one is for, and what the user types.
P1 only *adds* checks inside them, and none of the additions asks the user a new question:

| Command | Stays | P1 adds |
|---|---|---|
| `/gloop-spec` | interview → commit `SPEC.md` → "next: `/gloop-build`" | nothing |
| `/gloop-build` | implement → review → QA → build gate; never pushes; "next: `/gloop-ship`" | a security review step after review; reads `REVIEW.md`; notes sensitive paths in `PROOF.md` |
| `/gloop-ship` | `/ship` → PR per repo → `gloop stop` | runs `gloop risk`; if sensitive paths were touched, says so in the PR body and to the user. **Does not block or ask.** |

A test (`test/workflow.test.js`) pins these invariants so a later change cannot quietly break them.

### Decisions and deviations from the original P1 design

1. **Security review uses gloop's own security-reviewer prompt**, not Claude Code's
   `/security-review`. The reviewer has no shell (see P0), and `/security-review` needs one to
   read the branch. Same findings contract as review (`important` = an exploitable
   vulnerability this change introduces; `nit`, `pre-existing` never block), ids `s<cycle>-NN`,
   output in `security/`. AC12 ("skipped when `/security-review` is unavailable") becomes:
   `"review": {"security": false}` in `loops.json` turns the stage off and the run records it as
   skipped.
2. **Security has its own fix budget** (`fixCycles`, same number), so a long review cannot starve
   it. Security fixes get a diff-only *security* re-review; QA runs after both, so a functional
   regression from a security fix is still exercised.
3. **Code changed during QA gets both a diff-only review and a diff-only security review.**
4. **Interactive `/gloop-ship` warns, it does not block,** on sensitive paths: the person running
   it is the human the article asks for. Only autonomous mode stops before push on them.
5. **New `gloop risk [slug]`** prints the sensitive files a loop touches. The pipeline's risk stage
   and the `/gloop-build` and `/gloop-ship` skills share it, so there is one definition of
   "sensitive".
6. **Default `sensitivePaths`** applies when `loops.json` has none, so existing workspaces get it
   without editing config (opt out with `[]`). Revised list: CI (`.github/workflows/**`,
   `.gitlab-ci.yml`, `.circleci/**`, `Jenkinsfile`), ownership (`CODEOWNERS`, `.github/CODEOWNERS`),
   `**/auth/**`, `**/billing/**`, `**/payments/**`, `**/migrations/**`, installers (`setup`,
   `**/install*`). Dropped `**/*.yml`: it stops the loop on every config edit.
7. **`gloop init` is safe to re-run.** In a workspace that already has `loops.json` it leaves the
   file alone and only adds what is missing (`REVIEW.md` per repo, the CLAUDE.md section). That is
   how existing workspaces adopt P1.
8. **`REVIEW.md` reaches the reviewer even before it is committed.** The reviewer reads the
   worktree's copy; if the worktree has none, the driver copies the root checkout's copy into the
   run dir and points the reviewer at it.

### P1 as built (2026-10-27)

Status: **built**, 82 tests green, all P1 criteria above met. Verified against the real CLI:
the security reviewer, read-only, flagged a planted shell injection as one `important` finding
at the right file and line, returned "no issues" on a harmless change, and left both repos
untouched. Both replies passed the strict findings validation.

- Workflow contract holds: `/gloop-spec` is unchanged; `/gloop-build` and `/gloop-ship` only
  gained steps; `test/workflow.test.js` was checked by deliberately breaking `/gloop-ship`
  (adding a confirmation question, calling a non-existent command) and seeing it fail.
- Evidence per run gains `security/` (diffs, raw replies, findings, resolutions), `risk.json`,
  `guides/` (REVIEW.md copies) and `proof/PR_BODY.md` (PROOF.md + sensitive paths, used as the
  PR body whenever the run stops before push).
- History records gain `cycles.securityFix`, `securityFindings` (null when security is off) and
  `sensitive` (`repo/file` list).

### P1 stage order (headless)

```
build → review ⇄ fix → security ⇄ secfix → qa → [review, security on qa's commits]
      → buildgate → proof → risk → ship | stop before push (bypass, or autonomous + sensitive)
```

### P1 acceptance criteria (in addition to 11–18 above)

- P1-1 Security findings follow the review contract; an open important one ends the run
  `BLOCKED: security review did not converge …`; a reviewer that edits the tree or returns invalid
  JSON blocks exactly as in review.
- P1-2 `review.security: false` skips the stage and records `security: skipped` in `status.json`.
- P1-3 `gloop risk` lists `repo: file` for every touched file matching `sensitivePaths`, or says
  none; it never needs `gh` or `claude`.
- P1-4 Re-running `gloop init` in a configured workspace leaves `loops.json` byte-identical and adds
  only missing `REVIEW.md` files.
- P1-5 `test/workflow.test.js` passes: the three commands keep their names, order, and roles.

## P2 plan (2026-10-27)

The P1 workflow contract still holds: `/gloop-spec` → `/gloop-build` → `/gloop-ship` keep their
names, order and jobs, and gain no question for the user. `test/workflow.test.js` stays green.

### Decisions and deviations from the original P2 design

1. **Interactive loops are measured too.** The owner's daily workflow is interactive, and only
   headless runs write `history.json`, so a stats command built on that file alone would show
   nothing for most real loops. When `gloop reap` (or `drop --if-merged`) sees a merged PR for a
   loop whose latest record is not a successful headless run, it appends a record with
   `mode: "interactive"` (cycle counts `null`: the driver did not run them). Merges and reverts,
   the article's guardrail metric, are then counted for every loop.
2. **Reverts are checked over time, not once.** A revert happens days after a merge, so a check
   at merge time almost always says "no". `gloop reap` re-checks every merged record from the
   last 30 days whose `reverted` is not yet `true`; `gloop stats --refresh` does the same on
   demand. Plain `gloop stats` stays offline and reads only `history.json`.
3. **What counts as a revert:** a GitHub revert PR (body `Reverts owner/repo#N`, or title
   `Revert "<original title>"`), or a commit on the base branch whose message says
   `This reverts commit <merge sha>`. `reverted` is `true` if either is found, `false` if at least
   one check ran and found nothing, `null` if neither could run.
4. **Merge details are stored per repo** (`merged: { repo: { number, url, title, mergeCommit,
   mergedAt } }`), so the revert check can run after the worktree is gone.
5. **`lib/rules.js` holds nine rule sentences.** They appear verbatim in the driver's author
   prompts and in a "Rules" section of `/gloop-build`; `test/rules.test.js` fails on any drift.
   This replaces the manual "keep in sync" convention.
6. **CLAUDE.md conventions:** new workspaces get the updated Definition of Done (proof, security
   review, REVIEW.md, sensitive paths). An existing section is left as is, never rewritten under
   the owner; `gloop init` says it is older and where the current text lives.
7. **Branch protection is printed, never applied.** `./setup --team` prints
   `templates/branch-protection.md`: dismiss stale approvals on new commits, bot approvals do not
   count, require conversation resolution, CODEOWNERS for the sensitive paths.
8. **Tests use a fake `gh`** (`test/fixtures/gh-bin/gh`), the same pattern as the fake `claude`:
   no test touches GitHub.

### P2 as built (2026-10-27)

Status: **built**, 121 tests green, criteria 19–22 and P2-1…P2-4 met. The workflow contract
still holds (`/gloop-spec` untouched; `/gloop-build` gained only its "Rules" section;
`/gloop-ship` unchanged in P2). New guard tests were checked by deliberately breaking the code
they protect: rewording one rule in `/gloop-build`, letting a blocked run absorb a later merge,
skipping the merge-time revert check, and narrowing revert-PR matching all turn the suite red.
That last one first slipped through, because the test's revert PR matched by title as well as
body; it is now two tests, one per matching rule.

- `gloop stats` shows up to the latest 20 runs and the aggregates; `--json` for scripts;
  `--refresh` re-checks recent merges first.
- History records gain `converged: { review, security }` (recorded, not inferred, from P2 on),
  `merged` (per-repo PR details) and `revertCheckedAt`.
- `gloop init --print-conventions` prints the current CLAUDE.md section, for workspaces whose
  section predates the review layers.

### P2 acceptance criteria (in addition to 19–22 above)

- P2-1 Reaping a merged loop with no headless record appends one `interactive` record with its
  PR, merge commit and `mergedAt`; reaping a loop whose latest record shipped updates that record.
- P2-2 `reverted` becomes `true` when a revert PR or revert commit appears after the merge, on the
  next `reap` or `stats --refresh`; records older than 30 days are not re-checked by reap.
- P2-3 `gloop stats --json` prints the same numbers as the table, for scripts.
- P2-4 `gloop init` in a workspace whose CLAUDE.md section predates P2 leaves it unchanged and
  prints a hint.

## Phases

**P0 — backbone (land first).** Stage runner; author/reviewer processes; findings + resolution
contract; proof contract and `PROOF.md` in PR body; convergence rules (diff-only re-review,
class, no re-report, pre-existing non-blocking, BLOCKED after N); reviewer tree-unchanged check;
`status.json` + `history.json` record; `--dry-run` per stage.

**P1 — gates.** Security stage; `risk` stage + `sensitivePaths` config + `needs-human` status in
`ls`; `REVIEW.md` scaffold in `init` and reviewer reads it.

**P2 — feedback + sync.** `gloop stats`; reap records `mergedAt`/`reverted`; `lib/rules.js` +
sync test; skill bodies; CLAUDE.md conventions; `setup --team` branch-protection printout;
`docs/REVIEW_LAYERS.md`; README/QUICKSTART updates.

## Acceptance criteria

**Stage runner + reviewer isolation**
1. `gloop run x --mode bypass --dry-run` prints each stage in order (`build, review, fix?,
   security, fix?, qa, buildgate, risk, ship`) with its prompt and its `claude` argv; nothing
   is spawned.
2. The review stage runs as a separate process from the build stage (distinct `claude -p`
   invocations, verified by a fake `claude` binary on PATH in tests that logs each call).
3. If the reviewer stage changes `HEAD` or leaves the tree dirty, the run ends
   `BLOCKED: reviewer modified tree` and nothing is pushed.
4. A reviewer output that is not valid JSON, or lacks `summary`/`findings`, ends the run
   `BLOCKED: review output invalid` with the file path printed.

**Convergence**
5. Cycle 1's reviewer prompt contains the full `origin/<base>...HEAD` range; cycle 2's contains
   only `<cycle-1 head>..HEAD` and the cycle-1 findings file with the no-re-report instruction.
6. `nit` and `pre-existing` findings alone never trigger a fix cycle or block ship.
7. An `important` finding with no resolution after `fixCycles` cycles ends the run
   `BLOCKED: review did not converge after N cycles — re-evaluate the approach`, listing the
   open ids. With `--fix-cycles 3` the limit is 3.
8. A `wontfix` resolution without a non-empty `reason` is treated as unresolved.

**Proof**
9. Ship never starts without `proof/PROOF.md`; its absence ends the run `BLOCKED: no proof`.
10. `PROOF.md` has the three headings Testing / Risk / How to revert, and the ship prompt
    instructs that it be pasted into the PR body verbatim.

**Security**
11. An open security finding blocks ship exactly like an important review finding; a
    `wontfix` with reason unblocks it.
12. When `/security-review` is unavailable the run continues, `status.json` records the stage
    as skipped with the reason, and the console shows a warning.

**Risk tiers**
13. In autonomous mode, a diff touching any `sensitivePaths` glob ends the run in bypass
    behaviour: no push, printed push/PR commands, status `needs-human`, reason naming the file.
14. The glob matcher handles `**`, `*`, `?` and plain paths; `.github/workflows/ci.yml` matches
    `.github/workflows/**` and `**/*.yml`; `src/author.js` does **not** match `**/auth/**`.
15. `gloop ls` shows `needs-human (touched <file>)` for such a loop.
16. `gloop init` writes the default `sensitivePaths` list into `loops.json`.

**REVIEW.md**
17. `gloop init` creates `REVIEW.md` in each repo lacking one, with the five sections; an
    existing `REVIEW.md` is left untouched.
18. The reviewer prompt names `REVIEW.md` and `CLAUDE.md` and instructs the reviewer to follow
    them when present.

**Feedback**
19. Every headless run appends exactly one record to `.loops/history.json` with the fields in
    §A, whatever the outcome.
20. `gloop reap` on a merged loop sets `mergedAt` and `reverted` (`null` when `gh` cannot tell)
    on that loop's latest record.
21. `gloop stats` prints the per-loop table and aggregates from `history.json` alone, and says
    "no runs yet" on an empty file. It works with `gh` absent.

**Sync + degrade**
22. A test fails if any string exported by `lib/rules.js` is missing from
    `skills/gloop-build/SKILL.md` or from the driver's prompts.
23. Nothing in this spec crashes when `gh`, `claude`, or `/security-review` is absent; each
    missing dependency produces one clear message.
24. All existing v1 tests still pass; `gloop new/ls/drop/reap` behaviour is unchanged.

## Testing plan

| Layer | What | Count |
|---|---|---|
| Unit | glob matcher; findings/resolution validation; blocking decision (severity × resolution × cycle); diff-range selection per cycle; history record shape; stats aggregation (median/p95) | +10 |
| Integration | stage runner against a **fake `claude`** script that writes canned findings/proof per stage: converge-in-1, converge-in-2, never-converge → BLOCKED, reviewer-dirties-tree → BLOCKED, missing proof → BLOCKED, sensitive path → needs-human, security skipped when unavailable; `init` writes REVIEW.md + sensitivePaths; `reap` updates history | +9 |
| Skills | rules sync test (`lib/rules.js` ↔ `gloop-build/SKILL.md` ↔ driver prompts); frontmatter test covers `gloop stats`-related docs if any | +1 |
| E2E (manual, documented) | one real autonomous run on a fixture repo: PR body contains PROOF.md; `history.json` has the record; `gloop stats` shows it | 1 |

## Rollback

Additive. The single-process v1 driver path is kept behind `--legacy-driver` for one release so
a bad stage runner is a flag flip away. `history.json`, `runs/`, `REVIEW.md`, and the `review`
config block are all optional: their absence means v1 behaviour. Removing the package removes
everything; loops remain ordinary branches and worktrees.

## Effort estimate (CC-assisted)

- P0 stage runner + contracts + proof + convergence + history record + dry-run: ~6h
- P1 security stage + risk stage + glob matcher + REVIEW.md scaffold + `ls` status: ~3h
- P2 `stats` + reap outcome + rules.js sync + skills + docs + setup printout: ~3h
- Tests + fake-claude fixture: ~3h

## Files reference

| Path | Change |
|---|---|
| `lib/driver.js` | agent-specific: per-stage prompts, reviewer/author argv, spawning; legacy v1 prompt behind `--legacy-driver` |
| `lib/pipeline.js` | **new** (P0) — agent-agnostic stage runner: contracts, convergence, tree-unchanged check, build gate, proof check, history record, dry-run plan |
| `lib/rules.js` | **new** — shared hard-rule strings used by prompts and asserted in skills |
| `lib/review.js` | **new** — findings/resolution schema validation, blocking decision, diff ranges |
| `lib/risk.js` | **new** (P1) — zero-dep glob matcher, default sensitive list, sensitive-path check |
| `commands/risk.js` | **new** (P1) — `gloop risk [slug]`, shared by the risk stage and the skills |
| `test/p1.test.js`, `test/workflow.test.js` | **new** (P1) — matcher, config, `gloop risk`, re-runnable init; the three-command workflow contract |
| `lib/history.js` | **new** (P0) — `.loops/history.json` storage; P2 adds `update` and `computeStats` |
| `lib/config.js` | `review.fixCycles`, `review.sensitivePaths` defaults |
| `commands/run.js` | drive the stage runner; `needs-human` outcome; per-stage dry-run |
| `commands/init.js` | `REVIEW.md` scaffold; `sensitivePaths` default; updated CLAUDE.md conventions |
| `commands/ls.js` | show `needs-human (touched …)` |
| `commands/drop.js` / `reap.js` | update history with `mergedAt` / `reverted` |
| `commands/stats.js` | **new** (P2) — `gloop stats [--json] [--refresh]` |
| `lib/outcomes.js` | **new** (P2) — record merges (headless and interactive), detect reverts |
| `test/fixtures/gh-bin/gh`, `test/outcomes.test.js`, `test/rules.test.js`, `test/p2.test.js` | **new** (P2) — fake `gh`; merges, reverts, stats; rules sync; conventions, branch protection, docs |
| `templates/branch-protection.md` | **new** (P2) — printed by `./setup --team` |
| `bin/gloop` | `stats` subcommand; `--legacy-driver` flag; help text |
| `skills/gloop-build/SKILL.md`, `gloop-ship/SKILL.md`, `gloop-run/SKILL.md`, `gloop/SKILL.md` | mirror stages, proof, convergence, severity, sensitive paths |
| `templates/loops.json`, `templates/REVIEW.md` | config + scaffold |
| `setup` | `--team` prints branch-protection recommendations |
| `docs/REVIEW_LAYERS.md` | **new** — article layers ↔ gloop implementation map |
| `docs/SPEC-v1.md` | moved from `SPEC.md` |
| `test/review.test.js`, `test/pipeline.test.js`, `test/fixtures/bin/claude` | P0 tests: review contract units; stage runner against a fake `claude` on PATH |
| `test/units.test.js`, `test/integration.test.js`, `test/skills.test.js` | per testing plan (P1/P2) |
| `README.md`, `QUICKSTART.md`, `CLAUDE.md` | document the layers, `stats`, `REVIEW.md`, modes table |

## Out of scope (v1.1)

- Merge queue, feature flags, staged rollouts, auto-merge of low-risk changes: gloop stops at
  the PR by design. Branch protection and CODEOWNERS are *recommended* by `setup --team`, never
  configured.
- Multi-agent vote on findings (the article's false-positive filter). One fresh reviewer per
  cycle in v1.1; the findings contract leaves room for a `votes` field later.
- Overnight repo-wide review of pre-existing bugs.
- Measuring how humans react to findings on GitHub (fixed / rejected / intentional). v1.1
  measures the agent-side loop only (cycles, findings, outcome, revert).
- Non-Claude agents, as in v1.

## Related

- Source article: https://x.com/addyosmani/status/2114604912520921136
  (rewrite of https://claude.dev/blog/solving-code-review-at-anthropic/)
- Claude Code best practices (verification + fresh-context subagent review):
  https://code.claude.com/docs/en/best-practices
- v1 design: `docs/SPEC-v1.md`; parallel shipping rules: `docs/PARALLEL_SHIPPING.md`
