// Stage runner, end to end against real temp git repos and a fake `claude` on PATH
// (test/fixtures/bin/claude). Failure modes first: every way a stage can lie or
// half-finish must end BLOCKED with nothing pushed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const newCmd = require('../commands/new');
const runCmd = require('../commands/run');
const registry = require('../lib/registry');
const history = require('../lib/history');
const { loadConfig } = require('../lib/config');

const FAKE_BIN = path.join(__dirname, 'fixtures', 'bin');
fs.chmodSync(path.join(FAKE_BIN, 'claude'), 0o755);
process.env.PATH = `${FAKE_BIN}${path.delimiter}${process.env.PATH}`;

function git(dir, ...args) { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim(); }

const PROOF = '## Testing\nran npm test, see proof/tests.txt\n## Risk\nlow: one new module\n## How to revert\ngit revert the merge commit\n';
const FINDING = { id: 'r1-01', severity: 'important', class: 'missing input check', file: 'svc/feature.js', line: 1, summary: 'no guard', fix_hint: 'guard it' };

// Canned stage behaviors.
const S = {
  build: [
    { commit: { repo: 'svc', file: 'feature.js' } },
    { write: '$RUN/proof/tests.txt', content: '$ npm test\n1 passing\n' },
    { write: '$RUN/proof/PROOF.md', content: PROOF },
    { write: '$RUN/stage-build.json', content: { status: 'ok' } },
  ],
  clean: [{ stdout: { summary: 'no issues', findings: [] } }],
  important: [{ stdout: { summary: '1 issue (1 important)', findings: [FINDING] } }],
  qa: [
    { write: '$RUN/proof/qa.md', content: 'GET / at http://localhost:4100 → 200, screenshot qa/home.png\n' },
    { write: '$RUN/stage-qa.json', content: { status: 'ok' } },
  ],
  fixCommit: [
    { commit: { repo: 'svc' } },
    { write: '$RUN/review/fix-$CYCLE.resolutions.json', content: { 'r1-01': { status: 'fixed', reason: 'added guard' } } },
  ],
};
const without = (steps, pathPart) => steps.filter((s) => !(s.write && s.write.includes(pathPart)));

// One throwaway workspace with a single repo "svc" and a loop "demo" that has SPEC.md.
async function scenario(scen, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gloop-pipe-'));
  const repo = path.join(root, 'svc');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@t.dev');
  git(repo, 'config', 'user.name', 'test');
  fs.writeFileSync(path.join(repo, 'README.md'), '# svc\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(root, 'loops.json'), JSON.stringify({
    portStride: 100,
    repos: [{ name: 'svc', path: 'svc', basePort: 4000, dev: ['npm', 'run', 'dev'], env: {} }],
  }));

  const scenFile = path.join(root, 'scenario.json');
  const logFile = path.join(root, 'calls.log');
  fs.writeFileSync(scenFile, JSON.stringify(scen));
  process.env.FAKE_CLAUDE_SCENARIO = scenFile;
  process.env.FAKE_CLAUDE_LOG = logFile;

  const cwd = process.cwd();
  const quietLog = console.log;
  process.chdir(root);
  try {
    console.log = () => {};
    newCmd('demo', {});
    console.log = quietLog;
    fs.writeFileSync(path.join(root, 'worktrees', 'demo', 'svc', 'SPEC.md'), '# spec\nbuild feature.js\n');
    const outcome = await runCmd('demo', { mode: 'bypass', noServers: true, quiet: true, ...opts });
    const cfg = loadConfig(root);
    const calls = fs.existsSync(logFile)
      ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
    const runs = history.load(cfg).runs;
    return { root, outcome, calls, keys: calls.map((c) => c.key), runs, run: runs[runs.length - 1], loop: registry.getLoop(cfg, 'demo') };
  } finally {
    console.log = quietLog;
    process.chdir(cwd);
  }
}

function cleanup(r) { fs.rmSync(r.root, { recursive: true, force: true }); }

// ---- failure modes ---------------------------------------------------------------

test('review that never converges ends BLOCKED after the fix budget, naming the open id', async () => {
  const r = await scenario({ build: S.build, review: S.important, fix: S.fixCommit, qa: S.qa }, { fixCycles: 1 });
  try {
    assert.equal(r.outcome, 'blocked');
    assert.deepEqual(r.keys, ['build', 'review:1', 'fix:1', 'review:2']);
    assert.equal(r.run.blockedGate, 'review');
    assert.match(r.run.reason, /did not converge after 1 cycles — re-evaluate the approach/);
    assert.match(r.run.reason, /r1-01 \(reported again in cycle 2\)/);
    assert.deepEqual(r.run.cycles, { review: 2, fix: 1, security: 0 });
    assert.equal(r.loop.status, 'blocked');
  } finally { cleanup(r); }
});

