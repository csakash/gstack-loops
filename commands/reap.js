// gloop reap — drop every loop whose PR has merged in all its repos.
const { loadConfig } = require('../lib/config');
const registry = require('../lib/registry');
const { ghAvailable } = require('../lib/gh');
const { c, die } = require('../lib/util');
const dropCmd = require('./drop');
const outcomes = require('../lib/outcomes');

module.exports = function reapCmd() {
  const cfg = loadConfig();
  if (!ghAvailable()) die('gloop reap needs the gh CLI to check PR merge state.');
  const reg = registry.load(cfg);
  const slugs = Object.keys(reg.loops);
  if (slugs.length === 0) console.log('No active loops.');

  let reaped = 0;
  for (const slug of slugs) {
    console.log(c.dim(`checking "${slug}"...`));
    const before = registry.getLoop(cfg, slug);
    dropCmd(slug, { ifMerged: true, deleteBranch: true });
    if (!registry.getLoop(cfg, slug) && before) reaped += 1;
  }
  if (slugs.length) console.log(reaped ? `${c.green('✓')} reaped ${reaped} merged loop(s).` : 'Nothing to reap — no merged loops.');

  // Reverts land days after a merge, so every reap re-checks recent merges.
  reportReverts(outcomes.refreshReverts(cfg));
};

function reportReverts(flipped) {
  for (const rec of flipped) {
    const prs = Object.values(rec.merged || {}).map((m) => m.url).join(', ');
    console.log(`${c.red('!')} "${rec.slug}" was reverted after merging (${prs}). Ask which layer should have caught it.`);
  }
}

module.exports.reportReverts = reportReverts;
