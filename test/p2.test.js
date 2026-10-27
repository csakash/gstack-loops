// P2 pieces outside history/stats: CLAUDE.md conventions (current text for new workspaces,
// a hint and never a rewrite for older ones), the branch-protection printout, the docs map.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const initCmd = require('../commands/init');
const { DEFAULT_SENSITIVE } = require('../lib/risk');

const ROOT = path.join(__dirname, '..');

function quietly(fn) {
  const log = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  try { fn(); } finally { console.log = log; }
  return lines.join('\n');
}

function workspace(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gloop-p2-'));
  const dir = path.join(root, 'svc');
  fs.mkdirSync(dir);
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  const cwd = process.cwd();
  process.chdir(root);
  try { fn(root); } finally { process.chdir(cwd); fs.rmSync(root, { recursive: true, force: true }); }
}

test('fresh init: the Definition of Done names proof, security review, REVIEW.md, sensitive paths', () => {
  workspace((root) => {
    quietly(() => initCmd());
    const md = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
    for (const s of ['PROOF.md', 'security review converged', 'REVIEW.md', 'gloop risk', 'gloop stats']) assert.ok(md.includes(s), s);
  });
});

test('an older conventions section is left untouched, with a hint; --print-conventions shows the new one', () => {
  workspace((root) => {
    const old = '# Team notes\n\n## gstack-loops (loop-engineering)\n\nDefinition of Done: /review + /qa pass.\n\n## Other\nkeep me\n';
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), old);
    const out = quietly(() => initCmd());
    assert.equal(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), old, 'never rewritten under the owner');
    assert.match(out, /predates the review layers; left as is/);
    assert.match(out, /gloop init --print-conventions/);
    const printed = quietly(() => initCmd({ printConventions: true }));
    assert.match(printed, /^## gstack-loops/);
    assert.match(printed, /PROOF\.md/);
    const again = quietly(() => initCmd());
    assert.match(again, /predates/, 'still hints on every run until updated');
  });
});

test('a current conventions section gets no hint', () => {
  workspace(() => {
    quietly(() => initCmd());
    assert.doesNotMatch(quietly(() => initCmd()), /predates/);
  });
});

test('setup --team prints the branch-protection recommendations', () => {
  const setup = fs.readFileSync(path.join(ROOT, 'setup'), 'utf8');
  assert.match(setup, /cat "\$HERE\/templates\/branch-protection\.md"/);
  const bp = fs.readFileSync(path.join(ROOT, 'templates', 'branch-protection.md'), 'utf8');
  for (const s of ['Dismiss stale pull request approvals', 'most recent reviewable push', 'Require conversation resolution',
    'Allow GitHub Actions to create and approve pull requests', 'Require review from Code Owners']) assert.ok(bp.includes(s), s);
});

test('the CODEOWNERS snippet covers every default sensitive path', () => {
  const bp = fs.readFileSync(path.join(ROOT, 'templates', 'branch-protection.md'), 'utf8');
  const block = bp.split('```')[1];
  const lines = block.split('\n').filter((l) => l.includes('@<owners>'));
  assert.equal(lines.length, DEFAULT_SENSITIVE.length, 'one CODEOWNERS line per default sensitive pattern');
});

test('docs/REVIEW_LAYERS.md maps all seven layers', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'REVIEW_LAYERS.md'), 'utf8');
  const rows = doc.split('\n').filter((l) => /^\| [1-7] \|/.test(l));
  assert.deepEqual(rows.map((r) => r.slice(2, 3)), ['1', '2', '3', '4', '5', '6', '7']);
});
