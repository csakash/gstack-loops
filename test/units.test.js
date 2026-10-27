// Unit tests for the deterministic pieces: ports, env templating, env file edits.
const test = require('node:test');
const assert = require('node:assert');
const { nextSlot, portsForSlot } = require('../lib/ports');
const { resolveValue, resolveEnvMap, applyEnv } = require('../lib/env-template');

test('nextSlot: first slot is 1', () => {
  assert.equal(nextSlot({ loops: {} }), 1);
});

test('nextSlot: fills the lowest free slot', () => {
  assert.equal(nextSlot({ loops: { a: { slot: 1 }, b: { slot: 3 } } }), 2);
  assert.equal(nextSlot({ loops: { a: { slot: 1 }, b: { slot: 2 } } }), 3);
});

test('portsForSlot: base + slot*stride for every repo', () => {
  const cfg = { portStride: 100, repos: [{ name: 'be', basePort: 4000 }, { name: 'fe', basePort: 5173 }] };
  assert.deepEqual(portsForSlot(cfg, 1), { be: 4100, fe: 5273 });
  assert.deepEqual(portsForSlot(cfg, 2), { be: 4200, fe: 5373 });
});

test('resolveValue: self port, cross-repo port/url/host', () => {
  const ctx = { selfPort: 4100, portsByRepo: { backend: 4100, frontend: 5273 } };
  assert.equal(resolveValue('{{port}}', ctx), '4100');
  assert.equal(resolveValue('{{port:frontend}}', ctx), '5273');
  assert.equal(resolveValue('{{url:backend}}', ctx), 'http://localhost:4100');
  assert.equal(resolveValue('{{host:frontend}}', ctx), 'localhost:5273');
});

test('resolveValue: unknown repo ref throws', () => {
  assert.throws(() => resolveValue('{{url:nope}}', { portsByRepo: { backend: 4100 } }), /unknown repo "nope"/);
});

test('resolveEnvMap: resolves every value', () => {
  const out = resolveEnvMap({ PORT: '{{port}}', API: '{{url:backend}}' }, { selfPort: 5273, portsByRepo: { backend: 4100 } });
  assert.deepEqual(out, { PORT: '5273', API: 'http://localhost:4100' });
});

test('applyEnv: replaces existing key, appends new', () => {
  const start = 'PORT=4000\nSECRET=abc\n';
  const next = applyEnv(start, { PORT: '4100', VITE_API_URL: 'http://localhost:4100' });
  assert.match(next, /^PORT=4100$/m);
  assert.match(next, /^SECRET=abc$/m);
  assert.match(next, /^VITE_API_URL=http:\/\/localhost:4100$/m);
  assert.equal((next.match(/^PORT=/gm) || []).length, 1); // no duplicate
});

test('applyEnv: appended keys follow the last line without a blank gap', () => {
  assert.equal(applyEnv('A=1\nB=2\n\n', { C: '3' }), 'A=1\nB=2\nC=3\n');
});
