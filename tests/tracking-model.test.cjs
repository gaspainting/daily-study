'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Model = require('../app/src/main/assets/model.js');
const Tracking = require('../app/src/main/assets/tracking.js');
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '../app/src/main/assets/seed.json'), 'utf8'));
const copy = value => JSON.parse(JSON.stringify(value));
const fresh = () => Model.migrateState(copy(seed));
function record(state, date, math, vocab, note = '') {
  const value = Model.record(state, date);
  value.subjects.math.minutes = math;
  value.subjects.vocab.minutes = vocab;
  value.note = note;
  Model.saveRecord(state, date, value);
  return value;
}

test('schema 1 migrates without mutating original null/zero/status/rest/session values', () => {
  const legacy = copy(seed);
  record(legacy, '2026-10-12', null, 0, '原始随记');
  legacy.records['2026-10-12'].status = '休息';
  legacy.records['2026-10-12'].restKept = false;
  legacy.reviews['2026-10-12'] = { load: '适中', mathProblem: '极限', vocabReview: '易忘词', adjustment: '减量', reason: '课程', halfDayRest: null };
  legacy.sessions = [{ id: 'one', date: '2026-10-12', subjectId: 'math', seconds: 61, endedAt: '2026-10-12T10:00:00Z' }];
  const before = JSON.stringify(legacy), state = Model.migrateState(legacy);
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(state.version, 2);
  assert.deepEqual(state.records, legacy.records);
  assert.deepEqual(state.sessions, legacy.sessions);
  assert.deepEqual(state.reviews['2026-10-12'].subjects, { math: '极限', vocab: '易忘词' });
  assert.equal(state.reviews['2026-10-12'].mathProblem, '极限');
  assert.equal(state.reviews['2026-10-12'].halfDayRest, null);
  assert.deepEqual(Model.migrateState(state), state);
});

test('archive keeps IDs and history, ends at date, restoring keeps inactive gap', () => {
  const state = fresh();
  record(state, '2026-10-12', 20, 0);
  const before = copy(state.records);
  Model.archiveSubject(state, 'math', '2026-10-14');
  assert.equal(Model.subjectActive(state.plan.subjects.find(s=>s.id==='math'), '2026-10-13'), true);
  assert.equal(Model.subjectActive(state.plan.subjects.find(s=>s.id==='math'), '2026-10-14'), false);
  assert.deepEqual(Model.subjectsForDate(state, '2026-10-14').map(item => item.id), ['vocab']);
  assert.equal(Model.record(state, '2026-10-14').subjects.math.minutes, null);
  assert.deepEqual(state.records, before);
  Model.restoreSubject(state, 'math', '2026-10-17');
  assert.equal(Model.subjectActive(state.plan.subjects.find(s=>s.id==='math'), '2026-10-16'), false);
  assert.equal(Model.subjectActive(state.plan.subjects.find(s=>s.id==='math'), '2026-10-17'), true);
  assert.deepEqual(state.plan.subjects.find(s=>s.id==='math').activePeriods, [{ from: '1900-01-01', to: '2026-10-14' }, { from: '2026-10-17', to: null }]);
  assert.equal(Model.validateState(state), true);
});

test('archiving on an existing recorded day keeps actual totals and historical denominators', () => {
  const state = fresh();
  record(state, '2026-10-14', 30, null);
  Model.archiveSubject(state, 'math', '2026-10-14');
  const stats = Model.weekStats(state, '2026-10-14').subjects.find(item => item.id === 'math');
  assert.equal(stats.actual, 30);
  assert.equal(stats.recordedDays, 1);
  assert.equal(stats.totalDays, 3);
  assert.equal(stats.reference, Model.target(state, '2026-10-12', 'math') + Model.target(state, '2026-10-13', 'math'));
  const summary = Model.recordSummary(state, '2026-10-14');
  assert.equal(summary.recordedSubjects, 1);
  assert.equal(summary.totalSubjects, 2);
});

