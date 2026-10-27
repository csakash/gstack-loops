# REVIEW.md

What gstack-loops' reviewer should care about in this repo. It reads this file on every review,
headless or in `/gloop-build`. Keep it short. When the same finding keeps coming back, add a line
here (or a lint rule) rather than paying for another review cycle.

## What failure looks like here
<!-- The few things that must never break. Replace the example. -->
- Example: the CLI must never crash when an optional tool (gh, docker) is missing.

## Do not nitpick
- Formatting and naming the linter or formatter already enforces.
- Style preferences with no effect on behavior.

## Ignore
<!-- Paths the reviewer should skip. -->
- Generated files, lockfiles, vendored code.

## How to report
- Every finding names a file and a line. Never guess a filename.
- Start with a summary that gives the count, or says exactly "no issues".
