// Integration: real temp git repos, exercise gloop new/drop across 1 and 2 repos.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const newCmd = require('../commands/new');
const initCmd = require('../commands/init');
const dropCmd = require('../commands/drop');
const registry = require('../lib/registry');
const { loadConfig } = require('../lib/config');

function git(dir, ...args) { execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }); }

function makeRepo(root, name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t.dev');
  git(dir, 'config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n`);
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=rootsecret\n');
  git(dir, 'add', 'README.md');
  git(dir, 'commit', '-m', 'init', '-q');
  return dir;
}

function withWorkspace(repos, cfgExtra, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gloop-it-'));
  repos.forEach((r) => makeRepo(root, r.name));
  fs.writeFileSync(path.join(root, 'loops.json'), JSON.stringify({ portStride: 100, repos, ...cfgExtra }, null, 2));
  const cwd = process.cwd();
  process.chdir(root);
  try { fn(root); } finally { process.chdir(cwd); fs.rmSync(root, { recursive: true, force: true }); }
}

test('init: detects repos, writes loops.json + CLAUDE.md conventions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gloop-init-'));
  ['api', 'web'].forEach((n) => makeRepo(root, n));
  const cwd = process.cwd();
  process.chdir(root);
  try {
    initCmd();
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'loops.json'), 'utf8'));
    assert.deepEqual(cfg.repos.map((r) => r.name).sort(), ['api', 'web']);
    assert.ok(cfg.repos.every((r) => typeof r.basePort === 'number'));
    const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
    assert.match(claude, /## gstack-loops/);
    assert.match(claude, /Never edit `main`/);
  } finally {
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('single repo: new creates worktree on feat branch with wired port', () => {
  withWorkspace(
    [{ name: 'svc', path: 'svc', basePort: 4000, dev: ['npm', 'run', 'dev'], env: { PORT: '{{port}}' } }],
    {},
    (root) => {
      newCmd('demo', {});
      const wt = path.join(root, 'worktrees', 'demo', 'svc');
      assert.ok(fs.existsSync(wt), 'worktree dir exists');
      const head = execFileSync('git', ['-C', wt, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
      assert.equal(head, 'feat/demo');
      const env = fs.readFileSync(path.join(wt, '.env'), 'utf8');
      assert.match(env, /^PORT=4100$/m, 'port wired to slot 1');
      assert.match(env, /^SECRET=rootsecret$/m, 'root secret carried over');
      const reg = registry.load(loadConfig(root));
      assert.equal(reg.loops.demo.ports.svc, 4100);
    },
  );
});

test('two repos: cross-repo env wiring resolves to sibling ports', () => {
  withWorkspace(
    [
      { name: 'backend', path: 'backend', basePort: 4000, dev: ['npm', 'run', 'dev', '--prefix', 'backend'], env: { PORT: '{{port}}', FRONTEND_URL: '{{url:frontend}}' } },
      { name: 'frontend', path: 'frontend', basePort: 5173, dev: ['npm', 'run', 'dev', '--prefix', 'frontend'], serve: { portFlag: '--port' }, env: { VITE_API_URL: '{{url:backend}}' } },
    ],
    {},
    (root) => {
      newCmd('feat-x', {});
      const beEnv = fs.readFileSync(path.join(root, 'worktrees', 'feat-x', 'backend', '.env'), 'utf8');
      const feEnv = fs.readFileSync(path.join(root, 'worktrees', 'feat-x', 'frontend', '.env'), 'utf8');
      assert.match(beEnv, /^PORT=4100$/m);
      assert.match(beEnv, /^FRONTEND_URL=http:\/\/localhost:5273$/m, 'backend CORS points at frontend port');
      assert.match(feEnv, /^VITE_API_URL=http:\/\/localhost:4100$/m, 'frontend API points at backend port');
      // launch.json carries the vite --port flag
      const launch = JSON.parse(fs.readFileSync(path.join(root, 'worktrees', 'feat-x', '.claude', 'launch.json'), 'utf8'));
      const fe = launch.configurations.find((x) => x.name === 'frontend');
      assert.ok(fe.runtimeArgs.includes('--port') && fe.runtimeArgs.includes('5273'));
    },
  );
});

test('two loops get disjoint port blocks', () => {
  withWorkspace(
    [{ name: 'svc', path: 'svc', basePort: 4000, dev: ['npm', 'run', 'dev'], env: { PORT: '{{port}}' } }],
    {},
    (root) => {
      newCmd('a', {});
      newCmd('b', {});
      const reg = registry.load(loadConfig(root));
      assert.notEqual(reg.loops.a.ports.svc, reg.loops.b.ports.svc);
      assert.deepEqual([reg.loops.a.ports.svc, reg.loops.b.ports.svc].sort(), [4100, 4200]);
    },
  );
});

test('drop --force removes worktree and registry entry', () => {
  withWorkspace(
    [{ name: 'svc', path: 'svc', basePort: 4000, dev: ['npm', 'run', 'dev'], env: { PORT: '{{port}}' } }],
    {},
    (root) => {
      newCmd('gone', {});
      assert.ok(fs.existsSync(path.join(root, 'worktrees', 'gone', 'svc')));
      dropCmd('gone', { force: true, deleteBranch: true });
      assert.ok(!fs.existsSync(path.join(root, 'worktrees', 'gone')), 'feature dir removed');
      const reg = registry.load(loadConfig(root));
      assert.equal(reg.loops.gone, undefined);
    },
  );
});

test('drop without --force refuses when commits are ahead', () => {
  withWorkspace(
    [{ name: 'svc', path: 'svc', basePort: 4000, dev: ['npm', 'run', 'dev'], env: {} }],
    {},
    (root) => {
      newCmd('busy', {});
      const wt = path.join(root, 'worktrees', 'busy', 'svc');
      fs.writeFileSync(path.join(wt, 'f.txt'), 'x');
      git(wt, 'add', 'f.txt'); git(wt, 'commit', '-m', 'work', '-q');
      // drop() calls process.exit on refusal; run in a child to capture that.
      const res = require('child_process').spawnSync(process.execPath, ['-e', `
        process.chdir(${JSON.stringify(root)});
        try { require(${JSON.stringify(path.resolve(__dirname, '../commands/drop'))})('busy', {}); }
        catch (e) { process.exit(3); }
      `], { encoding: 'utf8' });
      assert.notEqual(res.status, 0, 'refused (non-zero exit)');
      assert.ok(fs.existsSync(wt), 'worktree preserved');
    },
  );
});

// Found by the e2e run: `gloop init` writes `npm run dev --prefix <repo>`, but servers were
// started from inside the repo worktree, so npm looked for <repo>/<repo> and nothing came up.
test('dev servers start with the commands gloop init writes (multi-repo and single-repo)', async () => {
  const { startServers, stopServers } = require('../commands/run');
  const { portInUse } = require('../lib/proc');
  const DEV = 'node -e "require(\'http\').createServer((q,s)=>s.end(\'ok\')).listen(process.env.PORT)"';
  const pkg = JSON.stringify({ name: 'x', scripts: { dev: DEV } });
  const waitUp = async (port) => { for (let i = 0; i < 50; i += 1) { if (await portInUse(port)) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

  // Multi-repo: exactly what `gloop init` writes for two sibling repos.
  const multi = fs.mkdtempSync(path.join(os.tmpdir(), 'gloop-dev-'));
  const cwd = process.cwd();
  try {
    for (const n of ['api', 'web']) { makeRepo(multi, n); fs.writeFileSync(path.join(multi, n, 'package.json'), pkg); git(path.join(multi, n), 'add', '.'); git(path.join(multi, n), 'commit', '-qm', 'pkg'); }
    process.chdir(multi);
    const log = console.log; console.log = () => {};
    try { initCmd(); } finally { console.log = log; }
    const cfgJson = JSON.parse(fs.readFileSync('loops.json', 'utf8'));
    cfgJson.repos.forEach((r, i) => { r.basePort = 20000 + i * 1000 + Math.floor(Math.random() * 400); r.env = { PORT: '{{port}}' }; });
    fs.writeFileSync('loops.json', JSON.stringify(cfgJson));
    console.log = () => {};
    try { newCmd('srv', {}); } finally { console.log = log; }
    const cfg = loadConfig(multi);
    const loop = registry.getLoop(cfg, 'srv');
    const servers = startServers(cfg, loop, () => {});
    try {
      for (const n of ['api', 'web']) assert.ok(await waitUp(servers[n].port), `${n} dev server is listening on :${servers[n].port}`);
    } finally { stopServers({ servers }); }
  } finally { process.chdir(cwd); fs.rmSync(multi, { recursive: true, force: true }); }

  // Single-repo: the workspace root is the repo (path ".").
  const single = fs.mkdtempSync(path.join(os.tmpdir(), 'gloop-dev1-'));
  try {
    const repo = path.join(single, 'solo');
    makeRepo(single, 'solo');
    fs.writeFileSync(path.join(repo, 'package.json'), pkg);
    fs.writeFileSync(path.join(repo, '.gitignore'), 'worktrees/\n.loops/\n');
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'pkg');
    process.chdir(repo);
    const log = console.log; console.log = () => {};
    try { initCmd(); } finally { console.log = log; }
    const cfgJson = JSON.parse(fs.readFileSync('loops.json', 'utf8'));
    cfgJson.repos[0].basePort = 23000 + Math.floor(Math.random() * 400);
    cfgJson.repos[0].env = { PORT: '{{port}}' };
    fs.writeFileSync('loops.json', JSON.stringify(cfgJson));
    console.log = () => {};
    try { newCmd('one', {}); } finally { console.log = log; }
    const cfg = loadConfig(repo);
    const loop = registry.getLoop(cfg, 'one');
    const launch = JSON.parse(fs.readFileSync(path.join(repo, 'worktrees', 'one', '.claude', 'launch.json'), 'utf8'));
    assert.deepEqual(launch.configurations[0].runtimeArgs, ['run', 'dev', '--prefix', 'solo'], 'launch.json reaches the repo from the feature folder');
    const servers = startServers(cfg, loop, () => {});
    try { assert.ok(await waitUp(servers.solo.port), 'single-repo dev server is listening'); } finally { stopServers({ servers }); }
  } finally { process.chdir(cwd); fs.rmSync(single, { recursive: true, force: true }); }
});
