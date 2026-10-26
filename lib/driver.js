// The loop driver: everything agent-specific lives here — mode -> permission mapping,
// the per-stage prompts, and how an agent process is spawned. lib/pipeline.js
// sequences the stages without knowing it is talking to Claude. Interactive mode
// hands control to a live session instead.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { c } = require('./util');

const AGENT_BIN = 'claude';

// mode -> behavior. headless=false means we launch an interactive session.
const MODES = {
  interactive: { permissionMode: 'default', headless: false, autoPush: false },
  bypass: { permissionMode: 'acceptEdits', headless: true, autoPush: false },
  autonomous: { permissionMode: 'bypassPermissions', headless: true, autoPush: true },
};

// The reviewer reads, never acts. The driver hands it each diff as a file, so it needs
// no shell at all: Bash and every write tool are denied, and pipeline.js still checks
// the tree is unchanged afterwards.
const REVIEWER_ALLOWED = ['Read', 'Grep', 'Glob'];
const REVIEWER_DENIED = ['Bash', 'Edit', 'Write', 'NotebookEdit'];

function featureDir(cfg, loop) {
  return path.join(cfg.root, cfg.worktreeDir, loopSlug(loop));
}

function loopSlug(loop) {
  // slug is the parent dir of any worktree path: worktrees/<slug>/<repo>
  const any = Object.values(loop.worktrees)[0];
  return any ? path.basename(path.dirname(any)) : '';
}

// True if SPEC.md exists in any of the loop's worktrees.
function hasSpec(cfg, loop) {
  return Object.values(loop.worktrees).some((rel) => fs.existsSync(path.join(cfg.root, rel, 'SPEC.md')));
}

// ---- stage prompts -------------------------------------------------------------
// Each starts with two marker lines (stage, run dir): humans read them in --dry-run,
// and the test fixture keys its canned behavior off them.

function hardRules(p) {
  return [
    'HARD RULES:',
    `- NEVER ship red: if a gate cannot pass within ${p.fixCycles} cycles, STOP and report which gate failed and why. Do not push.`,
    '- Stay inside the worktrees. Never touch main or the root checkouts.',
    '- The spec is fixed. If it is wrong or ambiguous, STOP and report — do not guess.',
    `- Show, do not tell: never claim a result you did not produce. Evidence goes under ${p.runDir}/proof/.`,
  ].join('\n');
}

function header(p, stage, cycle) {
  return [
    `GLOOP-STAGE: ${stage}${cycle ? ` cycle=${cycle}` : ''}`,
    `RUN DIR: ${p.runDir}`,
  ].join('\n');
}

function authorIntro(p) {
  return [
    `You are the AUTHOR in an autonomous gstack loop for feature "${p.slug}" (branch ${p.branch}), spanning: ${p.repoNames.join(' + ')}.`,
    `Your working directory is the feature folder; each repo is a subfolder (${p.repoNames.map((n) => `${n}/`).join(', ')}).`,
    'The RUN DIR holds this run\'s evidence. Write there; never commit it.',
  ].join('\n');
}

function stageReportLine(p, stage, okExtra = '') {
  return `Finish by writing ${p.runDir}/stage-${stage}.json: {"status":"ok"${okExtra}} — or {"status":"blocked","reason":"<why>"} if you cannot.`;
}

function buildPrompt(p) {
  return [
    header(p, 'build'),
    authorIntro(p),
    '',
    'This stage: implement the spec. A separate reviewer, QA, a build gate and ship run after you; do not run /review, /qa or /ship yourself.',
    '1. Read SPEC.md in each repo worktree. It is the source of truth. Do not re-scope.',
    '2. Implement it. Small, focused commits per repo.',
    `3. Run each touched repo's tests. Save the exact command(s) and their full output to ${p.runDir}/proof/tests.txt.`,
    `4. Write ${p.runDir}/proof/PROOF.md with exactly three sections: "## Testing" (what you ran and what it showed, pointing at files in proof/), "## Risk" (what could break and how far), "## How to revert" (exact steps).`,
    `5. ${stageReportLine(p, 'build')}`,
    '',
    hardRules(p),
  ].join('\n');
}

