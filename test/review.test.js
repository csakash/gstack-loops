// Unit tests for the review contract: findings validation, resolution rules,
// reopen-on-re-report, proof checks. No agents, no git.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const review = require('../lib/review');
const { resolveFixCycles } = require('../lib/pipeline');

const f = (over = {}) => ({ id: 'r1-01', severity: 'important', class: 'unchecked null', file: 'svc/a.js', line: 3, summary: 'x', ...over });

test('extractJSON: last fenced block wins, falls back to bare JSON', () => {
  assert.deepEqual(review.extractJSON('a\n```json\n{"a":1}\n```\nb\n```json\n{"b":2}\n```\n'), { b: 2 });
  assert.deepEqual(review.extractJSON('{"summary":"no issues","findings":[]}'), { summary: 'no issues', findings: [] });
  assert.deepEqual(review.extractJSON('Here you go: {"x": 1} thanks'), { x: 1 });
  assert.equal(review.extractJSON('looks good to me'), null);
});

test('validateFindings: accepts a clean review and a well-formed finding', () => {
  assert.ok(review.validateFindings({ summary: 'no issues', findings: [] }).ok);
  assert.ok(review.validateFindings({ summary: 'No issues.', findings: [] }).ok);
  assert.ok(review.validateFindings({ summary: '1 issue (1 important)', findings: [f()] }).ok);
});

test('validateFindings: rejects a reviewer whose summary contradicts its findings', () => {
  assert.match(review.validateFindings({ summary: '1 issue', findings: [] }).error, /not "no issues"/);
  assert.match(review.validateFindings({ summary: 'no issues', findings: [f()] }).error, /findings are listed/);
});

test('validateFindings: rejects missing fields, bad severity, guessed locations, duplicate ids', () => {
  const v = (doc) => review.validateFindings(doc).error;
  assert.match(v(null), /not a JSON object/);
  assert.match(v({ findings: [] }), /summary/);
  assert.match(v({ summary: 'x' }), /findings/);
  assert.match(v({ summary: '1', findings: [f({ severity: 'blocker' })] }), /severity/);
  assert.match(v({ summary: '1', findings: [f({ class: '' })] }), /class/);
  assert.match(v({ summary: '1', findings: [f({ file: '' })] }), /file/);
  assert.match(v({ summary: '1', findings: [f({ line: 0 })] }), /line/);
  assert.match(v({ summary: '1', findings: [f({ line: '3' })] }), /line/);
  assert.match(v({ summary: '2', findings: [f(), f()] }), /duplicate id/);
});

test('ingest: only important findings are open; nits and pre-existing never block', () => {
  const store = review.ingest({}, [f(), f({ id: 'r1-02', severity: 'nit' }), f({ id: 'r1-03', severity: 'pre-existing' })], 1);
  assert.deepEqual(review.openIds(store), ['r1-01']);
});

test('resolveOne: fixed needs a commit in the finding\'s repo; wontfix needs a reason', () => {
  const ctx = (movedRepos) => ({ movedRepos, repoNames: ['backend', 'frontend'] });
  const be = f({ file: 'backend/src/a.js' });
  assert.ok(review.resolveOne(be, { status: 'fixed' }, ctx(['backend'])).ok);
  assert.match(review.resolveOne(be, { status: 'fixed' }, ctx(['frontend'])).why, /no new commit in backend/);
  assert.match(review.resolveOne(be, { status: 'wontfix' }, ctx([])).why, /without a reason/);
  assert.match(review.resolveOne(be, { status: 'wontfix', reason: '  ' }, ctx([])).why, /without a reason/);
  assert.ok(review.resolveOne(be, { status: 'wontfix', reason: 'intended: see SPEC' }, ctx([])).ok);
  assert.match(review.resolveOne(be, undefined, ctx(['backend'])).why, /no resolution/);
  assert.match(review.resolveOne(be, { status: 'done' }, ctx(['backend'])).why, /unknown status/);
});

test('repoOf: first path segment, or the only repo of a single-repo loop', () => {
  assert.equal(review.repoOf('backend/x.js', ['backend', 'frontend']), 'backend');
  assert.equal(review.repoOf('./frontend/x.js', ['backend', 'frontend']), 'frontend');
  assert.equal(review.repoOf('src/x.js', ['backend', 'frontend']), null);
  assert.equal(review.repoOf('src/x.js', ['svc']), 'svc');
});

test('re-reporting a resolved id reopens it; counts track each id once', () => {
  const store = review.ingest({}, [f()], 1);
  const left = review.applyResolutions(store, { 'r1-01': { status: 'fixed', reason: 'guarded' } }, { movedRepos: ['svc'], repoNames: ['svc'] });
  assert.deepEqual(left, []);
  assert.deepEqual(review.openIds(store), []);
  assert.equal(review.counts(store).fixed, 1);
  review.ingest(store, [f()], 2);
  assert.deepEqual(review.openIds(store), ['r1-01']);
  assert.equal(store['r1-01'].reopened, true);
  const c = review.counts(store);
  assert.equal(c.important, 1);
  assert.equal(c.fixed, 0, 'a reopened finding is no longer counted as fixed');
});

test('checkProof: lists every missing piece; passes on complete proof', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gloop-proof-'));
  try {
    const problems = review.checkProof(dir);
    assert.equal(problems.length, 3);
    fs.mkdirSync(path.join(dir, 'proof'));
    fs.writeFileSync(path.join(dir, 'proof', 'tests.txt'), 'ok\n');
    fs.writeFileSync(path.join(dir, 'proof', 'qa.md'), 'ok\n');
    fs.writeFileSync(path.join(dir, 'proof', 'PROOF.md'), '## Testing\nran it\n## Risk\n\n## How to revert\ngit revert\n');
    assert.deepEqual(review.checkProof(dir), ['PROOF.md section "Risk" missing or empty']);
    fs.writeFileSync(path.join(dir, 'proof', 'PROOF.md'), '# Testing\nran it\n### Risk\nlow\n## How to revert\ngit revert\n');
    assert.deepEqual(review.checkProof(dir), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveFixCycles: flag, then loops.json review.fixCycles, then 2; rejects junk', () => {
  assert.equal(resolveFixCycles({}, {}), 2);
  assert.equal(resolveFixCycles({ review: { fixCycles: 4 } }, {}), 4);
  assert.equal(resolveFixCycles({ review: { fixCycles: 4 } }, { fixCycles: 3 }), 3);
  assert.equal(resolveFixCycles({}, { fixCycles: 0 }), 0);
  assert.equal(resolveFixCycles({}, { fixCycles: NaN }), 2);
  assert.equal(resolveFixCycles({}, { fixCycles: -1 }), 2);
});
