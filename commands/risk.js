// gloop risk [slug] — list the files a loop touches that match review.sensitivePaths.
// One definition of "sensitive", shared by the headless risk stage and the /gloop-build
// and /gloop-ship skills. Inside a loop's worktree the slug is optional. Needs only git.
const path = require('path');
const fs = require('fs');
const { loadConfig, repoByName } = require('../lib/config');
const registry = require('../lib/registry');
const risk = require('../lib/risk');
const { run, c, die } = require('../lib/util');

// The loop whose feature folder contains `dir`, if any.
function loopForDir(cfg, reg, dir) {
  const here = fs.realpathSync(dir);
  return Object.keys(reg.loops).find((slug) => {
    const feature = path.join(cfg.root, cfg.worktreeDir, slug);
    if (!fs.existsSync(feature)) return false;
    const f = fs.realpathSync(feature);
    return here === f || here.startsWith(f + path.sep);
  }) || null;
}

function baseRef(abs, base) {
  return run('git', ['-C', abs, 'rev-parse', '--verify', '--quiet', `origin/${base}`], { allowFail: true, stdio: 'pipe' }) ? `origin/${base}` : base;
}

// Returns [{ repo, file }] so tests and callers can use it without parsing output.
module.exports = function riskCmd(slugArg, opts = {}) {
  const log = opts.quiet ? () => {} : console.log;
  const cfg = loadConfig();
  const reg = registry.load(cfg);
  const slug = slugArg || loopForDir(cfg, reg, process.cwd());
  if (!slug) die('Usage: gloop risk <slug>   (or run it inside a loop worktree)');
  const loop = reg.loops[slug];
  if (!loop) die(`No loop "${slug}". See gloop ls.`);

  const patterns = cfg.review.sensitivePaths;
  if (patterns.length === 0) { log(c.dim(`review.sensitivePaths is empty in loops.json — nothing is treated as sensitive.`)); return []; }

  const repos = loop.repos.filter((n) => loop.worktrees[n]).map((name) => {
    const r = repoByName(cfg, name);
    const abs = path.join(cfg.root, loop.worktrees[name]);
    return { name, abs, baseRef: baseRef(abs, (r && r.baseBranch) || 'main') };
  });
  const hits = risk.touchedSensitive(repos, patterns);
  if (hits.length === 0) {
    log(`${c.green('✓')} "${slug}" touches no sensitive paths.`);
  } else {
    log(`${c.yellow('!')} "${slug}" touches ${hits.length} sensitive path(s) — these need a human reviewer:`);
    hits.forEach((h) => log(`    ${h.repo}: ${h.file}`));
  }
  return hits;
};

module.exports.loopForDir = loopForDir;
