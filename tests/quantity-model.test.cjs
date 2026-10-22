'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../app/src/main/assets/model.js');
const Reference = require('../app/src/main/assets/reference.js');
const Tracking = require('../app/src/main/assets/tracking.js');
const seed = require('../app/src/main/assets/seed.json');

function fresh() { return Model.migrateState(structuredClone(seed), '2026-10-21'); }

test('数量科目保留单位、空值与显式零，并独立于分钟总量', () => {
  const state = fresh();
  const item = Model.addSubject(state, '刷题', [20, 20, 20, 20, 20, 50, 40], '2026-10-21', 'quantity', '题');
  const blank = Model.record(state, '2026-10-21');
  assert.equal(blank.subjects[item.id].quantity, null);
  blank.subjects[item.id].quantity = 0;
  blank.subjects[item.id].quantityUnit = '题';
  Model.saveRecord(state, '2026-10-21', blank);
  assert.equal(Model.recordSummary(state, '2026-10-21').quantities[0].quantity, 0);
  assert.equal(Model.recordSummary(state, '2026-10-21').total, null);
  assert.equal(Model.weekStats(state, '2026-10-21').subjects.find(s => s.id === item.id).actual, 0);
});

test('数量目标按日期覆盖，评估完成与超额，减量按半目标', () => {
  const state = fresh();
  const item = Model.addSubject(state, '阅读页', [50, 50, 50, 50, 50, 80, 60], '2026-10-21', 'quantity', '页');
  const day = '2026-10-21';
  state.plan.quantityTargets[day][item.id] = 40;
  let record = Model.record(state, day);
  record.status = '正常参考'; record.subjects[item.id].quantity = 40; record.subjects[item.id].quantityUnit = '页';
  Model.saveRecord(state, day, record);
  assert.equal(Reference.assess(state, day).quantities[0].kind, 'within');
  record = Model.record(state, day); record.subjects[item.id].quantity = 41; Model.saveRecord(state, day, record);
  assert.equal(Reference.assess(state, day).quantities[0].kind, 'above');
  record = Model.record(state, day); record.status = '减量'; record.subjects[item.id].quantity = 20; Model.saveRecord(state, day, record);
  assert.equal(Reference.assess(state, day).quantities[0].goal, 20);
  assert.equal(Reference.assess(state, day).quantities[0].kind, 'within');
});

test('数量记录保存当时的单位，修改科目单位不重解释历史记录', () => {
  const state = fresh();
  const item = Model.addSubject(state, '练习', [10, 10, 10, 10, 10, 10, 10], '2026-10-21', 'quantity', '题');
  const day = '2026-10-21';
  const record = Model.record(state, day); record.status = '正常参考'; record.subjects[item.id].quantity = 12; record.subjects[item.id].quantityUnit = '题'; Model.saveRecord(state, day, record);
  Model.updateSubject(state, item.id, '练习', [10, 10, 10, 10, 10, 10, 10], 'quantity', '组');
  assert.equal(state.records[day].subjects[item.id].quantityUnit, '题');
  const next = Model.record(state, '2026-10-22'); next.status = '正常参考'; next.subjects[item.id].quantity = 3; next.subjects[item.id].quantityUnit = '组'; Model.saveRecord(state, '2026-10-22', next);
  assert.equal(state.records['2026-10-22'].subjects[item.id].quantityUnit, '组');
  assert.match(Tracking.summaryText(Model.recordSummary(state, day)), /12 题/);
});

test('数量科目数据可通过严格状态校验并拒绝无单位或分钟目标混用', () => {
  const state = fresh();
  const item = Model.addSubject(state, '单元', [1, 1, 1, 1, 1, 1, 1], '2026-10-21', 'quantity', '组');
  assert.doesNotThrow(() => Model.validateState(state));
  const bad = structuredClone(state); bad.plan.subjects.find(s => s.id === item.id).unit = '';
  assert.throws(() => Model.validateState(bad));
  const mixed = structuredClone(state); mixed.plan.targets['2026-10-21'][item.id] = 4;
  assert.throws(() => Model.validateState(mixed));
});
