// Integration: real temp git repos, exercise gloop new/drop across 1 and 2 repos.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const newCmd = require('../commands/new');
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
