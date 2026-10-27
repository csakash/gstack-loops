// P2 feedback: merges and reverts recorded in history.json (for headless *and* interactive
// loops), and `gloop stats`. Real git remotes and a real `git revert`; a fake `gh` on PATH
// (test/fixtures/gh-bin/gh) so nothing touches GitHub.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const GH_BIN = path.join(__dirname, 'fixtures', 'gh-bin');
fs.chmodSync(path.join(GH_BIN, 'gh'), 0o755);
process.env.PATH = `${GH_BIN}${path.delimiter}${process.env.PATH}`;

const newCmd = require('../commands/new');
const reapCmd = require('../commands/reap');
const statsCmd = require('../commands/stats');
const history = require('../lib/history');
const outcomes = require('../lib/outcomes');
const registry = require('../lib/registry');
const { loadConfig } = require('../lib/config');

function git(dir, ...args) { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim(); }

// A workspace with repo "svc" (origin = a bare repo), loop "demo" with one commit, and that
// commit "merged" by pushing it to origin/main. Returns paths + the merge sha.
function mergedLoop() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gloop-out-'));
  const repo = path.join(root, 'svc');
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@t.dev');
  git(repo, 'config', 'user.name', 'test');
  fs.writeFileSync(path.join(repo, 'README.md'), '# svc\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-q', 'origin', 'main');
  fs.writeFileSync(path.join(root, 'loops.json'), JSON.stringify({
    portStride: 100, repos: [{ name: 'svc', path: 'svc', basePort: 4000, dev: ['npm', 'run', 'dev'], env: {} }],
  }));
  process.chdir(root);
  newCmd('demo', {});
  const wt = path.join(root, 'worktrees', 'demo', 'svc');
  fs.writeFileSync(path.join(wt, 'demo.js'), 'module.exports = 1;\n');
  git(wt, 'add', '.');
  git(wt, 'commit', '-q', '-m', 'Add demo');
  git(wt, 'push', '-q', 'origin', 'HEAD:main');
  const sha = git(wt, 'rev-parse', 'HEAD');
  return { root, repo, wt, sha };
}

function ghScenario(root, scen) {
  const file = path.join(root, 'gh.json');
  fs.writeFileSync(file, JSON.stringify(scen));
  process.env.FAKE_GH_SCENARIO = file;
}

const mergedPr = (sha, over = {}) => ({
  number: 7, state: 'MERGED', url: 'https://github.com/o/svc/pull/7', title: 'Add demo',
  mergedAt: new Date().toISOString(), mergeCommit: { oid: sha }, ...over,
});

// Run fn inside a merged-loop workspace with console silenced; collect what was logged.
async function withMergedLoop(fn) {
  const cwd = process.cwd();
  const log = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  let w;
  try {
    w = mergedLoop();
    await fn({ ...w, lines, cfg: () => loadConfig(w.root) });
  } finally {
    console.log = log;
    process.chdir(cwd);
    if (w) fs.rmSync(w.root, { recursive: true, force: true });
  }
}

const runs = (cfg) => history.load(cfg).runs;

// ---- failure and edge cases first ----------------------------------------------------

test('an unmerged PR is not reaped and records nothing', async () => {
  await withMergedLoop(({ root, cfg }) => {
    ghScenario(root, { view: { 'feat/demo': { number: 7, state: 'OPEN', url: 'u', title: 't', mergedAt: null, mergeCommit: null } } });
    reapCmd();
    assert.ok(registry.getLoop(cfg(), 'demo'), 'loop kept');
    assert.deepEqual(runs(cfg()), []);
  });
});

test('when neither gh nor git can tell, reverted is null, not false', async () => {
  await withMergedLoop(({ root, cfg }) => {
    ghScenario(root, { listFails: true, view: { 'feat/demo': mergedPr(null, { mergeCommit: null }) } });
    reapCmd();
    const [rec] = runs(cfg());
    assert.equal(rec.reverted, null);
    assert.equal(history.computeStats(runs(cfg())).revertUnknown, 1);
  });
});

