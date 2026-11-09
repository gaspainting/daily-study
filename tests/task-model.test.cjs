const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const M = require('../app/src/main/assets/model.js');
const T = require('../app/src/main/assets/task-model.js');

const fresh = () => M.migrateState(JSON.parse(fs.readFileSync('app/src/main/assets/seed.json', 'utf8')), '2026-11-09');
const at = n => `2026-11-09T00:0${n}:00.000Z`;

test('daily task records keep date, deadline, estimate and history separate from study records', () => {
  const state = fresh();
  const task = T.create(state.plan, { title: '整理错题', subjectId: 'math', scheduledDate: '2026-11-09', dueDate: '2026-11-12', estimateMinutes: 30 }, at(1));
  assert.deepEqual(T.forDate(state.plan, '2026-11-09').map(item => item.id), [task.id]);
  assert.equal(state.records['2026-11-09'], undefined);
  assert.equal(task.history[0].action, 'created');
  M.validateState(state);
});

test('reschedule keeps one task identity and records the original arrangement', () => {
  const state = fresh();
  const task = T.create(state.plan, { title: '推迟任务', scheduledDate: '2026-11-09', dueDate: '2026-11-10', estimateMinutes: null }, at(1));
  const moved = T.reschedule(state.plan, task.id, '2026-11-10', '2026-11-12', at(2), '本次时间不足');
  assert.equal(T.all(state.plan).filter(item => item.task.id === task.id).length, 1);
  assert.equal(moved.scheduledDate, '2026-11-10');
  assert.ok(moved.history.some(item => item.action === 'rescheduled' && item.fromDate === '2026-11-09' && item.toDate === '2026-11-10'));
  M.validateState(state);
});

test('completion, skip and reorder are explicit task operations', () => {
  const state = fresh();
  const first = T.create(state.plan, { title: '第一项', scheduledDate: '2026-11-09' }, at(1));
  const second = T.create(state.plan, { title: '第二项', scheduledDate: '2026-11-09' }, at(2));
  T.setStatus(state.plan, first.id, 'done', at(3), '已完成');
  T.setStatus(state.plan, second.id, 'skipped', at(4), '本次跳过');
  T.reorder(state.plan, '2026-11-09', [second.id, first.id]);
  assert.deepEqual(T.forDate(state.plan, '2026-11-09').map(item => item.id), [second.id, first.id]);
  assert.equal(T.counts(state.plan, '2026-11-09', '2026-11-09').done, 1);
  assert.equal(T.counts(state.plan, '2026-11-09', '2026-11-09').skipped, 1);
  M.validateState(state);
});

test('past planned tasks are exposed as a pending choice without being marked complete', () => {
  const state = fresh();
  const task = T.create(state.plan, { title: '未完成安排', scheduledDate: '2026-11-09' }, at(1));
  assert.equal(T.pending(state.plan, '2026-11-10').some(item => item.id === task.id), true);
  assert.equal(T.pending(state.plan, '2026-11-09').length, 0);
});
