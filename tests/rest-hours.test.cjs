'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Model = require('../app/src/main/assets/model.js');
const Tracking = require('../app/src/main/assets/tracking.js');

const seed = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../app/src/main/assets/seed.json'), 'utf8'));

test('migration adopts the new weekday default while preserving custom rest rules', () => {
  const migrated = Model.migrateState(seed());
  assert.equal(migrated.settings.restHours.weekdayEnd, '21:30');
  assert.equal(migrated.settings.restHours.weekdayEndSource, 'default');
  assert.equal(migrated.settings.reminderQuietHours.weekdayEnd, '21:30');
  assert.equal(migrated.settings.reminderQuietHours.weekdayEndSource, 'default');
  assert.equal(migrated.settings.startupRoute, 'today');
  const legacy = Model.migrateState(seed());
  legacy.settings.restHours = { weekdayEnd: '20:30', weekendStart: '09:30', weekendEnd: '19:00' };
  const upgraded = Model.migrateState(legacy);
  assert.equal(upgraded.settings.restHours.weekdayEnd, '21:30');
  const custom = seed();
  custom.settings.restHours = { weekdayEnd: '22:00', weekendStart: '08:30', weekendEnd: '18:00' };
  const kept = Model.migrateState(custom);
  assert.equal(kept.settings.restHours.weekdayEnd, '22:00');
  assert.equal(kept.settings.restHours.weekdayEndSource, 'user');
  assert.equal(kept.settings.reminderQuietHours.weekdayEnd, '22:00');
});

test('startup preference is validated as a schema 9 setting', () => {
  const state = Model.migrateState(seed());
  state.settings.startupRoute = 'last';
  assert.equal(Model.validate(state), true);
  state.settings.startupRoute = 'unknown';
  assert.throws(() => Model.validate(state), /启动页面设置无效/);
});

test('custom rest hours drive allowed checks and reminder validation', () => {
  const state = Model.migrateState(seed());
  state.settings.restHours = { weekdayEnd: '21:30', weekendStart: '08:00', weekendEnd: '17:00' };
  state.settings.reminderQuietHours = { weekdayEnd: '21:30', weekendStart: '08:00', weekendEnd: '17:00' };
  state.settings.reminders.weekdayTime = '21:00';
  state.settings.reminders.weekendTime = '16:30';
  Model.validate(state);
  assert.equal(Model.allowed(new Date('2026-10-14T21:29:00'), state), true);
  assert.equal(Model.allowed(new Date('2026-10-14T21:30:00'), state), false);
  assert.equal(Model.allowed(new Date('2026-10-18T07:59:00'), state), false);
  assert.equal(Model.allowed(new Date('2026-10-18T08:00:00'), state), true);
  assert.equal(Model.allowed(new Date('2026-10-18T17:00:00'), state), false);
});

test('timer and reminder quiet boundaries can be configured independently', () => {
  const state = Model.migrateState(seed());
  state.settings.restHours = { weekdayEnd: '22:00', weekendStart: '08:00', weekendEnd: '20:00', weekdayEndSource: 'user' };
  state.settings.reminderQuietHours = { weekdayEnd: '20:00', weekendStart: '10:00', weekendEnd: '18:00', weekdayEndSource: 'user' };
  state.settings.reminders.weekdayTime = '19:30';
  state.settings.reminders.weekendTime = '17:30';
  assert.equal(Model.allowed(new Date('2026-10-14T21:00:00'), state), true);
  assert.equal(Model.reminderAllowed(new Date('2026-10-14T21:00:00'), state), false);
  assert.equal(Model.reminderAllowed(new Date('2026-10-18T09:30:00'), state), false);
  assert.equal(Model.reminderAllowed(new Date('2026-10-18T17:30:00'), state), true);
  assert.equal(Model.validate(state), true);
});

test('rest hours reject an inverted weekend window and out-of-window reminder', () => {
  const state = Model.migrateState(seed());
  state.settings.restHours = { weekdayEnd: '21:30', weekendStart: '18:00', weekendEnd: '09:00' };
  assert.throws(() => Model.validate(state), /周末开始时间须早于结束时间/);
  state.settings.restHours = { weekdayEnd: '21:30', weekendStart: '09:30', weekendEnd: '19:00' };
  state.settings.reminders.weekdayTime = '21:30';
  assert.throws(() => Model.validate(state), /工作日提醒须早于21:30/);
});

test('mixed chart keeps unknown actuals out of the zero bar and exposes the line series', () => {
  const html = Tracking.renderMixedChart({
    days: ['2026-10-12', '2026-10-13', '2026-10-14'],
    values: [20, null, 0],
    references: [30, 30, 30],
    labels: ['周一', '周二', '周三'],
    ariaLabel: '高数',
    valueLabel: value => value + ' 分钟',
    referenceLabel: value => value + ' 分钟'
  });
  assert.match(html, /class="mixed-chart"/);
  assert.match(html, /<polyline/);
  assert.match(html, /mixed-bar[^>]+data-height="66\.67"/);
  assert.match(html, /mixed-bar[^>]+style="height:66\.67%"/);
  assert.match(html, /mixed-bar missing/);
  assert.match(html, /mixed-bar zero/);
});
