// The loop's rules, one sentence each. The headless driver puts them verbatim in every
// author prompt (lib/driver.js) and /gloop-build lists them verbatim in its "Rules" section,
// so the interactive and headless paths follow the same rules. test/rules.test.js fails if
// either copy drifts. Edit here, then paste into skills/gloop-build/SKILL.md.
const RULES = [
  'Never ship red: if a gate cannot pass within its fix budget, stop and report which gate failed and why. Do not push.',
  'The author never reviews its own work: review and security review run in a fresh context and change nothing.',
  'Only important findings block; nit and pre-existing findings never block.',
  'A finding is resolved only by a fix with a commit in its repo, or by a wontfix with a reason.',
  'A re-review looks only at the commits since the last review and never re-reports a resolved finding unless its fix is missing or wrong.',
  'Show, do not tell: every claim needs saved evidence, and PROOF.md (Testing, Risk, How to revert) becomes the PR body.',
  'Stay inside the worktrees. Never touch main or the root checkouts.',
  'The spec is fixed. If it is wrong or ambiguous, stop and report; do not guess.',
  'Changes to sensitive paths always get a human reviewer before they are pushed.',
];

module.exports = { RULES };
