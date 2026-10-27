---
name: gloop
description: |
  Conversational driver for gstack-loops. Invoke as `/gloop <plain English>` and it
  figures out where the loop is and advances it — create the loop, spec it, build it
  green, and ship a PR — so you just keep describing what you want instead of memorizing
  commands. Use when you want the loop driven from natural-language prompts.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Skill
---

# /gloop — conversational loop driver

Invoked as `/gloop <what you want>`. Read the user's prompt, work out where the loop is,
and advance it one intelligent step — then, once a spec exists, keep driving to a PR unless
the user says stop. You are the low-friction front-end over the `gloop` CLI + gstack skills;
the user should never need to remember command names.

## 1. Figure out the current state

- Run `gloop ls` to see active loops.
- Determine the **active loop**: if the cwd is inside a worktree (`worktrees/<slug>/...` or a
  repo worktree on a `feat/<slug>` branch), that's the loop. If there are multiple loops and
  the prompt doesn't name one, **ask which loop** (do not guess). If there are none, the
  prompt is a new feature.
- Check whether `SPEC.md` exists on the loop branch.

## 2. Map the prompt to the next step

| State | What the prompt means | Action |
|---|---|---|
| No loop yet, prompt describes a feature | "start this" | derive a kebab slug → `gloop new <slug>`, then go to `/spec` |
| Loop exists, no `SPEC.md` | "spec it" | run `/gloop-spec` (interactive interview → commit SPEC.md) |
| `SPEC.md` exists | "make it real" | run `/gloop-build` (build→/review→/qa until clean), then `/gloop-ship` |
| Prompt is a tweak to an in-progress build | refine | apply it within `/gloop-build` |
| Prompt says stop / pause / wait | halt | stop after the current step; report state |
| Prompt asks how loops are going | report | run `gloop stats` and summarize it in a few lines |

## 3. Autonomy: drive to a PR unless told to stop

Once `SPEC.md` is approved, keep going through **build → /review → /qa → ship** to a
ready-for-review PR without waiting for another prompt — this is the default. Exceptions:

- The **spec step is always interactive** (it needs the user's answers). Do not auto-answer
  `/spec`.
- If the user's message contains stop / pause / "just do X" / "don't ship", honor it: do only
  that and stop.
- **Never ship red.** If `/review` or `/qa` can't reach clean or the build fails, STOP, keep
  the worktree, and report which gate failed. Do not push.

## 4. Always report

After each turn, say: which loop, what you just did, and what you'll do next (so the user can
redirect with their next prompt). Keep it to a few lines.

## Notes
- `gloop <verb>` in the shell stays literal; `/gloop <text>` (this skill) is the
  conversational path. They don't collide.
- Everything you do is a normal `gloop` command or gstack skill — you're orchestrating, not
  reimplementing.
