// gloop new <slug> [--repos a,b] — create paired worktrees + wired ports/env.
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../lib/config');
const registry = require('../lib/registry');
const { nextSlot, portsForSlot } = require('../lib/ports');
const wt = require('../lib/worktree');
const { resolveEnvMap, applyEnv } = require('../lib/env-template');
const { c, die, slugOk } = require('../lib/util');

// launch.json runs from the feature folder (where a session for this loop is opened), the
// same place `gloop run` starts servers. A single-repo workspace's repo sits one level down,
// so npm gets a --prefix to reach it.
function writeLaunchJson(featureDir, selected, ports) {
  // `dev` is optional (a library repo has no server); such repos get no launch entry.
  const configurations = selected.filter((r) => Array.isArray(r.dev) && r.dev.length > 0).map((r) => {
    const runtimeArgs = r.dev.slice(1);
    if (r.path === '.' && r.dev[0] === 'npm' && !runtimeArgs.includes('--prefix')) runtimeArgs.push('--prefix', r.name);
    if (r.serve && r.serve.portFlag) runtimeArgs.push('--', r.serve.portFlag, String(ports[r.name]), '--strictPort');
    return { name: r.name, runtimeExecutable: r.dev[0], runtimeArgs, port: ports[r.name] };
  });
  const file = path.join(featureDir, '.claude', 'launch.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: '0.0.1', configurations }, null, 2) + '\n');
}

module.exports = function newCmd(slug, opts = {}) {
  if (!slugOk(slug)) die('Usage: gloop new <slug> [--repos a,b]  (slug must be kebab-case)');
  const cfg = loadConfig();
  const reg = registry.load(cfg);

  const selected = opts.repos
    ? cfg.repos.filter((r) => opts.repos.includes(r.name))
    : cfg.repos;
  if (selected.length === 0) die(`No repos matched --repos ${opts.repos}. Known: ${cfg.repos.map((r) => r.name).join(', ')}`);

  const entry = reg.loops[slug] || {
    slot: nextSlot(reg), branch: cfg.branchPrefix + slug,
    repos: selected.map((r) => r.name), worktrees: {}, ports: {}, servers: {}, prs: {}, status: 'created',
  };
  const ports = portsForSlot(cfg, entry.slot); // all repos, so cross-refs resolve

  console.log(`\n${c.bold('▶ loop')} "${slug}"  branch=${entry.branch}  slot=${entry.slot}\n`);

  for (const r of selected) {
    const wtAbs = path.join(cfg.root, cfg.worktreeDir, slug, r.name);
    if (fs.existsSync(wtAbs)) {
      console.log(`  ${c.dim('=')} ${r.name}: worktree exists`);
    } else {
      console.log(`  ${c.green('+')} ${r.name}: creating worktree on ${entry.branch}`);
      fs.mkdirSync(path.dirname(wtAbs), { recursive: true });
      wt.addWorktree(r.abs, wtAbs, entry.branch, r.baseBranch);
    }
    entry.worktrees[r.name] = path.relative(cfg.root, wtAbs);
    entry.ports[r.name] = ports[r.name];

    // Seed .env from the root checkout (secrets), then wire ports from templates.
    const rootEnv = path.join(r.abs, '.env');
    const wtEnv = path.join(wtAbs, '.env');
    if (fs.existsSync(rootEnv) && !fs.existsSync(wtEnv)) fs.copyFileSync(rootEnv, wtEnv);
    const resolved = resolveEnvMap(r.env, { selfPort: ports[r.name], portsByRepo: ports });
    if (Object.keys(resolved).length) {
      const cur = fs.existsSync(wtEnv) ? fs.readFileSync(wtEnv, 'utf8') : '';
      fs.writeFileSync(wtEnv, applyEnv(cur, resolved));
    }
  }

  writeLaunchJson(path.join(cfg.root, cfg.worktreeDir, slug), selected, ports);
  reg.loops[slug] = entry;
  registry.save(cfg, reg);

  console.log('\n  ports:');
  selected.forEach((r) => console.log(`    ${r.name.padEnd(10)} :${ports[r.name]}`));
  const rel = path.relative(process.cwd(), path.join(cfg.root, cfg.worktreeDir, slug)) || '.';
  console.log(`\n${c.green('✓')} ready. Next:`);
  console.log(`    write SPEC.md, then:  ${c.cyan(`gloop run ${slug} --mode interactive`)}`);
  console.log(`    or open a session:    cd ${rel} && claude\n`);
};
