// Per-run outcome log at <root>/.loops/history.json. One record per headless run,
// whatever the outcome, so changes to the driver can be judged by numbers
// (cycles-to-pass, blocked rate by gate) instead of by feel.
const path = require('path');
const { readJSON, writeJSON } = require('./util');

function historyPath(cfg) {
  return path.join(cfg.root, '.loops', 'history.json');
}

function load(cfg) {
  const h = readJSON(historyPath(cfg), { runs: [] });
  if (!Array.isArray(h.runs)) h.runs = [];
  return h;
}

function append(cfg, record) {
  const h = load(cfg);
  h.runs.push(record);
  writeJSON(historyPath(cfg), h);
  return record;
}

module.exports = { historyPath, load, append };
