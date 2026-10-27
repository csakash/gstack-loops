// What happened after the PR: merges and reverts, written into history.json. Best-effort
// throughout — when gh or git cannot answer, the value is null and nothing throws.
const fs = require('fs');
const { run } = require('./util');
const { repoByName } = require('./config');
const gh = require('./gh');
const history = require('./history');

const RECHECK_DAYS = 30;

// A commit on the base branch saying "This reverts commit <sha>" (git revert's message).
// true / false, or null when the repo or sha is not available.
function revertCommitOnBase(repoAbs, base, sha) {
  if (!sha || !repoAbs || !fs.existsSync(repoAbs)) return null;
  run('git', ['-C', repoAbs, 'fetch', 'origin', base, '--quiet'], { allowFail: true, stdio: 'pipe' });
  const remote = run('git', ['-C', repoAbs, 'rev-parse', '--verify', '--quiet', `origin/${base}`], { allowFail: true, stdio: 'pipe' });
  const ref = remote ? `origin/${base}` : base;
  const out = run('git', ['-C', repoAbs, 'log', ref, '--format=%H', `--grep=This reverts commit ${sha}`, '-n', '1'], { allowFail: true, stdio: 'pipe' });
  return out == null ? null : out.length > 0;
}

// Combine per-repo answers: any true wins; else any false; else unknown.
function anyOf(answers) {
  if (answers.includes(true)) return true;
  if (answers.includes(false)) return false;
  return null;
}

function checkReverted(cfg, rec) {
  const hasGh = gh.ghAvailable();
  const perRepo = Object.entries(rec.merged || {}).map(([name, pr]) => {
    const repo = repoByName(cfg, name);
    const abs = repo && repo.abs;
    return anyOf([
      hasGh && abs ? gh.revertPrExists(abs, pr) : null,
      revertCommitOnBase(abs, (repo && repo.baseBranch) || 'main', pr.mergeCommit),
    ]);
  });
  return anyOf(perRepo);
}

// A loop's PRs merged. Attach the merge to its latest successful headless run, or record the
// loop as interactive (the owner's /gloop-spec → /gloop-build → /gloop-ship path).
function recordMerge(cfg, slug, loop, prsByRepo) {
  const merged = {};
  for (const [name, pr] of Object.entries(prsByRepo)) {
    merged[name] = { number: pr.number, url: pr.url, title: pr.title || '', mergeCommit: pr.mergeCommit || null, mergedAt: pr.mergedAt || null };
  }
  const mergedAt = Object.values(merged).map((m) => m.mergedAt).filter(Boolean).sort().pop() || new Date().toISOString();
  const urls = Object.fromEntries(Object.entries(merged).map(([n, m]) => [n, m.url]));
  return history.update(cfg, (h) => {
    const latest = [...h.runs].reverse().find((r) => r.slug === slug && !r.mergedAt);
    let rec;
    if (latest && (latest.outcome === 'shipped' || latest.outcome === 'needs-human')) {
      rec = latest;
      if (!rec.prs || Object.keys(rec.prs).length === 0) rec.prs = urls;
    } else {
      rec = {
        slug, mode: 'interactive', repos: loop.repos, runDir: null,
        startedAt: null, finishedAt: mergedAt, outcome: 'shipped', blockedGate: null,
        reason: latest ? `finished outside the driver after a ${latest.outcome} ${latest.mode} run` : null,
        cycles: null, converged: null, findings: null, securityFindings: null, sensitive: null,
        prs: urls, mergedAt: null, reverted: null,
      };
      h.runs.push(rec);
    }
    rec.mergedAt = mergedAt;
    rec.merged = merged;
    rec.reverted = checkReverted(cfg, rec);
    rec.revertCheckedAt = new Date().toISOString();
    return rec;
  });
}

// Re-check merged records from the last `days` days that are not known to be reverted.
// Returns the records that flipped to reverted on this pass.
function refreshReverts(cfg, { days = RECHECK_DAYS, now = Date.now() } = {}) {
  return history.update(cfg, (h) => {
    const flipped = [];
    for (const rec of h.runs) {
      if (!rec.mergedAt || !rec.merged || rec.reverted === true) continue;
      if (now - Date.parse(rec.mergedAt) > days * 24 * 3600 * 1000) continue;
      const v = checkReverted(cfg, rec);
      if (v !== null) rec.reverted = v;
      rec.revertCheckedAt = new Date(now).toISOString();
      if (v === true) flipped.push(rec);
    }
    return flipped;
  });
}

module.exports = { RECHECK_DAYS, revertCommitOnBase, checkReverted, recordMerge, refreshReverts };
