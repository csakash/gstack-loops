// gloop drop <slug> [--force] [--delete-branch] [--if-merged]
// Tear down a loop's worktrees. Refuses if there's unmerged/uncommitted work
// unless --force. --if-merged only drops when every repo's PR has merged.
const fs = require('fs');
const path = require('path');
const { loadConfig, repoByName } = require('../lib/config');
const registry = require('../lib/registry');
const wt = require('../lib/worktree');
const { stopServer, isAlive } = require('../lib/proc');
const { ghAvailable, prForBranch } = require('../lib/gh');
const outcomes = require('../lib/outcomes');
const { c, die } = require('../lib/util');

module.exports = function dropCmd(slug, opts = {}) {
  if (!slug) die('Usage: gloop drop <slug> [--force] [--delete-branch] [--if-merged]');
  const cfg = loadConfig();
  const loop = registry.getLoop(cfg, slug);
  if (!loop) die(`No loop "${slug}". See gloop ls.`);

  // --if-merged: only proceed when a PR exists AND is merged in every repo.
  if (opts.ifMerged) {
    if (!ghAvailable()) die('--if-merged needs the gh CLI.');
    const prs = {};
    for (const name of loop.repos) {
      const wtAbs = path.join(cfg.root, loop.worktrees[name]);
      const pr = prForBranch(wtAbs, loop.branch);
      if (pr && pr.merged) { prs[name] = pr; continue; }
      // A repo whose branch changes nothing but SPEC.md never gets a PR; it must not hold
      // the loop open forever (found by the e2e run).
      const repo = repoByName(cfg, name);
      if (!pr && wt.hasWork(wtAbs, wt.baseRef(wtAbs, repo ? repo.baseBranch : 'main')) === false) continue;
      console.log(c.dim(`skip "${slug}": ${name} PR not merged yet`));
      return;
    }
    if (Object.keys(prs).length === 0) { console.log(c.dim(`skip "${slug}": no merged PR`)); return; }
    // Record the merge before the worktree goes: it is the only moment all PR details are
    // at hand. Bookkeeping must never stop a reap.
    try {
      const rec = outcomes.recordMerge(cfg, slug, loop, prs);
      console.log(c.dim(`  recorded merge of "${slug}" (${rec.mode}) in .loops/history.json`));
    } catch (e) {
      console.error(c.yellow(`  ! could not record the merge in .loops/history.json: ${e.message}`));
    }
  }

  // Safety gate: block on unmerged/uncommitted work unless forced.
  if (!opts.force && !opts.ifMerged) {
    for (const name of loop.repos) {
      const repo = repoByName(cfg, name);
      const wtAbs = path.join(cfg.root, loop.worktrees[name]);
      if (!fs.existsSync(wtAbs)) continue;
      const ahead = wt.aheadCount(wtAbs, repo ? repo.baseBranch : 'main') || 0;
      const dirty = wt.dirtyCount(wtAbs) || 0;
      if (ahead > 0 || dirty > 0) {
        die(`${name} has ${ahead} unmerged commit(s), ${dirty} uncommitted change(s). Ship/discard first, or use --force.`);
      }
    }
  }

  // Stop any running servers before removing worktrees.
  for (const rec of Object.values(loop.servers || {})) {
    if (rec && rec.pid && isAlive(rec.pid)) stopServer(rec.pid);
  }

  for (const name of loop.repos) {
    const repo = repoByName(cfg, name);
    const wtAbs = path.join(cfg.root, loop.worktrees[name]);
    try {
      // --force here only overrides git's refusal over the seeded .env; the
      // unmerged-work gate above already ran.
      wt.removeWorktree(repo.abs, wtAbs, true);
      console.log(`  ${c.yellow('-')} removed worktree ${loop.worktrees[name]}`);
    } catch (e) {
      wt.pruneWorktrees(repo.abs);
      console.error(c.red(`  ! ${name}: ${String(e.message).split('\n')[0]}`));
    }
    if (opts.deleteBranch) { wt.deleteBranch(repo.abs, loop.branch); console.log(`  ${c.yellow('-')} deleted branch ${loop.branch} in ${name}`); }
  }

  try { fs.rmSync(path.join(cfg.root, cfg.worktreeDir, slug), { recursive: true, force: true }); } catch {}
  registry.removeLoop(cfg, slug);
  console.log(`${c.green('✓')} dropped loop "${slug}".`);
};
