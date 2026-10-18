'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Model = require('../app/src/main/assets/model.js');
const seedPath = path.join(__dirname, '../app/src/main/assets/seed.json');
const fresh = () => JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));

test('真实70天种子覆盖教学周7—16，保留全部周参考合计', () => {
  const state = fresh();
  assert.equal(Model.validateState(state), true);
  const days = Model.dates(state.plan.startDate, state.plan.endDate);
  assert.equal(days.length, 70);
  assert.equal(days[0], '2026-10-12');
  assert.equal(days[69], '2026-12-20');
  assert.equal(Object.keys(state.plan.targets).length, 70);
  const stages = [
    [[40,20],[25,20],[60,20],[25,20],[40,20],[90,20],[60,20]],
    [[45,20],[30,20],[75,20],[30,20],[45,20],[90,25],[75,30]],
    [[50,25],[30,25],[75,25],[30,25],[50,25],[105,25],[90,25]],
    [[55,25],[35,25],[90,25],[35,25],[55,25],[105,25],[90,25]]
  ];
  days.forEach((date,index) => {
    const week = Math.floor(index / 7), stage = week < 2 ? 0 : week < 4 ? 1 : week < 7 ? 2 : 3;
    assert.equal(Model.target(state,date,'math'), stages[stage][index % 7][0], date + '高数');
    assert.equal(Model.target(state,date,'vocab'), stages[stage][index % 7][1], date + '单词');
  });
  const expected = [[340,140],[340,140],[390,155],[390,155],[430,175],[430,175],[430,175],[465,175],[465,175],[465,175]];
  expected.forEach(([math,vocab], index) => {
    const date = days[index * 7];
    const stats = Model.weekStats(state, date);
    assert.equal(stats.number, 7 + index);
    assert.equal(stats.parity, index % 2 ? '双周' : '单周');
    assert.equal(stats.subjects.find(s => s.id === 'math').reference, math);
    assert.equal(stats.subjects.find(s => s.id === 'vocab').reference, vocab);
    assert.equal(stats.subjects[0].actual, null);
    assert.equal(stats.recordedDays, 0);
    assert.equal(stats.entryDays, 0);
    assert.equal(stats.totalDays, 7);
  });
});

test('空模板不写入state、不借用参考分钟，也不共享引用', () => {
  const state = fresh(), before = JSON.stringify(state);
  const record = Model.record(state, '2026-10-13');
  assert.equal(record.subjects.math.minutes, null);
  assert.equal(record.subjects.vocab.newWords, null);
  assert.equal(record.status, null);
  assert.equal(record.restKept, null);
  record.subjects.math.minutes = 25;
  assert.equal(JSON.stringify(state), before);
  assert.equal(Model.record(state, '2026-10-13').subjects.math.minutes, null);
});

test('记录空白、休息和确认0各自保留语义', () => {
  const state = fresh();
  const rest = Model.record(state, '2026-10-12');
  rest.status = '休息';
  rest.restKept = true;
  Model.saveRecord(state, '2026-10-12', rest);
  let stats = Model.weekStats(state, '2026-10-13');
  assert.equal(stats.entryDays, 1);
  assert.equal(stats.recordedDays, 0);
  assert.equal(stats.subjects[0].actual, null);
  const zero = Model.record(state, '2026-10-13');
  zero.subjects.math.minutes = 0;
  zero.subjects.vocab.minutes = 0;
  zero.subjects.vocab.newWords = 0;
  Model.saveRecord(state, '2026-10-13', zero);
  zero.subjects.math.minutes = 999;
  assert.equal(state.records['2026-10-13'].subjects.math.minutes, 0);
  stats = Model.weekStats(state, '2026-10-13');
  assert.equal(stats.entryDays, 2);
  assert.equal(stats.recordedDays, 1);
  assert.equal(stats.subjects[0].actual, 0);
  assert.equal(stats.subjects[0].recordedDays, 1);
  assert.equal(state.records['2026-10-12'].subjects.vocab.minutes, null);
});

test('每科已记录天数分别汇总，计时分数分钟不截断', () => {
  const state = fresh();
  const first = Model.record(state, '2026-10-12');
  first.subjects.math.minutes = 61 / 60;
  Model.saveRecord(state, '2026-10-12', first);
  const second = Model.record(state, '2026-10-13');
  second.subjects.vocab.minutes = 20;
  Model.saveRecord(state, '2026-10-13', second);
  const stats = Model.weekStats(state, '2026-10-12');
  assert.equal(stats.recordedDays, 2);
  assert.equal(stats.subjects.find(s => s.id === 'math').actual, 61 / 60);
  assert.equal(stats.subjects.find(s => s.id === 'math').recordedDays, 1);
  assert.equal(stats.subjects.find(s => s.id === 'vocab').actual, 20);
  assert.equal(stats.subjects.find(s => s.id === 'vocab').recordedDays, 1);
});

