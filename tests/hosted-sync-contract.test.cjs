const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const C = require('../app/src/main/assets/hosted-sync-contract.js');
const fixture = name => JSON.parse(fs.readFileSync(`contracts/fixtures/${name}`, 'utf8'));

const operation = extra => C.operation(Object.assign({
  workspaceId: 'workspace_demo',
  deviceId: 'device_demo',
  clientInstanceId: 'instance_demo',
  operationId: 'operation_demo_001',
  entityType: 'record',
  entityId: C.stableId('record', 'main', '2026-11-10'),
  command: 'upsert_record',
  baseServerRevision: 4,
  occurredAtUtc: '2026-11-10T08:00:00Z',
  businessTimeZone: 'Asia/Shanghai',
  payload: { date: '2026-11-10', subjects: {} }
}, extra));

test('hosted operations use stable IDs and an immutable dedupe key', () => {
  const value = C.operation(fixture('hosted-valid-operation.json'));
  assert.equal(value.protocolVersion, 1);
  assert.equal(value.schemaVersion, 9);
  assert.equal(C.dedupeKey(value), 'instance_demo|operation_demo_001');
  assert.equal(C.stableId('task', 'main', 'task_1'), 'task:main:task_1');
});

test('unsupported commands, fields and protocol versions are rejected', () => {
  assert.throws(() => C.operation(fixture('hosted-unsupported-command.json')));
  assert.throws(() => operation({ extra: true }));
  assert.throws(() => operation({ schemaVersion: 8 }));
});

test('conflicts compare service revisions, never device timestamps', () => {
  const value = C.operation(fixture('hosted-valid-operation.json'));
  assert.deepEqual(C.compareConflict(4, value), { kind: 'apply' });
  const conflict = C.operation(fixture('hosted-conflict-operation.json'));
  assert.deepEqual(C.compareConflict(9, conflict), { kind: 'conflict', baseServerRevision: 3, currentServerRevision: 9, entityId: conflict.entityId });
});

test('state labels reject unknown success claims', () => {
  for (const state of C.statuses) assert.equal(C.status(state), state);
  assert.throws(() => C.status('synced'));
});

test('settings no longer exposes the retired LAN pairing form', () => {
  const source = fs.readFileSync('app/src/main/assets/app.js', 'utf8');
  assert.doesNotMatch(source, /sync-address|sync-port|sync-fingerprint|beginSyncPairing|saveSyncPairing/);
  assert.match(source, /拾遗托管同步/);
});