function reviewPrompt(p, { cycle, ranges, previous }) {
  const lines = [
    header(p, 'review', cycle),
    `You are a fresh-context REVIEWER for feature "${p.slug}" (branch ${p.branch}). You did not write this code.`,
    'Do not modify any file, commit, or run anything that changes state. Report only.',
    '',
    'Review exactly these changes. Each diff is saved to a file; read it, then read the surrounding code in the repo folder as needed:',
    ...ranges.map((r) => `  ${r.repo}: ${r.range}  ->  ${r.diffFile}`),
  ];
  if (cycle > 1) {
    lines.push(
      '',
      `This is re-review cycle ${cycle}. Review ONLY the ranges above: the commits made since the last review.`,
      `Earlier findings and how they were resolved: ${previous}`,
      'Do not re-report an id listed there unless its fix is missing or wrong; in that case reuse the same id.',
    );
  }
  lines.push(
    '',
    'Read SPEC.md (the intent) and, when present, REVIEW.md and CLAUDE.md in each repo. Follow them.',
    'Check that the change does what SPEC.md asks, fits the surrounding system, and does not break other code. For a bug fix, look for the root cause.',
    'Report bugs, not style. Severity:',
    '  important     a defect this change introduces: wrong result, crash, data loss, security hole, spec not met. Blocks ship.',
    '  nit           minor. Never blocks.',
    '  pre-existing  a real bug this change did not introduce. Never blocks.',
    'Name the CLASS of each bug (e.g. "unchecked null from registry lookup") so the author fixes every instance, not one line.',
    'Every finding needs "file" (relative to the feature folder, starting with the repo folder, e.g. backend/src/x.js) and "line". Never guess a filename.',
    '',
    'Reply with ONE fenced json block and nothing after it:',
    `{"summary": "<count and breakdown, or exactly: no issues>", "findings": [{"id": "r${cycle}-01", "severity": "important|nit|pre-existing", "class": "...", "file": "...", "line": 1, "summary": "...", "fix_hint": "..."}]}`,
  );
  return lines.join('\n');
}

function fixPrompt(p, { cycle, open, findingsFile, allFile, resolutionsFile }) {
  return [
    header(p, 'fix', cycle),
    authorIntro(p),
    '',
    `This is fix attempt ${cycle}. A separate fresh-context reviewer reported findings in ${findingsFile}. Every finding so far, with its status, is in ${allFile}.`,
    `Blocking findings you must resolve: ${open.join(', ')}.`,
    'For each: fix every instance of its class (not only the reported line) and commit in the repo the file belongs to — or, if it is not a real defect, leave the code and say why.',
    'Nits and pre-existing findings are optional: fix one only if it is trivial and safe.',
    `Re-run the affected tests and append the command and output to ${p.runDir}/proof/tests.txt.`,
    `Then write ${resolutionsFile} with one entry per blocking id:`,
    '  {"<id>": {"status": "fixed", "reason": "<what changed>"}, "<id>": {"status": "wontfix", "reason": "<why it is not a defect>"}}',
    'A "fixed" entry without a new commit in that repo counts as unresolved. A "wontfix" entry without a reason counts as unresolved.',
    '',
    hardRules(p),
  ].join('\n');
}

function qaPrompt(p) {
  return [
    header(p, 'qa'),
    authorIntro(p),
    '',
    `Dev servers are running at: ${p.qaUrls || '(none started)'}.`,
    `1. Run /qa against the URL(s). Fix every bug it finds (commit per repo). Re-run /qa. Up to ${p.fixCycles} times.`,
    `2. Save what you exercised, at which URL, and the result to ${p.runDir}/proof/qa.md. Save screenshots under ${p.runDir}/proof/qa/.`,
    `3. Update the "## Testing" section of ${p.runDir}/proof/PROOF.md with the QA result.`,
    `4. ${stageReportLine(p, 'qa')} Report blocked if /qa does not end clean.`,
    'Any code you change here gets a diff-only review afterwards.',
    '',
    hardRules(p),
  ].join('\n');
}

function shipPrompt(p, { touched }) {
  return [
    header(p, 'ship'),
    authorIntro(p),
    '',
    'All gates passed: review converged, QA clean, build clean, proof present.',
    `1. Run /ship to push and open a ready-for-review PR for each repo with commits: ${touched.join(', ')}. Cross-link the PRs when there is more than one.`,
    `2. The PR body MUST contain ${p.runDir}/proof/PROOF.md verbatim (Testing / Risk / How to revert).`,
    `3. ${stageReportLine(p, 'ship', ',"prs":{"<repo>":"<PR url>"}')}`,
    '',
    hardRules(p),
  ].join('\n');
}