test('休息边界按本地时间精准检查，补记真实历史不受时间限制', () => {
  const at = (day, hour, minute) => new Date(2026, 9, day, hour, minute, 0);
  assert.equal(Model.allowed(at(13,20,29)), true);
  assert.equal(Model.allowed(at(13,20,30)), false);
  assert.equal(Model.allowed(at(13,23,59)), false);
  assert.equal(Model.allowed(at(17,9,29)), false);
  assert.equal(Model.allowed(at(17,9,30)), true);
  assert.equal(Model.allowed(at(17,18,59)), true);
  assert.equal(Model.allowed(at(17,19,0)), false);
  assert.equal(Model.allowed(at(18,9,30)), true);
  assert.equal(Model.today(at(13,23,59)), '2026-10-13');
  const state = fresh(), record = Model.record(state, '2026-10-12');
  record.subjects.math.minutes = 15;
  record.restKept = false;
  Model.saveRecord(state, '2026-10-12', record);
  assert.equal(state.records['2026-10-12'].restKept, false);
});

test('改日期范围保留范围外历史、原参考量与复盘', () => {
  const state = fresh(), originalTargets = clone(state.plan.targets);
  const record = Model.record(state, '2026-10-12');
  record.subjects.math.minutes = 40;
  Model.saveRecord(state, '2026-10-12', record);
  state.reviews['2026-10-12'] = {load:'适中',mathProblem:'极限',vocabReview:'继续',adjustment:'减量',reason:'课程多',halfDayRest:true};
  Model.resizePlan(state, '2026-11-01', '2027-01-03', 10);
  assert.equal(state.records['2026-10-12'].subjects.math.minutes, 40);
  assert.equal(state.plan.targets['2026-10-12'].math, originalTargets['2026-10-12'].math);
  assert.equal(state.plan.targets['2026-11-02'].math, originalTargets['2026-11-02'].math);
  assert.equal(state.reviews['2026-10-12'].halfDayRest, true);
  assert.equal(state.plan.targets['2026-12-21'].math, state.plan.subjects.find(s => s.id === 'math').defaults[0]);
  assert.equal(Model.weekInfo(state.plan, '2026-11-01').number, 10);
  assert.equal(Model.weekInfo(state.plan, '2026-11-07').key, '2026-11-01');
  assert.equal(Model.weekInfo(state.plan, '2026-11-08').number, 11);
  assert.equal(Model.validateState(state), true);
});

test('新增科目填当前范围参考，已有记录保留空值，新defaults不覆写已排参考', () => {
  const state = fresh(), existing = Model.record(state, '2026-10-12');
  existing.subjects.math.minutes = 30;
  Model.saveRecord(state, '2026-10-12', existing);
  const added = Model.addSubject(state, ' 阅读 ', [10,20,30,40,50,60,70]);
  assert.equal(added.name, '阅读');
  assert.equal(added.kind, 'custom');
  assert.equal(Model.target(state, '2026-10-12', added.id), 10);
  assert.equal(Model.target(state, '2026-10-18', added.id), 70);
  assert.equal(Model.record(state, '2026-10-12').subjects[added.id].minutes, null);
  assert.equal(state.records['2026-10-12'].subjects.math.minutes, 30);
  assert.equal(Object.hasOwn(state.records['2026-10-12'].subjects, added.id), false);
  Model.updateSubject(state, added.id, '读书', [1,2,3,4,5,6,7]);
  assert.equal(Model.target(state, '2026-10-12', added.id), 10);
  Model.resizePlan(state, state.plan.startDate, '2026-12-27', 7);
  assert.equal(Model.target(state, '2026-12-21', added.id), 1);
  assert.equal(Model.target(state, '2026-12-27', added.id), 7);
  added.defaults[0] = 999;
  assert.equal(state.plan.subjects.find(s => s.id === added.id).defaults[0], 1);
});

test('部分末周统计只含计划内日期，日期计算不受夏令时影响', () => {
  const state = fresh();
  Model.resizePlan(state, '2026-03-07', '2026-03-16', 1);
  assert.equal(Model.dates('2026-03-07', '2026-03-16').length, 10);
  const stats = Model.weekStats(state, '2026-03-16');
  assert.equal(stats.key, '2026-03-14');
  assert.equal(stats.totalDays, 3);
  assert.deepEqual(stats.days, ['2026-03-14','2026-03-15','2026-03-16']);
});

