// The loop registry: source of truth for active loops. Lives at
// <root>/.loops/registry.json. Tracks slot, branch, ports, servers, PRs, status.
const path = require('path');
const { readJSON, writeJSON } = require('./util');

function registryPath(cfg) {
  return path.join(cfg.root, '.loops', 'registry.json');
}

function load(cfg) {
  return readJSON(registryPath(cfg), { loops: {} });
}

function save(cfg, reg) {
  writeJSON(registryPath(cfg), reg);
}

function getLoop(cfg, slug) {
  return load(cfg).loops[slug] || null;
}

// Read-modify-write a single loop entry. `fn(entry)` mutates/returns the entry.
function updateLoop(cfg, slug, fn) {
  const reg = load(cfg);
  const entry = reg.loops[slug] || {};
  const next = fn(entry) || entry;
  reg.loops[slug] = next;
  save(cfg, reg);
  return next;
}

function removeLoop(cfg, slug) {
  const reg = load(cfg);
  delete reg.loops[slug];
  save(cfg, reg);
}

module.exports = { registryPath, load, save, getLoop, updateLoop, removeLoop };
