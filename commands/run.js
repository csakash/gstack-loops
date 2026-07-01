// gloop run <slug> --mode <interactive|bypass|autonomous> [--dry-run] [--no-servers] [--fix-cycles N]
const path = require('path');
const { loadConfig, repoByName } = require('../lib/config');
const registry = require('../lib/registry');
const { portsForSlot } = require('../lib/ports');
const { resolveEnvMap } = require('../lib/env-template');
const { startServer, stopServer, isAlive } = require('../lib/proc');
const { MODES, hasSpec, claudeArgs, spawnHeadless, featureDir } = require('../lib/driver');
const { c, die } = require('../lib/util');

function startServers(cfg, loop) {
  const ports = portsForSlot(cfg, loop.slot);
  const servers = {};
  for (const name of loop.repos) {
    const repo = repoByName(cfg, name);
    if (!repo || !Array.isArray(repo.dev) || repo.dev.length === 0) continue;
    const args = repo.dev.slice(1);
    if (repo.serve && repo.serve.portFlag) args.push('--', repo.serve.portFlag, String(ports[name]), '--strictPort');
    const env = resolveEnvMap(repo.env, { selfPort: ports[name], portsByRepo: ports });
    const logFile = path.join(cfg.root, '.loops', 'logs', `${featureSlug(loop)}-${name}.log`);
    const s = startServer({ cwd: path.join(cfg.root, loop.worktrees[name]), command: repo.dev[0], args, env, port: ports[name], logFile });
    servers[name] = s;
    console.log(`  ${c.green('▸')} ${name} server → :${s.port} (pid ${s.pid}, log ${path.relative(cfg.root, logFile)})`);
  }
  return servers;
}

function featureSlug(loop) {
  const any = Object.values(loop.worktrees)[0];
  return any ? path.basename(path.dirname(any)) : 'loop';
}

function stopServers(loop) {
  for (const rec of Object.values(loop.servers || {})) {
    if (rec && rec.pid && isAlive(rec.pid)) stopServer(rec.pid);
  }
}

module.exports = async function runCmd(slug, opts = {}) {
  const mode = opts.mode || 'interactive';
  if (!MODES[mode]) die(`Unknown mode "${mode}". Use: interactive | bypass | autonomous`);
  const cfg = loadConfig();
  const loop = registry.getLoop(cfg, slug);
  if (!loop) die(`No loop "${slug}". Create it: gloop new ${slug}`);

  const dir = featureDir(cfg, loop);

  // Interactive: hand off to a live session (permission prompts stay on).
  if (!MODES[mode].headless) {
    console.log(`\n${c.bold('Interactive loop')} "${slug}" — drive it yourself:\n`);
    console.log(`  cd ${path.relative(process.cwd(), dir) || '.'} && claude`);
    console.log(`  then run:  ${c.cyan('/loop-run')}   (build → /review → /qa → /ship, gated at each step)\n`);
    return;
  }

  // Headless (bypass/autonomous) require an approved spec.
  if (!hasSpec(cfg, loop)) {
    die(`bypass/autonomous need SPEC.md on ${loop.branch}. Run /spec (or write SPEC.md) in the worktree first.`);
  }

  const { bin, args } = claudeArgs(cfg, loop, mode, { fixCycles: opts.fixCycles });

  if (opts.dryRun) {
    console.log(`\n${c.bold('[dry-run]')} mode=${mode}  perm=${MODES[mode].permissionMode}  autoPush=${MODES[mode].autoPush}`);
    console.log(`cwd: ${dir}`);
    if (!opts.noServers) console.log(c.dim('would start dev servers for: ' + loop.repos.join(', ')));
    console.log(`\n${c.dim('command:')} ${bin} ${args.map((a) => (a.includes('\n') ? '"<prompt>"' : a)).join(' ')}`);
    console.log(`\n${c.dim('--- prompt ---')}\n${args[1]}\n${c.dim('--------------')}`);
    return;
  }

  let servers = {};
  if (!opts.noServers) {
    console.log(`\n${c.bold('starting servers')} for "${slug}"...`);
    servers = startServers(cfg, loop);
    registry.updateLoop(cfg, slug, (e) => { e.servers = servers; e.status = 'running'; return e; });
  }

  console.log(`\n${c.bold('launching')} ${mode} loop (permission-mode=${MODES[mode].permissionMode})...\n`);
  const code = await spawnHeadless(cfg, loop, mode, { fixCycles: opts.fixCycles });

  // Cleanup on ship: stop the loop's servers once the session returns.
  const fresh = registry.getLoop(cfg, slug) || loop;
  stopServers(fresh);
  registry.updateLoop(cfg, slug, (e) => { e.servers = {}; e.status = code === 0 ? 'shipped' : 'blocked'; return e; });

  if (code === 0) {
    console.log(`\n${c.green('✓')} loop "${slug}" finished. Servers stopped. Worktree kept until PR merges (gloop reap).`);
  } else {
    console.log(`\n${c.red('✗')} loop "${slug}" exited ${code}. Servers stopped; worktree kept for inspection.`);
  }
};
