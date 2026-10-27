#!/usr/bin/env node
// Build the e2e mock workspace: a two-repo notes app (backend API + frontend) with local bare
// remotes standing in for GitHub. Usage: node mock-project.js <workspace-dir>
// Zero dependencies, so the agents under test can run every script without installing.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ws = path.resolve(process.argv[2] || 'e2e-ws');
const remotes = path.join(path.dirname(ws), 'remotes');
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe', encoding: 'utf8' }).trim();
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

const BACKEND = {
  'package.json': JSON.stringify({
    name: 'notes-backend', version: '0.1.0', private: true,
    scripts: { dev: 'node server.js', test: 'node --test', build: 'node --check server.js && node --check lib/notes.js' },
  }, null, 2) + '\n',
  'lib/notes.js': `// In-memory notes store.
let notes = [];
let nextId = 1;

function list() { return notes.slice(); }

function add(text) {
  const note = { id: nextId++, text: String(text).trim(), createdAt: new Date().toISOString() };
  notes.push(note);
  return note;
}

function get(id) { return notes.find((n) => n.id === id) || null; }

function reset() { notes = []; nextId = 1; }

module.exports = { list, add, get, reset };
`,
  'server.js': `// Notes API. PORT and FRONTEND_URL come from the environment (gloop wires both per loop).
const http = require('http');
const notes = require('./lib/notes');

const PORT = Number(process.env.PORT || 4000);
const ORIGIN = process.env.FRONTEND_URL || '*';

function send(res, code, body) {
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': ORIGIN,
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(code === 204 ? '' : JSON.stringify(body));
}

function readJson(req, cb) {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => { try { cb(null, JSON.parse(body || '{}')); } catch (e) { cb(e); } });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return send(res, 204);
  if (url.pathname === '/api/health') return send(res, 200, { ok: true });
  if (url.pathname === '/api/notes' && req.method === 'GET') return send(res, 200, notes.list());
  if (url.pathname === '/api/notes' && req.method === 'POST') {
    return readJson(req, (err, data) => {
      if (err) return send(res, 400, { error: 'invalid json' });
      if (typeof data.text !== 'string' || !data.text.trim()) return send(res, 400, { error: 'text required' });
      return send(res, 201, notes.add(data.text));
    });
  }
  return send(res, 404, { error: 'not found' });
});

if (require.main === module) server.listen(PORT, () => console.log(\`notes backend on :\${PORT}, CORS \${ORIGIN}\`));
module.exports = server;
`,
  'test/notes.test.js': `const test = require('node:test');
const assert = require('node:assert');
const notes = require('../lib/notes');

test('add then list', () => {
  notes.reset();
  const n = notes.add('  hello ');
  assert.equal(n.text, 'hello');
  assert.deepEqual(notes.list().map((x) => x.id), [1]);
});

test('get unknown id is null', () => {
  notes.reset();
  assert.equal(notes.get(42), null);
});
`,
  '.gitignore': 'node_modules/\n.env\n',
};

const FRONTEND = {
  'package.json': JSON.stringify({
    name: 'notes-frontend', version: '0.1.0', private: true,
    scripts: { dev: 'node serve.js', test: 'node --test', build: 'node --check serve.js && node --check public/app.js' },
  }, null, 2) + '\n',
  'serve.js': `// Static dev server. --port <n> (gloop passes it); VITE_API_URL points at the backend.
const http = require('http');
const fs = require('fs');
const path = require('path');

const i = process.argv.indexOf('--port');
const PORT = Number(i > -1 ? process.argv[i + 1] : process.env.PORT || 5173);
const API = process.env.VITE_API_URL || 'http://localhost:4000';
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(\`window.API_URL = \${JSON.stringify(API)};\`);
  }
  const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    return res.end(data);
  });
}).listen(PORT, () => console.log(\`notes frontend on :\${PORT} -> \${API}\`));
`,
  'public/index.html': `<!doctype html>
<html><head><meta charset="utf-8"><title>Notes</title></head>
<body>
  <h1>Notes</h1>
  <form id="add"><input id="text" placeholder="New note"><button>Add</button></form>
  <ul id="notes"></ul>
  <script src="/config.js"></script>
  <script src="/app.js"></script>
</body></html>
`,
  'public/app.js': `// Notes UI. API_URL is injected by /config.js.
function render(list) {
  const ul = document.getElementById('notes');
  ul.innerHTML = '';
  for (const n of list) {
    const li = document.createElement('li');
    li.textContent = n.text;
    ul.appendChild(li);
  }
}

async function load() {
  const res = await fetch(window.API_URL + '/api/notes');
  render(await res.json());
}

document.getElementById('add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = document.getElementById('text').value;
  await fetch(window.API_URL + '/api/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  document.getElementById('text').value = '';
  load();
});

load();
`,
  'test/smoke.test.js': `const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('index loads config before app', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.indexOf('/config.js') < html.indexOf('/app.js'));
});
`,
  '.gitignore': 'node_modules/\n.env\n',
};

fs.rmSync(ws, { recursive: true, force: true });
fs.rmSync(remotes, { recursive: true, force: true });
for (const [name, files] of [['backend', BACKEND], ['frontend', FRONTEND]]) {
  const dir = path.join(ws, name);
  for (const [rel, text] of Object.entries(files)) write(path.join(dir, rel), text);
  write(path.join(dir, '.env'), name === 'backend' ? 'PORT=4000\nDB_PASSWORD=root-secret-not-for-commit\n' : 'VITE_API_URL=http://localhost:4000\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'dev@mock.test');
  git(dir, 'config', 'user.name', 'Mock Dev');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', `${name}: initial notes app`);
  const bare = path.join(remotes, `${name}.git`);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  git(dir, 'remote', 'add', 'origin', bare);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
}
console.log(ws);
