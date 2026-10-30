'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Model = require('../app/src/main/assets/model.js');
const Tracking = require('../app/src/main/assets/tracking.js');

const seed = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../app/src/main/assets/seed.json'), 'utf8'));

test('custom rest hours drive allowed checks and reminder validation', () => {
  const state = Model.migrateState(seed());
  state.settings.restHours = { weekdayEnd: '21:30', weekendStart: '08:00', weekendEnd: '17:00' };
  state.settings.reminders.weekdayTime = '21:00';
  state.settings.reminders.weekendTime = '16:30';
  Model.validate(state);
  assert.equal(Model.allowed(new Date('2026-10-14T21:29:00'), state), true);
  assert.equal(Model.allowed(new Date('2026-10-14T21:30:00'), state), false);
  assert.equal(Model.allowed(new Date('2026-10-18T07:59:00'), state), false);
  assert.equal(Model.allowed(new Date('2026-10-18T08:00:00'), state), true);
  assert.equal(Model.allowed(new Date('2026-10-18T17:00:00'), state), false);
});

test('rest hours reject an inverted weekend window and out-of-window reminder', () => {
  const state = Model.migrateState(seed());
  state.settings.restHours = { weekdayEnd: '20:30', weekendStart: '18:00', weekendEnd: '09:00' };
  assert.throws(() => Model.validate(state), /周末开始时间须早于结束时间/);
  state.settings.restHours = { weekdayEnd: '20:30', weekendStart: '09:30', weekendEnd: '19:00' };
  state.settings.reminders.weekdayTime = '21:00';
  assert.throws(() => Model.validate(state), /工作日提醒须早于20:30/);
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
  assert.match(html, /mixed-bar missing/);
  assert.match(html, /mixed-bar zero/);
});