test('--fix-cycles raises the limit', async () => {
  const r = await scenario({ build: S.build, review: S.important, fix: S.fixCommit, qa: S.qa }, { fixCycles: 3 });
  try {
    assert.deepEqual(r.keys, ['build', 'review:1', 'fix:1', 'review:2', 'fix:2', 'review:3', 'fix:3', 'review:4']);
    assert.match(r.run.reason, /after 3 cycles/);
  } finally { cleanup(r); }
});

test('"fixed" without a commit is unresolved, and an empty fix is not re-reviewed', async () => {
  const lie = [{ write: '$RUN/review/fix-$CYCLE.resolutions.json', content: { 'r1-01': { status: 'fixed', reason: 'trust me' } } }];
  const r = await scenario({ build: S.build, 'review:1': S.important, fix: lie, qa: S.qa }, { fixCycles: 2 });
  try {
    assert.equal(r.outcome, 'blocked');
    assert.deepEqual(r.keys, ['build', 'review:1', 'fix:1', 'fix:2']);
    assert.match(r.run.reason, /r1-01 \(marked fixed but no new commit in svc\)/);
  } finally { cleanup(r); }
});

test('a later fix attempt never reuses an earlier attempt\'s resolutions', async () => {
  const lie = [{ write: '$RUN/review/fix-$CYCLE.resolutions.json', content: { 'r1-01': { status: 'fixed', reason: 'trust me' } } }];
  const r = await scenario({ build: S.build, 'review:1': S.important, 'fix:1': lie, 'fix:2': [{ commit: { repo: 'svc' } }], 'review:2': S.clean, qa: S.qa }, { fixCycles: 2 });
  try {
    assert.equal(r.outcome, 'blocked');
    assert.deepEqual(r.keys, ['build', 'review:1', 'fix:1', 'fix:2', 'review:2']);
    assert.match(r.run.reason, /r1-01 \(no resolution written\)/);
  } finally { cleanup(r); }
});

test('"wontfix" without a reason is unresolved', async () => {
  const noReason = [{ write: '$RUN/review/fix-$CYCLE.resolutions.json', content: { 'r1-01': { status: 'wontfix' } } }];
  const r = await scenario({ build: S.build, 'review:1': S.important, fix: noReason, qa: S.qa }, { fixCycles: 1 });
  try {
    assert.equal(r.outcome, 'blocked');
    assert.match(r.run.reason, /wontfix without a reason/);
  } finally { cleanup(r); }
});

test('a reviewer that modifies the tree ends BLOCKED, whatever it reports', async () => {
  const sneaky = [{ write: 'svc/oops.js', content: 'patched by reviewer\n' }, ...S.clean];
  const r = await scenario({ build: S.build, review: sneaky, qa: S.qa });
  try {
    assert.equal(r.outcome, 'blocked');
    assert.equal(r.run.blockedGate, 'reviewer-modified-tree');
    assert.match(r.run.reason, /reviewer modified tree in svc/);
  } finally { cleanup(r); }
});

test('reviewer output that is not JSON ends BLOCKED and keeps the raw output', async () => {
  const r = await scenario({ build: S.build, review: [{ stdout: 'Looks good to me!' }], qa: S.qa });
  try {
    assert.equal(r.run.blockedGate, 'review');
    assert.match(r.run.reason, /review output invalid \(not a JSON object\)/);
    const raw = r.run.reason.match(/: (\/\S+cycle-1\.raw\.txt)$/)[1];
    assert.equal(fs.readFileSync(raw, 'utf8'), 'Looks good to me!');
  } finally { cleanup(r); }
});

test('a reviewer that claims an issue but lists none is not trusted', async () => {
  const r = await scenario({ build: S.build, review: [{ stdout: { summary: '1 issue', findings: [] } }], qa: S.qa });
  try {
    assert.match(r.run.reason, /review output invalid \(no findings listed but summary is not "no issues"\)/);
  } finally { cleanup(r); }
});

test('build without test output ends BLOCKED: no proof', async () => {
  const r = await scenario({ build: without(S.build, 'tests.txt'), review: S.clean, qa: S.qa });
  try {
    assert.deepEqual(r.keys, ['build']);
    assert.equal(r.run.blockedGate, 'proof');
    assert.match(r.run.reason, /no proof: proof\/tests\.txt/);
  } finally { cleanup(r); }
});