test('subject reordering preserves all actual/reference totals and maps', () => {
  const state = fresh();
  record(state, '2026-10-12', 12, 0);
  const before = Model.weekStats(state, '2026-10-12'), records = copy(state.records), targets = copy(state.plan.targets);
  Model.moveSubject(state, 'vocab', 'up');
  assert.deepEqual(state.plan.subjects.filter(item=>item.id!=='course-review').map(item => item.id), ['vocab', 'math']);
  const after = Model.weekStats(state, '2026-10-12');
  assert.deepEqual(after.subjects.slice().sort((a, b) => a.id.localeCompare(b.id)), before.subjects.slice().sort((a, b) => a.id.localeCompare(b.id)));
  assert.deepEqual(state.records, records);
  assert.deepEqual(state.plan.targets, targets);
});

test('new subjects can start today without backfilling historical denominators', () => {
  const state = fresh();
  const item = Model.addSubject(state, '物理', [10, 10, 10, 10, 10, 10, 10], '2026-10-14');
  assert.equal(Model.subjectActive(item, '2026-10-13'), false);
  assert.equal(Model.subjectActive(item, '2026-10-14'), true);
  const stats = Model.weekStats(state, '2026-10-14').subjects.find(subject => subject.id === item.id);
  assert.equal(stats.totalDays, 5);
  assert.equal(stats.reference, 50);
  const before = JSON.stringify(state);
  assert.throws(() => Model.addSubject(state, '化学', [0,0,0,0,0,0,0], '2026-02-30'));
  assert.equal(JSON.stringify(state), before);
});

test('history search includes records beyond current plan and distinguishes partial zero from complete zero', () => {
  const state = fresh();
  record(state, '2026-09-01', 0, null, '链式求导');
  record(state, '2026-10-12', 0, 0);
  record(state, '2026-10-13', null, null, '天气');
  record(state, '2026-10-14', 20, 10);
  assert.equal(Model.historySearch(state).length, 4);
  assert.deepEqual(Model.historySearch(state, { recordKind: 'partial' }).map(item => item.date), ['2026-09-01']);
  assert.deepEqual(Model.historySearch(state, { recordKind: 'zero' }).map(item => item.date), ['2026-10-12']);
  assert.deepEqual(Model.historySearch(state, { recordKind: 'note', keyword: '天气' }).map(item => item.date), ['2026-10-13']);
  assert.deepEqual(Model.historySearch(state, { subjectId: 'math', to: '2026-09-30', keyword: '链式' }).map(item => item.date), ['2026-09-01']);
  assert.deepEqual(Model.historySearch(state, { subjectId: 'vocab', to: '2026-09-30' }), []);
  assert.throws(() => Model.historySearch(state, { from: '2026-10-14', to: '2026-10-12' }), /开始日期/);
});

test('month counts explicit zero as a time entry and note-only as an entry without invented minutes', () => {
  const state = fresh();
  record(state, '2026-10-12', 0, null);
  record(state, '2026-10-13', null, null, '仅随记');
  let stats = Model.monthStats(state, '2026-10');
  assert.equal(stats.actual, 0);
  assert.equal(stats.entryDays, 2);
  assert.equal(stats.recordedDays, 1);
  assert.equal(stats.totalDays, 31);
  assert.equal(stats.subjects.find(item => item.id === 'vocab').actual, null);
  assert.equal(Model.monthStats(fresh(), '2026-10').actual, null);
  assert.equal(Model.monthStats(fresh(), '2024-02').days.length, 29);
  assert.throws(() => Model.monthStats(state, '2026-13'));
});

test('custom subject review map retains legacy aliases and rejects unknown IDs', () => {
  const state = fresh(), item = Model.addSubject(state, '物理');
  state.reviews['2026-10-12'] = { load: '', mathProblem: '旧高数', vocabReview: '旧词汇', adjustment: '', reason: '', halfDayRest: false, subjects: { math: '新高数', [item.id]: '干涉' } };
  const migrated = Model.migrateState(state);
  assert.equal(migrated.reviews['2026-10-12'].subjects.math, '新高数');
  assert.equal(migrated.reviews['2026-10-12'].subjects.vocab, '旧词汇');
  assert.equal(migrated.reviews['2026-10-12'].mathProblem, '旧高数');
  migrated.reviews['2026-10-12'].subjects.absent = '未知';
  assert.throws(() => Model.validateState(migrated), /复盘科目不存在/);
});

