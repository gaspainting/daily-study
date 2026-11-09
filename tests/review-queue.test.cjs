const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const M = require('../app/src/main/assets/model.js');
const Q = require('../app/src/main/assets/review-queue.js');
const fresh = () => M.migrateState(JSON.parse(fs.readFileSync('app/src/main/assets/seed.json', 'utf8')));
const at = n => `2026-11-09T00:0${n}:00.000Z`;

test('record problems become traceable review items without changing learning observations', () => {
  const state = fresh();
  const before = JSON.stringify(state.records);
  const result = Q.addFromRecord(state, '2026-11-09', 'math', '链式求导漏乘内层导数', at(1));
  assert.equal(result.created, true);
  assert.equal(result.item.source.kind, 'record_problem');
  assert.equal(result.item.source.recordDate, '2026-11-09');
  assert.equal(JSON.stringify(state.records), before);
  M.validateState(state);
});

test('identical source problems deduplicate while different problems remain separate', () => {
  const state = fresh();
  const first = Q.addFromRecord(state, '2026-11-09', 'math', '同一问题', at(1));
  const duplicate = Q.addFromRecord(state, '2026-11-09', 'math', '同一问题', at(2));
  const second = Q.addFromRecord(state, '2026-11-09', 'math', '另一个问题', at(3));
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.item.id, first.item.id);
  assert.notEqual(second.item.id, first.item.id);
  assert.equal(Q.all(state).length, 2);
});

test('review events, pause and resume retain explicit status and due dates', () => {
  const state = fresh();
  const item = Q.create(state, { prompt: '回顾问题', nextDate: '2026-11-09', source: { kind: 'manual', date: '2026-11-09', subjectId: null, recordDate: null } }, at(1)).item;
  assert.equal(Q.due(state, '2026-11-09').length, 1);
  Q.recordEvent(state, item.id, { feedback: 'prompted', nextDate: '2026-11-12', note: '看例题后想起' }, at(2));
  assert.equal(Q.due(state, '2026-11-10').length, 0);
  Q.pause(state, item.id, at(3));
  assert.equal(Q.counts(state, '2026-11-20').paused, 1);
  Q.resume(state, item.id, at(4));
  assert.equal(Q.due(state, '2026-11-20').length, 1);
  Q.recordEvent(state, item.id, { feedback: 'independent', nextDate: null, note: '' }, at(5));
  assert.equal(Q.counts(state, '2026-11-20').ended, 1);
  M.validateState(state);
});

test('invalid review source and feedback fail before malformed queue is accepted', () => {
  const state = fresh();
  assert.throws(() => Q.create(state, { prompt: '问题', nextDate: '2026-11-09', source: { kind: 'manual', date: '2026-11-09', subjectId: 'unknown', recordDate: null } }, at(1)));
  assert.throws(() => Q.create(state, { prompt: '问题', nextDate: '2026-11-09', source: { kind: 'manual', date: '2026-11-09', subjectId: null, recordDate: null } }, at(1)).item && Q.recordEvent(state, Q.all(state)[0].id, { feedback: 'wrong', nextDate: null }, at(2)));
});
