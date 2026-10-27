// Thin gh CLI helpers for PR state (used by `gloop ls`, `gloop reap`, revert checks).
// Every helper returns null when gh is missing or cannot answer; nothing throws.
const { run } = require('./util');

function ghAvailable() {
  return run('gh', ['--version'], { allowFail: true, stdio: 'pipe' }) !== null;
}

// PR state for a branch, queried from within the repo's worktree (cwd).
// Returns { number, state, url, title, merged, mergedAt, mergeCommit } or null.
function prForBranch(repoAbs, branch) {
  const out = run('gh', ['pr', 'view', branch, '--json', 'state,url,mergedAt,number,title,mergeCommit'],
    { allowFail: true, stdio: 'pipe', cwd: repoAbs });
  if (!out) return null;
  try {
    const d = JSON.parse(out);
    return {
      number: d.number, state: d.state, url: d.url, title: d.title || '',
      merged: !!d.mergedAt, mergedAt: d.mergedAt || null,
      mergeCommit: (d.mergeCommit && d.mergeCommit.oid) || null,
    };
  } catch {
    return null;
  }
}

// Was PR `pr` ({ number, title }) reverted by a merged GitHub revert PR? GitHub's revert
// button writes "Reverts owner/repo#N" in the body and `Revert "<title>"` as the title.
// true / false, or null when gh could not answer.
function revertPrExists(repoAbs, pr) {
  const out = run('gh', ['pr', 'list', '--state', 'merged', '--search', 'Revert in:title',
    '--json', 'number,title,body', '--limit', '100'], { allowFail: true, stdio: 'pipe', cwd: repoAbs });
  if (out == null) return null;
  let list;
  try { list = JSON.parse(out); } catch { return null; }
  if (!Array.isArray(list)) return null;
  const byBody = new RegExp(`Reverts\\s+\\S*#${pr.number}\\b`);
  const byTitle = pr.title ? `Revert "${pr.title}"` : null;
  return list.some((x) => x.number !== pr.number
    && (byBody.test(x.body || '') || (byTitle && String(x.title || '').startsWith(byTitle))));
}

module.exports = { ghAvailable, prForBranch, revertPrExists };
