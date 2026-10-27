// gloop stats [--json] [--refresh] — how loops are doing, from .loops/history.json alone:
// outcomes, where runs block, review cycles-to-pass, merges and revert rate. --refresh first
// re-checks recent merges for reverts (needs git, uses gh when present).
const { loadConfig } = require('../lib/config');
const history = require('../lib/history');
const outcomes = require('../lib/outcomes');
const { c } = require('../lib/util');

const dash = (v) => (v === null || v === undefined ? '-' : String(v));
const day = (iso) => (iso ? iso.slice(0, 10) : '-');

function outcomeCell(r) {
  if (r.outcome === 'blocked') return `blocked@${r.blockedGate || '?'}`;
  return r.outcome || '?';
}

function revertCell(r) {
  if (!r.mergedAt) return '-';
  if (r.reverted === true) return c.red('yes');
  if (r.reverted === false) return 'no';
  return '?';
}

function findingsCell(r) {
  const f = r.findings;
  if (!f) return '-';
  return `${f.fixed + f.wontfix}/${f.important}`;
}

function table(runs, log) {
  const rows = runs.slice(-20).reverse().map((r) => [
    r.slug, day(r.startedAt || r.finishedAt), r.mode, outcomeCell(r),
    dash(r.cycles && r.cycles.review), dash(r.cycles && r.cycles.security), findingsCell(r),
    day(r.mergedAt), revertCell(r),
  ]);
  const head = ['LOOP', 'DATE', 'MODE', 'OUTCOME', 'REVIEW', 'SECURITY', 'RESOLVED', 'MERGED', 'REVERTED'];
  // Width from the plain text: colour codes would otherwise widen the columns.
  const plain = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((row) => plain(row[i]).length)));
  const fmt = (row) => row.map((cell, i) => String(cell) + ' '.repeat(w[i] - plain(cell).length)).join('  ').trimEnd();
  log(c.dim(fmt(head)));
  rows.forEach((row) => log(fmt(row)));
  if (runs.length > 20) log(c.dim(`(latest 20 of ${runs.length})`));
}

function summary(s, log) {
  const o = s.outcomes;
  const p = s.outcomePct;
  const modes = Object.entries(s.byMode).map(([m, n]) => `${n} ${m}`).join(', ');
  const gates = Object.entries(s.blockedByGate).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g} ${n}`).join(', ');
  const cycles = (x) => (x.runs ? `median ${x.median}, p95 ${x.p95}  (${x.runs} runs)` : 'no passes yet');
  log('');
  log(`Runs          ${s.total}  (${modes})`);
  log(`Outcomes      shipped ${o.shipped} (${p.shipped}%)   needs-human ${o['needs-human']} (${p['needs-human']}%)   blocked ${o.blocked} (${p.blocked}%)`);
  if (gates) log(`Blocked at    ${gates}`);
  log(`Review        cycles to pass: ${cycles(s.review)}`);
  log(`Security      cycles to pass: ${cycles(s.security)}`);
  const rate = s.revertRatePct === null ? 'unknown' : `${s.revertRatePct}%`;
  log(`Merged        ${s.merged}   reverted ${s.reverted}   revert rate ${rate}${s.revertUnknown ? `   (${s.revertUnknown} not checkable)` : ''}`);
}

module.exports = function statsCmd(opts = {}) {
  const log = opts.quiet ? () => {} : console.log;
  const cfg = loadConfig();
  if (opts.refresh) {
    const flipped = outcomes.refreshReverts(cfg);
    require('./reap').reportReverts(flipped);
  }
  const { runs } = history.load(cfg);
  const s = history.computeStats(runs);
  if (opts.json) {
    log(JSON.stringify({ summary: s, runs }, null, 2));
    return s;
  }
  if (runs.length === 0) {
    log('No runs yet. Headless runs (gloop run) and merged loops (gloop reap) are recorded in .loops/history.json.');
    return s;
  }
  log(`${c.bold('gloop stats')}  from .loops/history.json\n`);
  table(runs, log);
  summary(s, log);
  return s;
};
