// Every skills/<dir>/SKILL.md must have frontmatter whose `name` matches <dir> and a
// non-empty description. Guards against typos that stop a slash command from registering.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : null;
}

const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

test('there is at least the expected set of skills', () => {
  for (const expected of ['gloop', 'gloop-init', 'gloop-new', 'gloop-spec', 'gloop-build', 'gloop-run', 'gloop-ship', 'gloop-ls', 'gloop-drop', 'gloop-reap']) {
    assert.ok(dirs.includes(expected), `missing skill dir: ${expected}`);
  }
});

for (const dir of dirs) {
  test(`skill "${dir}" has valid frontmatter with matching name`, () => {
    const file = path.join(SKILLS_DIR, dir, 'SKILL.md');
    assert.ok(fs.existsSync(file), `${dir}/SKILL.md missing`);
    const fm = frontmatter(fs.readFileSync(file, 'utf8'));
    assert.ok(fm, `${dir}: no frontmatter block`);
    const name = (fm.match(/^name:\s*(\S+)/m) || [])[1];
    assert.equal(name, dir, `${dir}: frontmatter name "${name}" must equal dir`);
    assert.ok(/^description:\s*\S/m.test(fm) || /^description:\s*\|/m.test(fm), `${dir}: missing description`);
  });
}
