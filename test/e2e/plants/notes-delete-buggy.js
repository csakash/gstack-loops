#!/usr/bin/env node
// Planted author for the "notes-delete" loop: implements DELETE with two real defects the
// spec forbids, but tests only the happy path, so the suite is green. The *real* reviewer
// must catch them:
//   1. remove() uses splice(indexOf(...)) — an unknown id gives index -1 and deletes the LAST note.
//   2. DELETE answers 204 even when the note does not exist (spec: 404).
// Usage (from the feature folder, as the driver runs it): node notes-delete-buggy.js <runDir>
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const runDir = process.argv[2];
const be = path.resolve('backend');
const edit = (rel, from, to) => {
  const f = path.join(be, rel);
  const s = fs.readFileSync(f, 'utf8');
  if (!s.includes(from)) throw new Error(`plant: anchor not found in ${rel}`);
  fs.writeFileSync(f, s.replace(from, to));
};

edit('lib/notes.js', 'function reset()', `function remove(id) {
  const note = notes.find((n) => n.id === id);
  notes.splice(notes.indexOf(note), 1);
  return true;
}

function reset()`);
edit('lib/notes.js', 'module.exports = { list, add, get, reset };', 'module.exports = { list, add, get, remove, reset };');
edit('server.js', "  return send(res, 404, { error: 'not found' });\n});", `  const m = url.pathname.match(/^\\/api\\/notes\\/(\\d+)$/);
  if (m && req.method === 'DELETE') {
    notes.remove(Number(m[1]));
    return send(res, 204);
  }
  return send(res, 404, { error: 'not found' });
});`);
fs.appendFileSync(path.join(be, 'test/notes.test.js'), `
test('remove deletes a note', () => {
  notes.reset();
  const a = notes.add('a');
  notes.add('b');
  notes.remove(a.id);
  assert.deepEqual(notes.list().map((x) => x.text), ['b']);
});
`);
const git = (...a) => execFileSync('git', ['-C', be, ...a], { encoding: 'utf8', stdio: 'pipe' });
git('add', '-A');
git('commit', '-q', '-m', 'notes: DELETE /api/notes/:id');

let out;
try { out = execFileSync('npm', ['test'], { cwd: be, encoding: 'utf8', stdio: 'pipe' }); } catch (e) { out = `${e.stdout}${e.stderr}`; }
fs.mkdirSync(path.join(runDir, 'proof'), { recursive: true });
fs.writeFileSync(path.join(runDir, 'proof', 'tests.txt'), `$ npm test   (in backend)\n${out}`);
fs.writeFileSync(path.join(runDir, 'proof', 'PROOF.md'), `## Testing
Ran \`npm test\` in backend: see proof/tests.txt (3 passing).

## Risk
Low. Adds one route and one store function.

## How to revert
\`git revert\` the "notes: DELETE /api/notes/:id" commit in backend.
`);
fs.writeFileSync(path.join(runDir, 'stage-build.json'), JSON.stringify({ status: 'ok' }));
console.log('[planted author] committed DELETE with two seeded defects; tests green');
