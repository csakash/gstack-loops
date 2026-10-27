// The owner's daily workflow is /gloop-spec → /gloop-build → /gloop-ship (SPEC.md, "P1 plan >
// Workflow contract"). These tests pin what must not change: the three commands exist under
// those names, each keeps its job, each hands off to the next, build and ship never add a
// question for the user, and every gloop command they call exists.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SKILLS = path.join(__dirname, '..', 'skills');
const read = (name) => fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8');
const body = (name) => read(name).replace(/^---\n[\s\S]*?\n---\n/, '');

test('the three workflow commands exist under their names', () => {
  for (const name of ['gloop-spec', 'gloop-build', 'gloop-ship']) {
    assert.match(read(name), new RegExp(`^---\\nname: ${name}\\n`), `${name} frontmatter name`);
  }
});

test('/gloop-spec: runs the /spec interview, commits SPEC.md, hands off to /gloop-build', () => {
  const s = body('gloop-spec');
  assert.match(s, /`\/spec`/);
  assert.match(s, /git add SPEC\.md && git commit/);
  assert.match(s, /`\/gloop-build`/);
});

test('/gloop-build: needs SPEC.md, never pushes, hands off to /gloop-ship', () => {
  const s = body('gloop-build');
  assert.match(s, /SPEC\.md` exists on the branch/);
  assert.match(s, /run\s+`\/gloop-spec`/);
  assert.match(s, /Do \*\*not\*\* push/);
  assert.match(s, /ready to ship — run `\/gloop-ship`/);
  assert.match(s, /Never ship red/);
});

test('/gloop-ship: raises the PR with /ship, stops servers, flags sensitive paths without blocking', () => {
  const s = body('gloop-ship');
  assert.match(s, /gstack \*\*`\/ship`\*\*/);
  assert.match(s, /gloop stop <slug>/);
  assert.match(s, /gloop risk/);
  assert.match(s, /\*\*Do not stop or ask\*\*/);
});

test('/gloop-build and /gloop-ship add no new question for the user', () => {
  for (const name of ['gloop-build', 'gloop-ship']) {
    assert.doesNotMatch(body(name), /ask the user|confirm with the user|wait for (the )?user|asks? for (explicit )?confirmation/i, name);
  }
});

test('every gloop subcommand the workflow skills call is a real CLI command', () => {
  const cli = fs.readFileSync(path.join(__dirname, '..', 'bin', 'gloop'), 'utf8');
  const known = [...cli.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]);
  for (const name of ['gloop-spec', 'gloop-build', 'gloop-ship']) {
    for (const [, sub] of body(name).matchAll(/`gloop ([a-z]+)/g)) {
      assert.ok(known.includes(sub), `${name} calls "gloop ${sub}", which bin/gloop does not handle`);
    }
  }
});

test('the /gloop router still walks spec → build → ship', () => {
  const s = body('gloop');
  assert.match(s, /\/gloop-spec/);
  assert.match(s, /\/gloop-build/);
  assert.match(s, /\/gloop-ship/);
});
