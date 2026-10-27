// Per-run outcome log at <root>/.loops/history.json. One record per headless run, plus one
// per loop merged by hand, so changes to the driver can be judged by numbers (cycles-to-pass,
// blocked rate by gate, revert rate) instead of by feel. Storage and pure aggregation only;
// gh/git lookups live in lib/outcomes.js.
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

// Read-modify-write the whole log. fn(h) mutates h.runs in place.
function update(cfg, fn) {
  const h = load(cfg);
  const result = fn(h);
  writeJSON(historyPath(cfg), h);
  return result;
}

function median(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Nearest-rank p95: with few runs it is simply the worst one, which is the honest answer.
function p95(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.ceil(0.95 * s.length) - 1];
}

// Did this run's reviewer of `kind` converge? Records since P2 say so; older ones are
// inferred from the outcome.
function converged(run, kind) {
  if (!run.cycles || !run.cycles[kind]) return false;
  if (run.converged && run.converged[kind] !== undefined) return run.converged[kind] === true;
  return run.outcome !== 'blocked';
}

const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);

function computeStats(runs) {
  const outcomes = { shipped: 0, 'needs-human': 0, blocked: 0 };
  const byMode = {};
  const blockedByGate = {};
  for (const r of runs) {
    if (outcomes[r.outcome] !== undefined) outcomes[r.outcome] += 1;
    byMode[r.mode] = (byMode[r.mode] || 0) + 1;
    if (r.outcome === 'blocked') blockedByGate[r.blockedGate || '?'] = (blockedByGate[r.blockedGate || '?'] || 0) + 1;
  }
  const cyclesToPass = (kind) => {
    const xs = runs.filter((r) => converged(r, kind)).map((r) => r.cycles[kind]);
    return { runs: xs.length, median: median(xs), p95: p95(xs) };
  };
  const merged = runs.filter((r) => r.mergedAt);
  const reverted = merged.filter((r) => r.reverted === true).length;
  const unknown = merged.filter((r) => r.reverted !== true && r.reverted !== false).length;
  const known = merged.length - unknown;
  return {
    total: runs.length,
    byMode,
    outcomes,
    outcomePct: Object.fromEntries(Object.entries(outcomes).map(([k, v]) => [k, pct(v, runs.length)])),
    blockedByGate,
    review: cyclesToPass('review'),
    security: cyclesToPass('security'),
    merged: merged.length,
    reverted,
    revertUnknown: unknown,
    revertRatePct: known ? pct(reverted, known) : null,
  };
}

module.exports = { historyPath, load, append, update, median, p95, converged, computeStats };