test('session detail merges legacy per-record sessions without duplicating global IDs and exposes only actual fields', () => {
  const state = fresh(), first = { id: 'session-1', date: '2026-10-12', subjectId: 'math', seconds: 61, endedAt: '2026-10-12T10:00:00Z' };
  state.sessions = [first];
  record(state, '2026-10-12', 1, null).sessions = [copy(first), { id: 'session-2', date: '2026-10-12', subjectId: 'vocab', seconds: 90, endedAt: '2026-10-12T11:00:00Z' }];
  state.records['2026-10-12'].sessions = [copy(first), { id: 'session-2', date: '2026-10-12', subjectId: 'vocab', seconds: 90, endedAt: '2026-10-12T11:00:00Z' }];
  assert.deepEqual(Model.sessionSearch(state).map(item => item.id), ['session-2', 'session-1']);
  assert.equal(Model.sessionSearch(state, { subjectId: 'math' })[0].seconds, 61);
  assert.equal(Object.hasOwn(Model.sessionSearch(state)[0], 'startedAt'), false);
});

test('sessions sort by actual instant across timezone offsets', () => {
  const state = fresh();
  state.sessions = [{id:'later',date:'2026-10-12',subjectId:'math',seconds:10,endedAt:'2026-10-12T10:00:00Z'}, {id:'earlier',date:'2026-10-12',subjectId:'math',seconds:10,endedAt:'2026-10-12T11:00:00+08:00'}];
  assert.deepEqual(Model.sessionSearch(state).map(item => item.id), ['later', 'earlier']);
});

test('active periods reject overlaps, open periods followed by periods and legacy unknown additions', () => {
  for (const periods of [[{ from: '2026-10-12', to: '2026-10-12' }], [{ from: '2026-10-12', to: '2026-10-16' }, { from: '2026-10-14', to: null }], [{ from: '2026-10-12', to: null }, { from: '2026-10-17', to: null }]]) {
    const state = fresh(); state.plan.subjects[0].activePeriods = periods;
    assert.throws(() => Model.validateState(state), /时段/);
  }
  const legacy = copy(seed); legacy.plan.subjects[0].activePeriods = [];
  assert.throws(() => Model.validateState(legacy), /未知字段/);
  const inactive = fresh(); inactive.plan.subjects.find(s=>s.id==='math').activePeriods = [];
  assert.equal(Model.subjectActive(inactive.plan.subjects.find(s=>s.id==='math'), '2026-10-12'), false);
  Model.restoreSubject(inactive, 'math', '2026-10-14');
  assert.equal(Model.subjectActive(inactive.plan.subjects.find(s=>s.id==='math'), '2026-10-14'), true);
});

test('history/calendar/session HTML escapes content and carries visible accurate state and accessible date actions', () => {
  const state = fresh(); record(state, '2026-10-12', 0, null, '<img src=x onerror=alert(1)>');
  state.sessions = [{ id: 'one', date: '2026-10-12', subjectId: 'math', seconds: 61, endedAt: '2026-10-12T10:00:00Z' }];
  const history = Tracking.renderHistory(state, {}), month = Tracking.renderMonth(state, '2026-10'), sessions = Tracking.renderSessions(state, {});
  assert.match(history, /0 分钟 · 1\/2 科目已记录/);
  assert.doesNotMatch(history, /<img src=x/);
  assert.match(history, /&lt;img/);
  assert.match(month, /aria-label="2026-10-12，0 分钟 · 1\/2 科目已记录"/);
  assert.equal((month.match(/class="month-day/g) || []).length, 31);
  assert.match(sessions, /1 分钟 1 秒/);
  assert.match(sessions, /结束于/);
  assert.doesNotMatch(sessions, /开始于/);
  assert.doesNotMatch(history + month + sessions, /不需要|也可以休息|本地保存|不自动|无需/);
});
