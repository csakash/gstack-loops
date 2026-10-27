// The interactive path (/gloop-build) and the headless driver must follow the same rules.
// lib/rules.js is the single source; this fails if either copy drifts from it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { RULES } = require('../lib/rules');
const driver = require('../lib/driver');

const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'gloop-build', 'SKILL.md'), 'utf8');
const p = { slug: 'x', branch: 'feat/x', runDir: '/run', fixCycles: 2, qaUrls: '', repoNames: ['svc'] };
const authorPrompts = {
  build: driver.prompts.build(p),
  fix: driver.prompts.fix(p, { cycle: 1, open: ['r1-01'], findingsFile: 'f', allFile: 'a', resolutionsFile: 'r' }),
  secfix: driver.prompts.fix(p, { cycle: 1, open: ['s1-01'], findingsFile: 'f', allFile: 'a', resolutionsFile: 'r', kind: 'security' }),
  qa: driver.prompts.qa(p),
  ship: driver.prompts.ship(p, { touched: ['svc'] }),
};

test('there are rules, and each is one sentence-sized line', () => {
  assert.ok(RULES.length >= 5);
  for (const r of RULES) assert.ok(!r.includes('\n') && r.endsWith('.'), r);
});

for (const [i, rule] of RULES.entries()) {
  test(`rule ${i + 1} is in /gloop-build verbatim`, () => {
    assert.ok(skill.includes(`- ${rule}`), `skills/gloop-build/SKILL.md is missing:\n  ${rule}`);
  });
  test(`rule ${i + 1} is in every headless author prompt verbatim`, () => {
    for (const [stage, prompt] of Object.entries(authorPrompts)) {
      assert.ok(prompt.includes(`- ${rule}`), `${stage} prompt is missing:\n  ${rule}`);
    }
  });
}

test('the skill lists no rule that lib/rules.js does not have', () => {
  const section = skill.split('## Rules')[1].split('\n## ')[0];
  const listed = section.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
  assert.deepEqual(listed, RULES);
});