test('merges older than 30 days are not re-checked', async () => {
  await withMergedLoop(({ root, repo, sha, cfg }) => {
    ghScenario(root, { view: { 'feat/demo': mergedPr(sha, { mergedAt: new Date(Date.now() - 40 * 864e5).toISOString() }) } });
    reapCmd();
    git(repo, 'pull', '-q', 'origin', 'main');
    git(repo, 'revert', '--no-edit', sha);
    git(repo, 'push', '-q', 'origin', 'main');
    assert.deepEqual(outcomes.refreshReverts(cfg()), []);
    assert.equal(runs(cfg())[0].reverted, false);
  });
});

// ---- recording merges ----------------------------------------------------------------

test('reaping a loop built interactively records it as interactive, with its merge', async () => {
  await withMergedLoop(({ root, sha, cfg, lines }) => {
    ghScenario(root, { view: { 'feat/demo': mergedPr(sha) } });
    reapCmd();
    assert.equal(registry.getLoop(cfg(), 'demo'), null, 'loop reaped');
    const all = runs(cfg());
    assert.equal(all.length, 1);
    const [rec] = all;
    assert.equal(rec.mode, 'interactive');
    assert.equal(rec.outcome, 'shipped');
    assert.equal(rec.cycles, null, 'cycle counts are unknown, not zero');
    assert.deepEqual(rec.merged.svc, { number: 7, url: 'https://github.com/o/svc/pull/7', title: 'Add demo', mergeCommit: sha, mergedAt: rec.mergedAt });
    assert.equal(rec.reverted, false, 'checked, and not reverted');
    assert.ok(lines.some((l) => /recorded merge of "demo" \(interactive\)/.test(l)));
  });
});

test('reaping after a headless run that shipped updates that run instead of adding one', async () => {
  await withMergedLoop(({ root, sha, cfg }) => {
    history.append(cfg(), { slug: 'demo', mode: 'autonomous', outcome: 'shipped', cycles: { review: 2, security: 1 }, prs: { svc: 'https://github.com/o/svc/pull/7' }, mergedAt: null, reverted: null });
    ghScenario(root, { view: { 'feat/demo': mergedPr(sha) } });
    reapCmd();
    const all = runs(cfg());
    assert.equal(all.length, 1);
    assert.equal(all[0].mode, 'autonomous');
    assert.ok(all[0].mergedAt);
  });
});

test('a loop finished by hand after a blocked run gets its own interactive record', async () => {
  await withMergedLoop(({ root, sha, cfg }) => {
    history.append(cfg(), { slug: 'demo', mode: 'autonomous', outcome: 'blocked', blockedGate: 'qa', mergedAt: null });
    ghScenario(root, { view: { 'feat/demo': mergedPr(sha) } });
    reapCmd();
    const all = runs(cfg());
    assert.equal(all.length, 2);
    assert.equal(all[0].mergedAt, null, 'the blocked run stays blocked');
    assert.equal(all[1].mode, 'interactive');
    assert.match(all[1].reason, /after a blocked autonomous run/);
  });
});

// ---- detecting reverts over time -----------------------------------------------------

test('a git revert on the base branch is caught by the next reap', async () => {
  await withMergedLoop(({ root, repo, sha, cfg, lines }) => {
    ghScenario(root, { view: { 'feat/demo': mergedPr(sha) } });
    reapCmd();
    assert.equal(runs(cfg())[0].reverted, false);
    git(repo, 'pull', '-q', 'origin', 'main');
    git(repo, 'revert', '--no-edit', sha);
    git(repo, 'push', '-q', 'origin', 'main');
    reapCmd(); // no loops left; still re-checks recent merges
    assert.equal(runs(cfg())[0].reverted, true);
    assert.ok(lines.some((l) => /"demo" was reverted after merging/.test(l)));
  });
});

test('a GitHub revert PR found by its title alone counts', async () => {
  await withMergedLoop(({ root, sha, cfg }) => {
    ghScenario(root, { view: { 'feat/demo': mergedPr(sha) } });
    reapCmd();
    ghScenario(root, { list: [{ number: 9, title: 'Revert "Add demo"', body: 'manual rollback' }] });
    statsCmd({ refresh: true, quiet: true });
    assert.equal(runs(cfg())[0].reverted, true);
  });
});

