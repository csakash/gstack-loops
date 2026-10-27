// P1 pieces outside the stage runner: the sensitive-path matcher, review config defaults,
// `gloop risk`, and `gloop init` being safe to re-run on an existing workspace.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const risk = require('../lib/risk');
const { loadConfig } = require('../lib/config');
const initCmd = require('../commands/init');
const newCmd = require('../commands/new');
const riskCmd = require('../commands/risk');

function git(dir, ...args) { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim(); }

function makeRepo(root, name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t.dev');
  git(dir, 'config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n`);
  git(dir, 'add', 'README.md');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

// Run fn with cwd = a fresh temp workspace; console quiet; always cleaned up.
function inWorkspace(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gloop-p1-'));
  const cwd = process.cwd();
  const log = console.log;
  process.chdir(root);
  console.log = () => {};
  try { return fn(root); } finally {
    console.log = log;
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('glob: ** spans directories, * and ? stay in one segment, plain paths are exact', () => {
  const m = (f, p) => risk.matchesAny(f, [p]);
  assert.ok(m('.github/workflows/ci.yml', '.github/workflows/**'));
  assert.ok(m('.github/workflows/ci.yml', '**/*.yml'));
  assert.ok(m('ci.yml', '**/*.yml'), '**/ also matches zero directories');
  assert.ok(m('auth/login.js', '**/auth/**'));
  assert.ok(m('src/auth/login.js', '**/auth/**'));
  assert.ok(!m('src/author.js', '**/auth/**'), 'a file named like a sensitive dir is not that dir');
  assert.ok(m('setup', 'setup'));
  assert.ok(!m('tools/setup', 'setup'));
  assert.ok(m('scripts/installer.js', '**/install*'));
  assert.ok(!m('src/index.js', '*.js'), '* does not cross a slash');
  assert.ok(m('x.js', '?.js') && !m('ab.js', '?.js'));
  assert.ok(m('a+b(1).js', 'a+b(1).js'), 'regex characters are literal');
  assert.ok(m('./setup', 'setup'));
});

test('describe: caps long lists', () => {
  const hits = ['a', 'b', 'c', 'd', 'e'].map((f) => ({ repo: 'svc', file: f }));
  assert.equal(risk.describe(hits.slice(0, 2)), 'svc/a, svc/b');
  assert.equal(risk.describe(hits), 'svc/a, svc/b, svc/c and 2 more');
});

test('config: review defaults apply when loops.json has no review block', () => {
  inWorkspace((root) => {
    fs.writeFileSync(path.join(root, 'loops.json'), JSON.stringify({ repos: [{ name: 'svc' }] }));
    const cfg = loadConfig(root);
    assert.equal(cfg.review.security, true);
    assert.deepEqual(cfg.review.sensitivePaths, risk.DEFAULT_SENSITIVE);
    fs.writeFileSync(path.join(root, 'loops.json'), JSON.stringify({ repos: [{ name: 'svc' }], review: { security: false, sensitivePaths: [], fixCycles: 3 } }));
    const off = loadConfig(root);
    assert.equal(off.review.security, false);
    assert.deepEqual(off.review.sensitivePaths, []);
    assert.equal(off.review.fixCycles, 3);
  });
});

test('config: a malformed sensitivePaths fails loudly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gloop-p1cfg-'));
  try {
    fs.writeFileSync(path.join(root, 'loops.json'), JSON.stringify({ repos: [{ name: 'svc' }], review: { sensitivePaths: '.github/**' } }));
    const res = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.resolve(__dirname, '../lib/config'))}).loadConfig(${JSON.stringify(root)})`], { encoding: 'utf8' });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /review\.sensitivePaths" must be a list/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('gloop risk: finds sensitive files from inside a worktree, or by slug; [] opts out', () => {
  inWorkspace((root) => {
    makeRepo(root, 'svc');
    fs.writeFileSync(path.join(root, 'loops.json'), JSON.stringify({ portStride: 100, repos: [{ name: 'svc', path: 'svc', basePort: 4000, dev: ['npm', 'run', 'dev'], env: {} }] }));
    newCmd('demo', {});
    const wt = path.join(root, 'worktrees', 'demo', 'svc');
    assert.deepEqual(riskCmd('demo', { quiet: true }), [], 'nothing touched yet');

    fs.mkdirSync(path.join(wt, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.github', 'workflows', 'ci.yml'), 'on: push\n');
    fs.writeFileSync(path.join(wt, 'app.js'), '1\n');
    git(wt, 'add', '.');
    git(wt, 'commit', '-q', '-m', 'ci + app');

    process.chdir(wt);
    assert.deepEqual(riskCmd(undefined, { quiet: true }), [{ repo: 'svc', file: '.github/workflows/ci.yml' }], 'slug inferred from cwd');
    process.chdir(root);
    assert.deepEqual(riskCmd('demo', { quiet: true }).map((h) => h.file), ['.github/workflows/ci.yml']);

    const cfg = JSON.parse(fs.readFileSync('loops.json', 'utf8'));
    fs.writeFileSync('loops.json', JSON.stringify({ ...cfg, review: { sensitivePaths: [] } }));
    assert.deepEqual(riskCmd('demo', { quiet: true }), []);
  });
});

test('gloop init (fresh): writes the review block and a REVIEW.md per repo', () => {
  inWorkspace((root) => {
    makeRepo(root, 'api');
    makeRepo(root, 'web');
    initCmd();
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'loops.json'), 'utf8'));
    assert.deepEqual(cfg.review, { fixCycles: 2, security: true, sensitivePaths: risk.DEFAULT_SENSITIVE });
    for (const r of ['api', 'web']) {
      const md = fs.readFileSync(path.join(root, r, 'REVIEW.md'), 'utf8');
      for (const h of ['What failure looks like here', 'Do not nitpick', 'Ignore', 'How to report']) assert.match(md, new RegExp(`## ${h}`));
    }
  });
});

test('gloop init (re-run): loops.json byte-identical, only missing REVIEW.md files added', () => {
  inWorkspace((root) => {
    makeRepo(root, 'api');
    makeRepo(root, 'web');
    const original = `${JSON.stringify({ portStride: 100, repos: [{ name: 'api', path: 'api' }, { name: 'web', path: 'web' }] }, null, 4)}\n`;
    fs.writeFileSync(path.join(root, 'loops.json'), original);
    fs.writeFileSync(path.join(root, 'api', 'REVIEW.md'), '# mine\n');
    initCmd();
    assert.equal(fs.readFileSync(path.join(root, 'loops.json'), 'utf8'), original);
    assert.equal(fs.readFileSync(path.join(root, 'api', 'REVIEW.md'), 'utf8'), '# mine\n', 'existing guide untouched');
    assert.match(fs.readFileSync(path.join(root, 'web', 'REVIEW.md'), 'utf8'), /## What failure looks like here/);
    assert.match(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), /## gstack-loops/);
    initCmd(); // a third run changes nothing and does not throw
    assert.equal(fs.readFileSync(path.join(root, 'loops.json'), 'utf8'), original);
  });
});