test('missing PROOF.md is caught before ship', async () => {
  const r = await scenario({ build: without(S.build, 'PROOF.md'), review: S.clean, qa: S.qa });
  try {
    assert.deepEqual(r.keys, ['build', 'review:1', 'qa']);
    assert.equal(r.run.blockedGate, 'proof');
    assert.match(r.run.reason, /no proof: proof\/PROOF\.md missing/);
  } finally { cleanup(r); }
});

test('a build that commits nothing, or reports blocked, never reaches review', async () => {
  const noCommit = await scenario({ build: S.build.filter((s) => !s.commit), review: S.clean, qa: S.qa });
  const blocked = await scenario({ build: [{ write: '$RUN/stage-build.json', content: { status: 'blocked', reason: 'SPEC.md is ambiguous about auth' } }] });
  try {
    assert.deepEqual(noCommit.keys, ['build']);
    assert.match(noCommit.run.reason, /no commits on the branch/);
    assert.match(blocked.run.reason, /build: SPEC.md is ambiguous about auth/);
  } finally { cleanup(noCommit); cleanup(blocked); }
});

test('a stage that does not report is not done', async () => {
  const r = await scenario({ build: S.build, review: S.clean, qa: without(S.qa, 'stage-qa') });
  try {
    assert.equal(r.run.blockedGate, 'qa');
    assert.match(r.run.reason, /stage qa did not report/);
  } finally { cleanup(r); }
});

test('autonomous ship that reports no PR URLs ends BLOCKED', async () => {
  const r = await scenario({ build: S.build, review: S.clean, qa: S.qa, ship: [{ write: '$RUN/stage-ship.json', content: { status: 'ok' } }] }, { mode: 'autonomous' });
  try {
    assert.equal(r.run.blockedGate, 'ship');
    assert.match(r.run.reason, /no PR URLs/);
  } finally { cleanup(r); }
});

// ---- happy paths -----------------------------------------------------------------

test('clean run: build and review are separate processes; reviewer is read-only; bypass stops before push', async () => {
  const r = await scenario({ build: S.build, review: S.clean, qa: S.qa });
  try {
    assert.equal(r.outcome, 'needs-human');
    assert.deepEqual(r.keys, ['build', 'review:1', 'qa']);
    const [build, rev] = r.calls;
    assert.deepEqual(build.args.slice(2, 4), ['--permission-mode', 'acceptEdits']);
    assert.deepEqual(rev.args.slice(2, 4), ['--permission-mode', 'default']);
    const denied = rev.args.slice(rev.args.indexOf('--disallowedTools') + 1);
    assert.deepEqual(denied, ['Bash', 'Edit', 'Write', 'NotebookEdit'], 'reviewer has no shell and no write tools');
    assert.ok(!build.args.includes('--disallowedTools'));
    const m = rev.args[1].match(/svc: main\.\.\.HEAD {2}-> {2}(\S+cycle-1\.svc\.diff)/);
    assert.ok(m, 'cycle 1 reviews the whole branch, from a diff file the driver wrote');
    assert.match(fs.readFileSync(m[1], 'utf8'), /\+\+\+ b\/feature\.js/);
    assert.equal(r.loop.status, 'needs-human');
    assert.equal(r.runs.length, 1, 'exactly one history record');
    assert.equal(r.run.outcome, 'needs-human');
    assert.deepEqual(r.run.cycles, { review: 1, fix: 0, security: 0 });
    assert.ok(fs.existsSync(path.join(r.root, r.run.runDir, 'proof', 'build-svc.txt')), 'build gate leaves proof even when skipped');
    assert.ok(fs.existsSync(path.join(r.root, '.loops', 'runs', 'demo', 'latest')));
    assert.equal(git(path.join(r.root, 'worktrees', 'demo', 'svc'), 'log', '--oneline', 'main..HEAD').split('\n').length, 1);
  } finally { cleanup(r); }
});

test('converge in two: re-review sees only the fix commits and is told not to re-report', async () => {
  const r = await scenario({ build: S.build, 'review:1': S.important, 'fix:1': S.fixCommit, 'review:2': S.clean, qa: S.qa });
  try {
    assert.equal(r.outcome, 'needs-human');
    assert.deepEqual(r.keys, ['build', 'review:1', 'fix:1', 'review:2', 'qa']);
    const rev2 = r.calls[3].args[1];
    const m = rev2.match(/svc: [0-9a-f]{40}\.\.HEAD {2}-> {2}(\S+cycle-2\.svc\.diff)/);
    assert.ok(m, 'cycle 2 reviews only the fix commits');
    assert.doesNotMatch(fs.readFileSync(m[1], 'utf8'), /feature\.js/, 'the already-reviewed build commit is not in the re-review diff');
    assert.doesNotMatch(rev2, /main\.\.\.HEAD/);
    assert.match(rev2, /Do not re-report an id listed there/);
    assert.match(r.calls[2].args[1], /Blocking findings you must resolve: r1-01/);
    assert.deepEqual(r.run.findings, { important: 1, nit: 0, 'pre-existing': 0, fixed: 1, wontfix: 0 });
  } finally { cleanup(r); }
});

