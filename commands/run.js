// gloop run <slug> --mode <interactive|bypass|autonomous>
//   [--dry-run] [--no-servers] [--fix-cycles N] [--legacy-driver]
// Returns the outcome (shipped | needs-human | blocked | dry-run | handed-off) so the
// CLI entry can set the exit code; never calls process.exit itself after validation.
const path = require('path');
const { loadConfig, repoByName, devCwd } = require('../lib/config');
const registry = require('../lib/registry');
const { portsForSlot } = require('../lib/ports');
const { resolveEnvMap } = require('../lib/env-template');
const { startServer, stopServer, isAlive } = require('../lib/proc');
const driver = require('../lib/driver');
const { runPipeline, describeStages, resolveFixCycles } = require('../lib/pipeline');
const { c, die } = require('../lib/util');

function startServers(cfg, loop, log) {
  const ports = portsForSlot(cfg, loop.slot);
  const servers = {};
  for (const name of loop.repos) {
    const repo = repoByName(cfg, name);
    if (!repo || !Array.isArray(repo.dev) || repo.dev.length === 0) continue;
    const args = repo.dev.slice(1);
    if (repo.serve && repo.serve.portFlag) args.push('--', repo.serve.portFlag, String(ports[name]), '--strictPort');
    const env = resolveEnvMap(repo.env, { selfPort: ports[name], portsByRepo: ports });
    const logFile = path.join(cfg.root, '.loops', 'logs', `${driver.loopSlug(loop) || 'loop'}-${name}.log`);
    const cwd = devCwd(repo, driver.featureDir(cfg, loop), path.join(cfg.root, loop.worktrees[name]));
    const s = startServer({ cwd, command: repo.dev[0], args, env, port: ports[name], logFile });
    servers[name] = s;
    log(`  ${c.green('▸')} ${name} server → :${s.port} (pid ${s.pid}, log ${path.relative(cfg.root, logFile)})`);
  }
  return servers;
}

function stopServers(loop) {
  for (const rec of Object.values(loop.servers || {})) {
    if (rec && rec.pid && isAlive(rec.pid)) stopServer(rec.pid);
  }
}

// Show the prompt in place of its argv slot so the command line stays readable.
function printArgv(log, argv) {
  log(`${c.dim('command:')} ${argv.map((a) => (a.includes('\n') ? '"<prompt>"' : a)).join(' ')}`);
}

function printDryRun(log, cfg, loop, mode, opts) {
  const plan = describeStages(cfg, loop, mode, { fixCycles: opts.fixCycles });
  log(`\n${c.bold('[dry-run]')} mode=${mode}  author perm=${driver.MODES[mode].permissionMode}  reviewer=read-only  autoPush=${driver.MODES[mode].autoPush}  fix budget=${plan.fixCycles}`);
  log(`run dir (not created): ${path.relative(cfg.root, plan.runDir)}`);
  if (!opts.noServers) log(c.dim(`would start dev servers for: ${loop.repos.join(', ')}`));
  plan.stages.forEach((s, i) => {
    log(`\n${c.bold(`── ${i + 1}. ${s.name}`)}  (${s.who})${s.note ? `  ${c.dim(s.note)}` : ''}`);
    if (s.argv) {
      printArgv(log, s.argv);
      log(`${c.dim('--- prompt ---')}\n${s.prompt}\n${c.dim('--------------')}`);
    }
  });
}

