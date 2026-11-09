const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const C = require('../app/src/main/assets/sync-contract.js');
const fixture = name => JSON.parse(fs.readFileSync(`contracts/fixtures/${name}`, 'utf8'));

test('stable IDs and versioned envelopes are deterministic', () => {
  assert.equal(C.stableId('record', 'main', '2026-11-09'), 'record:main:2026-11-09');
  const value = C.envelope(fixture('valid-envelope.json'));
  assert.equal(C.dedupeKey(value), 'evt_20261109_0001|mutation_demo_001');
  assert.deepEqual(C.compareConflict(4, value), { kind: 'apply' });
});

test('duplicate events share a dedupe key and a changed base is an explicit conflict', () => {
  const first = C.envelope(fixture('valid-envelope.json'));
  const duplicate = C.envelope(fixture('duplicate-envelope.json'));
  assert.equal(C.dedupeKey(first), C.dedupeKey(duplicate));
  const conflict = C.envelope(fixture('conflict-envelope.json'));
  assert.deepEqual(C.compareConflict(9, conflict), { kind: 'conflict', baseRevision: 3, currentRevision: 9, entityId: 'task_demo_001' });
});

test('unknown protocol and malformed envelope are rejected before apply', () => {
  assert.throws(() => C.validate(fixture('unknown-protocol.json')));
  assert.throws(() => C.envelope({ protocolVersion: 1, schemaVersion: 1, eventId: 'x' }));
  assert.throws(() => C.stableId('file', 'main', 'x'));
});