test('nits and pre-existing findings never trigger a fix cycle', async () => {
  const soft = [{ stdout: { summary: '2 issues (1 nit, 1 pre-existing)', findings: [{ ...FINDING, severity: 'nit' }, { ...FINDING, id: 'r1-02', severity: 'pre-existing' }] } }];
  const r = await scenario({ build: S.build, review: soft, qa: S.qa });
  try {
    assert.equal(r.outcome, 'needs-human');
    assert.deepEqual(r.keys, ['build', 'review:1', 'qa']);
    assert.equal(r.run.findings.nit, 1);
    assert.equal(r.run.findings['pre-existing'], 1);
  } finally { cleanup(r); }
});

test('"wontfix" with a reason resolves without another review cycle', async () => {
  const why = [{ write: '$RUN/review/fix-$CYCLE.resolutions.json', content: { 'r1-01': { status: 'wontfix', reason: 'input is validated upstream in SPEC §2' } } }];
  const r = await scenario({ build: S.build, 'review:1': S.important, fix: why, qa: S.qa });
  try {
    assert.equal(r.outcome, 'needs-human');
    assert.deepEqual(r.keys, ['build', 'review:1', 'fix:1', 'qa']);
    assert.equal(r.run.findings.wontfix, 1);
  } finally { cleanup(r); }
});

test('code changed during qa gets a diff-only review', async () => {
  const qaFix = [{ commit: { repo: 'svc', file: 'qa-fix.js' } }, ...S.qa];
  const r = await scenario({ build: S.build, review: S.clean, qa: qaFix });
  try {
    assert.equal(r.outcome, 'needs-human');
    assert.deepEqual(r.keys, ['build', 'review:1', 'qa', 'review:2']);
    const m = r.calls[3].args[1].match(/svc: [0-9a-f]{40}\.\.HEAD {2}-> {2}(\S+cycle-2\.svc\.diff)/);
    assert.ok(m);
    assert.match(fs.readFileSync(m[1], 'utf8'), /qa-fix\.js/);
    assert.doesNotMatch(fs.readFileSync(m[1], 'utf8'), /feature\.js/);
  } finally { cleanup(r); }
});

test('autonomous ship: PROOF.md goes in the PR body; PR URLs recorded', async () => {
  const ship = [{ write: '$RUN/stage-ship.json', content: { status: 'ok', prs: { svc: 'https://github.com/o/svc/pull/7' } } }];
  const r = await scenario({ build: S.build, review: S.clean, qa: S.qa, ship }, { mode: 'autonomous' });
  try {
    assert.equal(r.outcome, 'shipped');
    assert.deepEqual(r.keys, ['build', 'review:1', 'qa', 'ship']);
    assert.match(r.calls[3].args[1], /PR body MUST contain \S+proof\/PROOF\.md verbatim/);
    assert.deepEqual(r.calls[3].args.slice(2, 4), ['--permission-mode', 'bypassPermissions']);
    assert.deepEqual(r.run.prs, { svc: 'https://github.com/o/svc/pull/7' });
    assert.equal(r.loop.status, 'shipped');
  } finally { cleanup(r); }
});

test('dry-run lists every stage with its prompt and spawns nothing', async () => {
  const lines = [];
  const orig = console.log;
  let r;
  try {
    console.log = (...a) => lines.push(a.join(' '));
    r = await scenario({}, { dryRun: true, quiet: false, mode: 'autonomous' });
  } finally { console.log = orig; }
  try {
    assert.equal(r.outcome, 'dry-run');
    assert.deepEqual(r.calls, [], 'no agent process was spawned');
    assert.equal(r.runs.length, 0, 'no history record for a dry run');
    const order = lines.join('\n').match(/── \d+\. (\w+)/g).map((s) => s.replace(/── \d+\. /, ''));
    assert.deepEqual(order, ['build', 'review', 'fix', 'review', 'qa', 'review', 'buildgate', 'proof', 'ship']);
    assert.match(lines.join('\n'), /GLOOP-STAGE: review cycle=1/);
    assert.match(lines.join('\n'), /--disallowedTools Bash Edit Write NotebookEdit/);
    assert.ok(!fs.existsSync(path.join(r.root, '.loops', 'runs')), 'run dir not created');
  } finally { cleanup(r); }
});
