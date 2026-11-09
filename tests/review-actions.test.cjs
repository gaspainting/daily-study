const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const M = require('../app/src/main/assets/model.js');
const T = require('../app/src/main/assets/task-model.js');
const Q = require('../app/src/main/assets/review-queue.js');
const A = require('../app/src/main/assets/review-actions.js');
const fresh = () => M.migrateState(JSON.parse(fs.readFileSync('app/src/main/assets/seed.json', 'utf8')));
const at = n => `2026-11-09T00:0${n}:00.000Z`;

test('weekly action review generates a draft without changing tasks or reviews', () => {
  const state = fresh();
  const task = T.create(state.plan, { title: '本周未完成', scheduledDate: '2026-11-09' }, at(1));
  const review = Q.create(state, { prompt: '本周问题', nextDate: '2026-11-09', source: { kind: 'manual', date: '2026-11-09', subjectId: null, recordDate: null } }, at(1)).item;
  const before = JSON.stringify({ plan: state.plan, reviews: state.reviewQueue });
  const plan = A.generate(state, '2026-11-09', M.weekStats(state, '2026-11-09'), at(2));
  assert.equal(plan.status, 'draft');
  assert.ok(plan.actions.some(item => item.type === 'reschedule_task' && item.refId === task.id));
  assert.ok(plan.actions.some(item => item.type === 'schedule_review' && item.refId === review.id));
  assert.equal(JSON.stringify({ plan: state.plan, reviews: state.reviewQueue }), before);
  M.validateState(state);
});

test('confirming actions changes only the explicitly selected task or review', () => {
  const state = fresh();
  const task = T.create(state.plan, { title: '延期安排', scheduledDate: '2026-11-09' }, at(1));
  const plan = A.generate(state, '2026-11-09', M.weekStats(state, '2026-11-09'), at(2));
  const action = plan.actions.find(item => item.type === 'reschedule_task');
  assert.ok(action);
  A.confirm(state, '2026-11-09', action.id, at(3));
  assert.equal(T.find(state.plan, task.id).task.scheduledDate, '2026-11-16');
  assert.equal(A.get(state, '2026-11-09').actions.find(item => item.id === action.id).status, 'confirmed');
  M.validateState(state);
});

test('dismissed action remains historical and does not mutate its referenced entity', () => {
  const state = fresh();
  const task = T.create(state.plan, { title: '保留原安排', scheduledDate: '2026-11-09' }, at(1));
  const plan = A.generate(state, '2026-11-09', M.weekStats(state, '2026-11-09'), at(2));
  const action = plan.actions.find(item => item.type === 'reschedule_task');
  A.dismiss(state, '2026-11-09', action.id, at(3));
  assert.equal(T.find(state.plan, task.id).task.scheduledDate, '2026-11-09');
  assert.equal(A.get(state, '2026-11-09').actions.find(item => item.id === action.id).status, 'dismissed');
});