module.exports = async function runCmd(slug, opts = {}) {
  const mode = opts.mode || 'interactive';
  if (!driver.MODES[mode]) die(`Unknown mode "${mode}". Use: interactive | bypass | autonomous`);
  const cfg = loadConfig();
  const loop = registry.getLoop(cfg, slug);
  if (!loop) die(`No loop "${slug}". Create it: gloop new ${slug}`);
  const log = opts.quiet ? () => {} : console.log;
  const dir = driver.featureDir(cfg, loop);

  // Interactive: hand off to a live session (permission prompts stay on).
  if (!driver.MODES[mode].headless) {
    log(`\n${c.bold('Interactive loop')} "${slug}" — drive it yourself:\n`);
    log(`  cd ${path.relative(process.cwd(), dir) || '.'} && claude`);
    log(`  then run:  ${c.cyan('/gloop-build')}   (build → fresh-context /review → /qa, with proof), then ${c.cyan('/gloop-ship')}\n`);
    return 'handed-off';
  }

  // Headless (bypass/autonomous) require an approved spec.
  if (!driver.hasSpec(cfg, loop)) {
    die(`bypass/autonomous need SPEC.md on ${loop.branch}. Run /gloop-spec (or write SPEC.md) in the worktree first.`);
  }

  if (opts.legacyDriver) {
    const { bin, args } = driver.legacyArgs(cfg, loop, mode, { fixCycles: resolveFixCycles(cfg, opts) });
    if (opts.dryRun) {
      log(`\n${c.bold('[dry-run, legacy driver]')} mode=${mode}  perm=${driver.MODES[mode].permissionMode}`);
      printArgv(log, [bin, ...args]);
      log(`\n${c.dim('--- prompt ---')}\n${args[1]}\n${c.dim('--------------')}`);
      return 'dry-run';
    }
  } else if (opts.dryRun) {
    printDryRun(log, cfg, loop, mode, opts);
    return 'dry-run';
  }

  let servers = {};
  if (!opts.noServers) {
    log(`\n${c.bold('starting servers')} for "${slug}"...`);
    servers = startServers(cfg, loop, log);
    registry.updateLoop(cfg, slug, (e) => { e.servers = servers; e.status = 'running'; return e; });
  }

  let result;
  if (opts.legacyDriver) {
    log(`\n${c.bold('launching')} ${mode} loop with the legacy single-process driver...\n`);
    const code = await driver.spawnLegacy(cfg, loop, mode, { fixCycles: resolveFixCycles(cfg, opts) });
    result = code === 0 ? { outcome: 'shipped' } : { outcome: 'blocked', gate: 'legacy', reason: `session exited ${code}` };
  } else {
    log(`\n${c.bold('launching')} ${mode} loop: stage runner, author perm=${driver.MODES[mode].permissionMode}, reviewer read-only`);
    result = await runPipeline(cfg, loop, mode, { fixCycles: opts.fixCycles, log, echo: !opts.quiet });
  }

  // Servers stop whatever the outcome; the worktree stays for the PR or for inspection.
  const fresh = registry.getLoop(cfg, slug) || loop;
  stopServers(fresh);
  registry.updateLoop(cfg, slug, (e) => {
    e.servers = {};
    e.status = result.outcome;
    e.reason = result.reason || null;
    e.lastRun = result.runDir ? path.relative(cfg.root, result.runDir) : null;
    return e;
  });

  const where = result.runDir ? `  Evidence: ${path.relative(process.cwd(), result.runDir)}` : '';
  if (result.outcome === 'shipped') {
    log(`\n${c.green('✓')} loop "${slug}" shipped. ${Object.entries(result.prs || {}).map(([r, u]) => `${r}: ${u}`).join('  ')}`);
    log(`  Servers stopped. Worktree kept until the PR merges (gloop reap).${where}`);
  } else if (result.outcome === 'needs-human') {
    log(`\n${c.yellow('!')} loop "${slug}" is green and waiting for you: ${result.reason}.${where}`);
    if (result.commands && result.commands.length) {
      log('  From the workspace root, when you are happy with the branch:');
      result.commands.forEach((cmd) => log(`    ${cmd}`));
    }
  } else {
    log(`\n${c.red('✗')} loop "${slug}" BLOCKED at ${result.gate}: ${result.reason}`);
    log(`  Nothing was pushed. Servers stopped; worktree kept for inspection.${where}`);
  }
  return result.outcome;
};

module.exports.startServers = startServers;
module.exports.stopServers = stopServers;
