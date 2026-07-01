# Shipping multiple loops in parallel — without conflicts or blockers

gstack-loops isolates each feature in its own branch + worktree + port block, so loops can't
collide *while you build*. Conflicts only appear at two moments: **shared runtime state**
(a database or service every loop points at) and **merge time**. This is how to neutralize
both.

## Already solved by the harness

| Collision | Why it can't happen |
|---|---|
| Two loops editing the same files | separate git worktrees per loop |
| Committing to the wrong branch | one `feat/<slug>` branch per loop |
| Dev servers fighting over ports | port block per loop (`basePort + slot*portStride`) |
| A service hitting the wrong sibling | `{{port/url:repo}}` env wiring, per loop |

## The real risks

### 1. Shared runtime state (databases, queues, buckets)

`gloop new` seeds each worktree's `.env` from the root checkout — so by default every loop
points at the **same** database. Parallel schema migrations or seeds will corrupt each other.

- Never run migrations/seeds in two loops at once. Treat schema changes as a serialization
  point.
- Isolate per loop with the **`hooks.preLoop`** script in `loops.json` — provision a DB
  branch / scratch schema and rewrite that loop's `DATABASE_URL`. This is the intended place
  to solve it generically:
  ```json
  "hooks": { "preLoop": "./scripts/provision-db-branch.sh" }
  ```
- If you must share, only the loop changing the schema touches it, and it tells the others.

### 2. Cross-repo API contract

A feature spanning repos ships one PR per repo. Merge the **producer before the consumer**
(e.g. backend endpoint before the frontend that calls it), or `main` breaks. Write the API
shape into `SPEC.md` up front and cross-link the PRs so no one merges them out of order.

### 3. Shared-file merge conflicts

`package.json` version, `package-lock.json`, and any shared module are edited by most loops.
Rebase on the latest base branch before shipping; regenerate lockfiles (`npm install`) rather
than hand-merging.

### 4. Stale base branch

Loops branch from the base at creation time. If loop A merges while loop B is in flight, B is
behind. **Rebase on the base branch and re-verify before every ship** — the single most
important habit.

## The workflow

1. **Slice features to touch different files.** The cheapest conflict is the one you designed
   out.
2. **Keep loops short.** Land within a day or two; short branches diverge less.
3. **Merge train.** When several PRs are ready, land them one at a time; rebase the rest after
   each merge and re-run `/review` + `/qa`.
4. **Producer before consumer** across repos; schema before the code that reads it.
5. After merge: `gloop reap` (or `gloop drop <slug>`) tears down the loop.

## TL;DR

One loop per feature (isolation is automatic) → slice features disjoint → isolate shared state
with `hooks.preLoop` → merge producer before consumer → rebase + re-verify before every ship,
landing PRs one at a time. Do these and parallel shipping stays boring.
