// gloop init — scaffold loops.json by detecting git repos in the workspace.
const fs = require('fs');
const path = require('path');
const { CONFIG_NAME } = require('../lib/config');
const { run, c, die } = require('../lib/util');

function isGitRepo(dir) {
  return run('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { allowFail: true, stdio: 'pipe' }) === 'true'
    && run('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { allowFail: true, stdio: 'pipe' }) === path.resolve(dir);
}

function detectRepos(root) {
  // Single-repo workspace: cwd itself is a repo root.
  if (isGitRepo(root)) return [{ name: path.basename(root), path: '.' }];
  // Multi-repo: immediate subdirectories that are their own repo roots.
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
    .filter((d) => isGitRepo(path.join(root, d.name)))
    .map((d) => ({ name: d.name, path: d.name }));
}

module.exports = function initCmd() {
  const root = process.cwd();
  const target = path.join(root, CONFIG_NAME);
  if (fs.existsSync(target)) die(`${CONFIG_NAME} already exists here. Edit it directly.`);

  const found = detectRepos(root);
  if (found.length === 0) die('No git repos found here. Run this in a workspace containing one or more git repos.');

  const repos = found.map((r, i) => ({
    name: r.name,
    path: r.path,
    baseBranch: 'main',
    basePort: 4000 + i * 1000,
    dev: r.path === '.' ? ['npm', 'run', 'dev'] : ['npm', 'run', 'dev', '--prefix', r.path],
    env: {},
  }));

  const cfg = { worktreeDir: 'worktrees', branchPrefix: 'feat/', portStride: 100, repos, hooks: { preLoop: null, postShip: null } };
  fs.writeFileSync(target, JSON.stringify(cfg, null, 2) + '\n');

  console.log(`${c.green('✓')} wrote ${CONFIG_NAME} with ${repos.length} repo(s): ${repos.map((r) => r.name).join(', ')}`);
  console.log(c.dim('  Next: set each repo\'s dev command + env wiring (e.g. {{url:backend}}), then: gloop new <slug>'));
};
