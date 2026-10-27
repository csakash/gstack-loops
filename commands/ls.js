// gloop ls — list active loops with branch, ports, server + PR status.
const path = require('path');
const { loadConfig, repoByName } = require('../lib/config');
const registry = require('../lib/registry');
const wt = require('../lib/worktree');
const { isAlive, portInUse } = require('../lib/proc');
const { ghAvailable, prForBranch } = require('../lib/gh');
const { c } = require('../lib/util');

module.exports = async function lsCmd() {
  const cfg = loadConfig();
  const reg = registry.load(cfg);
  const slugs = Object.keys(reg.loops);
  if (slugs.length === 0) { console.log('No active loops. Create one: gloop new <slug>'); return; }

  const gh = ghAvailable();
  for (const slug of slugs) {
    const l = reg.loops[slug];
    const why = l.reason && l.status !== 'shipped' ? ` (${l.reason.length > 90 ? `${l.reason.slice(0, 87)}...` : l.reason})` : '';
    console.log(`\n${c.bold('●')} ${slug}   branch=${l.branch}   slot=${l.slot}   status=${l.status || '?'}${why}`);
    for (const name of l.repos) {
      const repo = repoByName(cfg, name);
      const wtAbs = path.join(cfg.root, l.worktrees[name]);
      const ahead = wt.aheadCount(wtAbs, repo ? repo.baseBranch : 'main');
      const dirty = wt.dirtyCount(wtAbs);
      const rec = (l.servers || {})[name];
      let up = false;
      if (rec && rec.pid) up = isAlive(rec.pid);
      if (!up && l.ports[name]) up = await portInUse(l.ports[name]);
      let pr = '';
      if (gh) {
        const p = prForBranch(wtAbs, l.branch);
        if (p) pr = `   PR #${p.number} ${p.merged ? c.green('merged') : p.state.toLowerCase()}`;
      }
      const server = up ? c.green('up') : c.dim('down');
      console.log(`    ${name.padEnd(10)} :${String(l.ports[name]).padEnd(6)} server=${server}  ${ahead ?? '?'} ahead, ${dirty ?? '?'} dirty${pr}`);
    }
  }
  console.log('');
};
