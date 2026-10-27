// Load and normalize loops.json for the current workspace.
const fs = require('fs');
const path = require('path');
const { readJSON, die } = require('./util');
const { DEFAULT_SENSITIVE } = require('./risk');

const CONFIG_NAME = 'loops.json';
const DEFAULTS = { worktreeDir: 'worktrees', branchPrefix: 'feat/', portStride: 100 };

// Walk up from startDir until we find loops.json. Returns its directory (the workspace root).
function findWorkspaceRoot(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_NAME))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function configPath(root) {
  return path.join(root, CONFIG_NAME);
}

// Load + validate config. Returns { root, worktreeDir, branchPrefix, portStride, repos:[{...,abs}] }.
function loadConfig(startDir = process.cwd()) {
  const root = findWorkspaceRoot(startDir);
  if (!root) {
    die(`No ${CONFIG_NAME} found here or in any parent. Run "gloop init" in your workspace first.`);
  }
  const raw = readJSON(configPath(root), {});
  const cfg = { ...DEFAULTS, ...raw, root };
  if (!Array.isArray(cfg.repos) || cfg.repos.length === 0) {
    die(`${CONFIG_NAME} has no "repos". Add at least one repo (see "gloop init").`);
  }
  const seen = new Set();
  cfg.repos.forEach((r) => {
    if (!r.name) die('Every repo in loops.json needs a "name".');
    if (seen.has(r.name)) die(`Duplicate repo name "${r.name}" in loops.json.`);
    seen.add(r.name);
    r.path = r.path || r.name;
    r.baseBranch = r.baseBranch || 'main';
    r.abs = path.resolve(root, r.path);
    r.env = r.env || {};
  });
  cfg.hooks = cfg.hooks || { preLoop: null, postShip: null };
  // Review defaults apply when loops.json predates them, so existing workspaces get the
  // security stage and sensitive-path tiers without editing config.
  const rv = raw.review && typeof raw.review === 'object' ? raw.review : {};
  if (rv.sensitivePaths !== undefined && (!Array.isArray(rv.sensitivePaths) || rv.sensitivePaths.some((x) => typeof x !== 'string'))) {
    die(`${CONFIG_NAME}: "review.sensitivePaths" must be a list of glob strings (or [] to opt out).`);
  }
  cfg.review = {
    ...rv,
    security: rv.security !== false,
    sensitivePaths: rv.sensitivePaths !== undefined ? rv.sensitivePaths : DEFAULT_SENSITIVE,
  };
  return cfg;
}

function repoByName(cfg, name) {
  return cfg.repos.find((r) => r.name === name);
}

module.exports = { CONFIG_NAME, DEFAULTS, findWorkspaceRoot, configPath, loadConfig, repoByName };
