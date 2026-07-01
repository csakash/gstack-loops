// The loop driver: maps a mode to Claude Code permissions + gates, builds the
// driving prompt, and (for headless modes) spawns `claude -p` in the loop's
// feature container. Interactive mode hands control to a live session instead.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { c } = require('./util');

// mode -> behavior. headless=false means we launch an interactive session.
const MODES = {
  interactive: { permissionMode: 'default', headless: false, autoPush: false },
  bypass: { permissionMode: 'acceptEdits', headless: true, autoPush: false },
  autonomous: { permissionMode: 'bypassPermissions', headless: true, autoPush: true },
};

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

// The instruction the headless session runs. Encodes the pipeline, the
// verify-fix cycles, the "never ship red" rule, and mode-specific PR behavior.
function buildPrompt(cfg, loop, mode, opts = {}) {
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

// Build the argv for the headless claude invocation (also used by --dry-run).
function claudeArgs(cfg, loop, mode, opts = {}) {
  const m = MODES[mode];
  const prompt = buildPrompt(cfg, loop, mode, opts);
  return { bin: 'claude', args: ['-p', prompt, '--permission-mode', m.permissionMode] };
}

// Spawn the headless session, streaming output. Resolves with exit code.
function spawnHeadless(cfg, loop, mode, opts = {}) {
  const { bin, args } = claudeArgs(cfg, loop, mode, opts);
  const cwd = path.join(cfg.root, cfg.worktreeDir, loopSlug(loop));
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, stdio: 'inherit', env: process.env });
    child.on('error', (e) => {
      console.error(c.red(`✗ could not launch ${bin}: ${e.message}`));
      resolve(127);
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

module.exports = { MODES, hasSpec, buildPrompt, claudeArgs, spawnHeadless, loopSlug, featureDir };
