// The review contract: what a reviewer stage must output, how the author resolves it,
// and what still blocks. Pure functions, so the convergence rules are unit-testable
// without spawning an agent.
const fs = require('fs');
const path = require('path');

const SEVERITIES = ['important', 'nit', 'pre-existing'];
const NO_ISSUES = 'no issues';
// PROOF.md becomes the PR body; these sections must exist and say something.
const PROOF_SECTIONS = ['Testing', 'Risk', 'How to revert'];

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

// Pull the reviewer's JSON out of free-form agent output: the last fenced block wins,
// then the whole text, then the outermost {...}.
function extractJSON(text) {
  const s = String(text || '');
  const tries = [];
  const fences = [...s.matchAll(/```(?:json)?[ \t]*\n([\s\S]*?)```/g)];
  if (fences.length) tries.push(fences[fences.length - 1][1]);
  tries.push(s.trim());
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i >= 0 && j > i) tries.push(s.slice(i, j + 1));
  for (const t of tries) {
    try { return JSON.parse(t); } catch { /* try the next shape */ }
  }
  return null;
}

// Strict on purpose: a reviewer that says "1 issue" but lists none, or "no issues" while
// listing some, is not trusted. Every finding must point at a file and line.
function validateFindings(doc) {
  const bad = (error) => ({ ok: false, error });
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return bad('not a JSON object');
  if (!nonEmpty(doc.summary)) return bad('missing "summary"');
  if (!Array.isArray(doc.findings)) return bad('missing "findings" array');
  const saysClean = doc.summary.trim().toLowerCase().replace(/[.!]+$/, '') === NO_ISSUES;
  if (doc.findings.length === 0 && !saysClean) return bad('no findings listed but summary is not "no issues"');
  if (doc.findings.length > 0 && saysClean) return bad('summary says "no issues" but findings are listed');
  const seen = new Set();
  for (const [n, f] of doc.findings.entries()) {
    const at = `finding ${n + 1}`;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return bad(`${at}: not an object`);
    if (!nonEmpty(f.id)) return bad(`${at}: missing "id"`);
    if (seen.has(f.id)) return bad(`${at}: duplicate id "${f.id}"`);
    seen.add(f.id);
    if (!SEVERITIES.includes(f.severity)) return bad(`${f.id}: "severity" must be one of ${SEVERITIES.join(', ')}`);
    if (!nonEmpty(f.class)) return bad(`${f.id}: missing "class"`);
    if (!nonEmpty(f.file)) return bad(`${f.id}: missing "file"`);
    if (!Number.isInteger(f.line) || f.line < 1) return bad(`${f.id}: "line" must be a positive integer`);
    if (!nonEmpty(f.summary)) return bad(`${f.id}: missing "summary"`);
  }
  return { ok: true };
}

// Fold one review cycle into the running store (id -> entry). Only `important` blocks.
// Re-reporting an id that was resolved reopens it: the reviewer is saying the fix is
// missing or wrong.
function ingest(store, findings, cycle) {
  for (const f of findings) {
    const prev = store[f.id];
    store[f.id] = {
      ...f,
      cycle,
      everImportant: !!(prev && prev.everImportant) || f.severity === 'important',
      open: f.severity === 'important',
      resolution: null,
      reopened: !!(prev && prev.resolution),
    };
  }
  return store;
}

function openIds(store) {
  return Object.keys(store).filter((id) => store[id].open);
}

// Which loop repo a finding belongs to: findings name files relative to the feature
// folder (backend/src/x.js). A single-repo loop owns every finding.
function repoOf(file, repoNames) {
  const first = String(file).replace(/^\.\//, '').split('/')[0];
  if (repoNames.includes(first)) return first;
  return repoNames.length === 1 ? repoNames[0] : null;
}

// "fixed" must come with a commit in the finding's repo; "wontfix" must say why.
function resolveOne(entry, r, { movedRepos, repoNames }) {
  if (!r || typeof r !== 'object') return { ok: false, why: 'no resolution written' };
  if (r.status === 'wontfix') return nonEmpty(r.reason) ? { ok: true } : { ok: false, why: 'wontfix without a reason' };
  if (r.status === 'fixed') {
    const repo = repoOf(entry.file, repoNames);
    const committed = repo ? movedRepos.includes(repo) : movedRepos.length > 0;
    return committed ? { ok: true } : { ok: false, why: `marked fixed but no new commit in ${repo || 'any repo'}` };
  }
  return { ok: false, why: `unknown status "${r.status}"` };
}

// Apply the author's resolutions to every open finding. Returns what stays open and why.
function applyResolutions(store, resolutions, ctx) {
  const unresolved = [];
  for (const id of openIds(store)) {
    const r = resolutions && typeof resolutions === 'object' ? resolutions[id] : undefined;
    const verdict = resolveOne(store[id], r, ctx);
    if (verdict.ok) {
      store[id].open = false;
      store[id].resolution = { status: r.status, reason: String(r.reason || '').trim() };
    } else {
      unresolved.push({ id, why: verdict.why });
    }
  }
  return unresolved;
}

function counts(store) {
  const all = Object.values(store);
  const resolved = (status) => all.filter((e) => e.everImportant && !e.open && e.resolution && e.resolution.status === status).length;
  return {
    important: all.filter((e) => e.everImportant).length,
    nit: all.filter((e) => e.severity === 'nit').length,
    'pre-existing': all.filter((e) => e.severity === 'pre-existing').length,
    fixed: resolved('fixed'),
    wontfix: resolved('wontfix'),
  };
}

// Split markdown into { lowercased heading: body }.
function proofSections(text) {
  const out = {};
  let cur = null;
  for (const line of String(text).split('\n')) {
    const h = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (h) { cur = h[1].trim().toLowerCase(); out[cur] = out[cur] || ''; continue; }
    if (cur) out[cur] += `${line}\n`;
  }
  return out;
}

function nonEmptyFile(file) {
  return fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim().length > 0;
}

// Everything ship needs to show its work. Returns a list of problems; empty = proven.
function checkProof(runDir) {
  const problems = [];
  if (!nonEmptyFile(path.join(runDir, 'proof', 'tests.txt'))) problems.push('proof/tests.txt missing or empty');
  if (!nonEmptyFile(path.join(runDir, 'proof', 'qa.md'))) problems.push('proof/qa.md missing or empty');
  const pm = path.join(runDir, 'proof', 'PROOF.md');
  if (!fs.existsSync(pm)) {
    problems.push('proof/PROOF.md missing');
  } else {
    const s = proofSections(fs.readFileSync(pm, 'utf8'));
    for (const name of PROOF_SECTIONS) {
      if (!nonEmpty(s[name.toLowerCase()])) problems.push(`PROOF.md section "${name}" missing or empty`);
    }
  }
  return problems;
}

module.exports = {
  SEVERITIES, NO_ISSUES, PROOF_SECTIONS,
  extractJSON, validateFindings, ingest, openIds, repoOf, resolveOne, applyResolutions,
  counts, proofSections, nonEmptyFile, checkProof,
};