test('a GitHub revert PR found by its body alone is caught by stats --refresh', async () => {
  await withMergedLoop(({ root, sha, cfg }) => {
    ghScenario(root, { view: { 'feat/demo': mergedPr(sha) } });
    reapCmd();
    ghScenario(root, { list: [{ number: 9, title: 'Roll back the demo', body: 'Reverts o/svc#7' }] });
    const s = statsCmd({ refresh: true, quiet: true });
    assert.equal(runs(cfg())[0].reverted, true);
    assert.equal(s.reverted, 1);
    assert.equal(s.revertRatePct, 100);
  });
});

test('a revert PR for a different PR number does not count', async () => {
  await withMergedLoop(({ root, sha, cfg }) => {
    ghScenario(root, { view: { 'feat/demo': mergedPr(sha) } });
    reapCmd();
    ghScenario(root, { list: [{ number: 9, title: 'Revert "Something else"', body: 'Reverts o/svc#77' }] });
    statsCmd({ refresh: true, quiet: true });
    assert.equal(runs(cfg())[0].reverted, false);
  });
});

// ---- stats ---------------------------------------------------------------------------

test('computeStats: outcomes, gates, cycles-to-pass (only passes), revert rate', () => {
  const now = new Date().toISOString();
  const s = history.computeStats([
    { slug: 'a', mode: 'autonomous', outcome: 'shipped', cycles: { review: 1, security: 1 }, converged: { review: true, security: true }, mergedAt: now, reverted: false },
    { slug: 'b', mode: 'bypass', outcome: 'needs-human', cycles: { review: 2, security: 1 }, converged: { review: true, security: true } },
    { slug: 'c', mode: 'autonomous', outcome: 'blocked', blockedGate: 'review', cycles: { review: 3, security: 0 }, converged: { review: false, security: null } },
    { slug: 'd', mode: 'interactive', outcome: 'shipped', cycles: null, mergedAt: now, reverted: true },
    { slug: 'e', mode: 'autonomous', outcome: 'blocked', blockedGate: 'qa', cycles: { review: 1, security: 2 }, converged: { review: true, security: true } },
    { slug: 'f', mode: 'autonomous', outcome: 'shipped', cycles: { review: 4, security: 0 } }, // pre-P2 record: inferred
  ]);
  assert.equal(s.total, 6);
  assert.deepEqual(s.byMode, { autonomous: 4, bypass: 1, interactive: 1 });
  assert.deepEqual(s.outcomes, { shipped: 3, 'needs-human': 1, blocked: 2 });
  assert.deepEqual(s.outcomePct, { shipped: 50, 'needs-human': 17, blocked: 33 });
  assert.deepEqual(s.blockedByGate, { review: 1, qa: 1 });
  assert.deepEqual(s.review, { runs: 4, median: 1.5, p95: 4 }, 'the run that never converged is not a pass');
  assert.deepEqual(s.security, { runs: 3, median: 1, p95: 2 });
  assert.equal(s.merged, 2);
  assert.equal(s.reverted, 1);
  assert.equal(s.revertRatePct, 50);
});

test('gloop stats: says so when there is nothing yet; --json matches the table numbers', async () => {
  await withMergedLoop(({ root, sha, cfg, lines }) => {
    statsCmd({});
    assert.ok(lines.some((l) => /^No runs yet/.test(l)));
    ghScenario(root, { view: { 'feat/demo': mergedPr(sha) } });
    reapCmd();
    lines.length = 0;
    statsCmd({});
    const text = lines.join('\n');
    assert.match(text, /demo\s+\d{4}-\d{2}-\d{2}\s+interactive\s+shipped\s+-\s+-\s+-\s+\d{4}-\d{2}-\d{2}\s+no/);
    assert.match(text, /Merged\s+1\s+reverted 0\s+revert rate 0%/);
    lines.length = 0;
    statsCmd({ json: true });
    const out = JSON.parse(lines.join('\n'));
    assert.deepEqual(out.summary, history.computeStats(runs(cfg())));
    assert.equal(out.runs.length, 1);
  });
});

test('gloop stats works without gh', async () => {
  await withMergedLoop(({ root }) => {
    const res = require('child_process').spawnSync(process.execPath, [path.resolve(__dirname, '../bin/gloop'), 'stats'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, PATH: path.dirname(process.execPath) },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /No runs yet/);
  });
});
