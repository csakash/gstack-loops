// Thin gh CLI helpers for PR state (used by `gloop ls` and `gloop reap`).
const { run } = require('./util');

function ghAvailable() {
  return run('gh', ['--version'], { allowFail: true, stdio: 'pipe' }) !== null;
}

// PR state for a branch, queried from within the repo's worktree (cwd).
// Returns { number, state, url, merged } or null if no PR / gh unavailable.
function prForBranch(repoAbs, branch) {
  const out = run('gh', ['pr', 'view', branch, '--json', 'state,url,mergedAt,number'],
    { allowFail: true, stdio: 'pipe', cwd: repoAbs });
  if (!out) return null;
  try {
    const d = JSON.parse(out);
    return { number: d.number, state: d.state, url: d.url, merged: !!d.mergedAt };
  } catch {
    return null;
  }
}

module.exports = { ghAvailable, prForBranch };
