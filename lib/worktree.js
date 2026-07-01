// git worktree + branch operations for a single repo.
const { run } = require('./util');

function git(repoAbs, args, opts = {}) {
  return run('git', ['-C', repoAbs, ...args], opts);
}

function branchExists(repoAbs, branch) {
  return git(repoAbs, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true, stdio: 'pipe' }) !== null;
}

function currentBranch(repoAbs) {
  return git(repoAbs, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true });
}

function fetch(repoAbs) {
  git(repoAbs, ['fetch', 'origin', '--quiet'], { allowFail: true, stdio: 'pipe' });
}

// Create a worktree at absPath on `branch`. New branch off origin/base if it
// doesn't exist yet, else check out the existing branch.
function addWorktree(repoAbs, absPath, branch, baseBranch) {
  fetch(repoAbs);
  if (branchExists(repoAbs, branch)) {
    git(repoAbs, ['worktree', 'add', absPath, branch]);
  } else {
    const base = run('git', ['-C', repoAbs, 'rev-parse', '--verify', `origin/${baseBranch}`], { allowFail: true, stdio: 'pipe' })
      ? `origin/${baseBranch}`
      : baseBranch;
    git(repoAbs, ['worktree', 'add', absPath, '-b', branch, base]);
  }
}

// Remove a worktree. force=true also drops it when it holds untracked files
// (like the seeded .env). Safe because callers gate on ahead/dirty first.
function removeWorktree(repoAbs, absPath, force = false) {
  const args = ['worktree', 'remove', absPath];
  if (force) args.push('--force');
  git(repoAbs, args, { stdio: 'pipe' });
}

function pruneWorktrees(repoAbs) {
  git(repoAbs, ['worktree', 'prune'], { allowFail: true });
}

function deleteBranch(repoAbs, branch) {
  git(repoAbs, ['branch', '-D', branch], { allowFail: true, stdio: 'pipe' });
}

// Commits on the worktree's HEAD not yet in baseBranch.
function aheadCount(worktreeAbs, baseBranch) {
  const out = git(worktreeAbs, ['rev-list', '--count', `${baseBranch}..HEAD`], { allowFail: true });
  return out == null ? null : Number(out);
}

// Uncommitted changes, ignoring the seeded .env files.
function dirtyCount(worktreeAbs) {
  const out = git(worktreeAbs, ['status', '--porcelain'], { allowFail: true });
  if (out == null) return null;
  return out.split('\n').filter((l) => l && !/\.env(\.|$| )/.test(l)).length;
}

module.exports = {
  git, branchExists, currentBranch, fetch, addWorktree, removeWorktree,
  pruneWorktrees, deleteBranch, aheadCount, dirtyCount,
};