test('计时sessions与手动编辑共存，保存不丢失原始sessions', () => {
  const state = fresh();
  state.sessions = [{id:'timer-1',date:'2026-10-13',subjectId:'math',seconds:61,endedAt:'2026-10-13T11:15:00.123Z'}];
  assert.equal(Model.validateState(state), true);
  const record = Model.record(state, '2026-10-13');
  record.subjects.math.minutes = 61 / 60;
  Model.saveRecord(state, '2026-10-13', record);
  assert.equal(state.sessions[0].seconds, 61);
  const bad = clone(state);
  bad.sessions.push(clone(bad.sessions[0]));
  assert.throws(() => Model.validateState(bad), /重复/);
});

test('提醒配置和备份导入始终遵守休息边界，包括开关关闭时', () => {
  for (const enabled of [false,true]) {
    for (const [field,value] of [['weekdayTime','20:30'],['weekdayTime','23:59'],['weekendTime','09:29'],['weekendTime','19:00']]) {
      const state = fresh();
      state.settings.reminders.enabled = enabled;
      state.settings.reminders[field] = value;
      assert.throws(() => Model.validateState(state), /提醒须/);
    }
    const state = fresh();
    state.settings.reminders.enabled = enabled;
    state.settings.reminders.weekdayTime = '20:29';
    state.settings.reminders.weekendTime = '09:30';
    assert.equal(Model.validateState(state), true);
    state.settings.reminders.weekendTime = '18:59';
    assert.equal(Model.validateState(state), true);
  }
});

test('无效输入在写入前失败，不破坏状态', () => {
  const state = fresh(), before = JSON.stringify(state);
  assert.throws(() => Model.resizePlan(state, '2026-02-30', '2026-12-20', 7));
  assert.throws(() => Model.resizePlan(state, '2026-10-12', '2028-10-12', 7), /730/);
  assert.throws(() => Model.addSubject(state, ' ', [0,0,0,0,0,0,0]));
  assert.throws(() => Model.updateSubject(state, 'math', '高数', [1,2]));
  const invalid = Model.record(state, '2026-10-13');
  invalid.subjects.math.minutes = 1441;
  assert.throws(() => Model.saveRecord(state, '2026-10-13', invalid));
  assert.equal(JSON.stringify(state), before);
});

test('严格备份校验拒绝版本、非法日期、范围、类型、未知字段和污染字段', () => {
  const mutations = [
    s => { s.version = 4; },
    s => { s._revision = -1; },
    s => { s._revision = 1.5; },
    s => { s.plan.startDate = '2026-02-30'; },
    s => { s.plan.endDate = '2025-10-12'; },
    s => { s.plan.startWeek = 0; },
    s => { s.plan.subjects[0].defaults[0] = -1; },
    s => { s.plan.subjects[0].defaults[0] = Infinity; },
    s => { s.plan.subjects[1].id = s.plan.subjects[0].id; },
    s => { s.plan.subjects[1].id = 'constructor'; },
    s => { s.plan.targets['2026-10-12'].absent = 1; },
    s => { s.plan.targets['2026-10-12'].math = '40'; },
    s => { s.settings.reminders.enabled = 'false'; },
    s => { s.settings.reminders.weekdayTime = '24:00'; },
    s => { s.unknown = true; },
    s => { s.plan.subjects[0].color = 'black'; },
    s => { s.records['2026-10-12'] = Model.record(s, '2026-10-12'); s.records['2026-10-12'].subjects.vocab.newWords = 1.5; },
    s => { s.records['2026-10-12'] = Model.record(s, '2026-10-12'); s.records['2026-10-12'].subjects.math.minutes = undefined; },
    s => { Object.defineProperty(s.records, '__proto__', {value:{},enumerable:true}); }
  ];
  mutations.forEach((mutate, index) => {
    const state = fresh();
    mutate(state);
    assert.throws(() => Model.validateState(state), undefined, 'mutation ' + index);
  });
  assert.equal(Model.dates('2024-02-29', '2024-02-29').length, 1);
  assert.throws(() => Model.dates('2023-02-29','2023-03-01'));
  assert.throws(() => Model.dates('1899-12-31','1900-01-01'));
  assert.throws(() => Model.allowed(new Date('invalid')));
});