const prompts = { build: buildPrompt, review: reviewPrompt, fix: fixPrompt, qa: qaPrompt, ship: shipPrompt };

// argv for one agent process. Authors run in the mode's permission mode; the reviewer
// is always read-only regardless of mode. --add-dir lets both reach the run dir.
function agentArgs({ role, mode, prompt, runDir }) {
  if (role === 'reviewer') {
    return ['-p', prompt, '--permission-mode', 'default', '--add-dir', runDir,
      '--allowedTools', ...REVIEWER_ALLOWED, '--disallowedTools', ...REVIEWER_DENIED];
  }
  return ['-p', prompt, '--permission-mode', MODES[mode].permissionMode, '--add-dir', runDir];
}

// Spawn one agent process. capture=true collects stdout (the reviewer's findings);
// echo mirrors output to the console. Resolves { code, stdout, error? }; 127 = not found.
function runAgent({ args, cwd, capture = false, echo = true }) {
  return new Promise((resolve) => {
    let stdout = '';
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    const out = capture ? 'pipe' : (echo ? 'inherit' : 'ignore');
    const child = spawn(AGENT_BIN, args, { cwd, env: process.env, stdio: ['ignore', out, echo ? 'inherit' : 'ignore'] });
    if (child.stdout) {
      child.stdout.on('data', (d) => { stdout += d; if (echo) process.stdout.write(d); });
    }
    child.on('error', (e) => finish({ code: 127, stdout, error: e.message }));
    child.on('close', (code) => finish({ code: code ?? 1, stdout }));
  });
}

// ---- legacy single-process driver (v1), kept behind --legacy-driver for one release --

function legacyPrompt(cfg, loop, mode, opts = {}) {
  const cycles = opts.fixCycles ?? 2;
  const qaUrls = Object.entries(loop.ports)
    .filter(([name]) => loop.worktrees[name])
    .map(([name, port]) => `${name}: http://localhost:${port}`)
    .join(', ');
  const repos = loop.repos.join(' + ');
  const shipLine = MODES[mode].autoPush
    ? 'Run /ship to push and open a ready-for-review PR per repo. Cross-link the PRs when the feature spans multiple repos.'
    : 'Prepare everything for /ship (tests green, build clean, changes committed) but DO NOT push. Stop and print the exact `git push` + `gh pr create` commands for the human to run.';

  return [
    `You are running an autonomous gstack loop for feature "${loopSlug(loop)}" (branch ${loop.branch}), spanning: ${repos}.`,
    `Dev servers are already running at: ${qaUrls || '(none)'}.`,
    '',
    'Execute this pipeline. Do not skip steps.',
    '1. Read SPEC.md in each repo worktree. It is the source of truth. Do not re-scope.',
    '2. Implement the spec. Small, focused commits per repo.',
    `3. Run /review. Fix every finding. Re-run /review. Repeat up to ${cycles} times.`,
    `4. Run /qa against the URL(s) above. Fix every bug found. Re-run /qa. Up to ${cycles} times.`,
    '5. Run `npm run build` in each touched repo. This is a hard gate.',
    `6. ${shipLine}`,
    '',
    'HARD RULES:',
    `- NEVER ship red: if /review or /qa cannot pass within ${cycles} cycles, or the build fails, STOP. Do not push. Report which gate failed and why.`,
    '- Stay inside the worktree. Never touch main or the root checkouts.',
    '- The spec is fixed. If it is wrong or ambiguous, STOP and report — do not guess.',
    '',
    'End with a status line: DONE (with PR URLs), or BLOCKED (naming the failing gate).',
  ].join('\n');
}

function legacyArgs(cfg, loop, mode, opts = {}) {
  return { bin: AGENT_BIN, args: ['-p', legacyPrompt(cfg, loop, mode, opts), '--permission-mode', MODES[mode].permissionMode] };
}

function spawnLegacy(cfg, loop, mode, opts = {}) {
  const { bin, args } = legacyArgs(cfg, loop, mode, opts);
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: featureDir(cfg, loop), stdio: 'inherit', env: process.env });
    child.on('error', (e) => {
      console.error(c.red(`✗ could not launch ${bin}: ${e.message}`));
      resolve(127);
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

module.exports = {
  AGENT_BIN, MODES, REVIEWER_ALLOWED, REVIEWER_DENIED,
  hasSpec, loopSlug, featureDir, prompts, agentArgs, runAgent,
  legacyPrompt, legacyArgs, spawnLegacy,
};
