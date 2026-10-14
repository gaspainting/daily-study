(function (root, factory) {
  'use strict';
  var model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  root.StudyModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DAY = 86400000;
  var STATUSES = ['正常参考', '减量', '仅回顾', '休息'];
  var ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
  var has = function (obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); };
  var clone = function (value) { return JSON.parse(JSON.stringify(value)); };

  function fail(message) { throw new Error(message); }
  function object(value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path + '必须为对象');
    var proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) fail(path + '必须为普通对象');
    Object.keys(value).forEach(function (key) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail(path + '含非法字段');
    });
    return value;
  }
  function keys(value, required, optional, path) {
    object(value, path);
    required.forEach(function (key) { if (!has(value, key)) fail(path + '缺少' + key); });
    Object.keys(value).forEach(function (key) {
      if (required.indexOf(key) < 0 && optional.indexOf(key) < 0) fail(path + '含未知字段' + key);
    });
  }
  function string(value, max, path, nonempty) {
    if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim())) fail(path + '文本无效');
  }
  function number(value, max, path, integer) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value))) fail(path + '数值无效');
  }
  function optionalNumber(value, max, path, integer) {
    if (value !== null) number(value, max, path, integer);
  }
  function optionalBoolean(value, path) {
    if (value !== null && typeof value !== 'boolean') fail(path + '必须为空或布尔值');
  }
  function dateStamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('日期须为YYYY-MM-DD');
    var year = Number(value.slice(0, 4));
    if (year < 1900 || year > 2100) fail('日期年份须在1900—2100之间');
    var time = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) fail('日期不存在：' + value);
    return time;
  }
  function iso(time) { return new Date(time).toISOString().slice(0, 10); }
  function today(date) {
    date = date === undefined ? new Date() : date;
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail('时间无效');
    var value = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    dateStamp(value);
    return value;
  }
  function dates(start, end) {
    var first = dateStamp(start), last = dateStamp(end);
    var count = (last - first) / DAY + 1;
    if (count < 1 || count > 730) fail('计划日期范围须为1—730天');
    var result = [];
    for (var i = 0; i < count; i++) result.push(iso(first + i * DAY));
    return result;
  }
  function weekNumber(value) {
    if (!Number.isInteger(value) || value < 1 || value > 999) fail('起始教学周须为1—999的整数');
  }
  function weekInfo(plan, date) {
    var offset = Math.floor((dateStamp(date) - dateStamp(plan.startDate)) / DAY / 7);
    weekNumber(plan.startWeek);
    var start = iso(dateStamp(plan.startDate) + offset * 7 * DAY);
    var end = iso(dateStamp(start) + 6 * DAY);
    var number = plan.startWeek + offset;
    return { key: start, number: number, parity: Math.abs(number % 2) === 1 ? '单周' : '双周', start: start, end: end };
  }
  function weekKey(plan, date) { return weekInfo(plan, date).key; }
  function defaultsValid(value, path) {
    if (!Array.isArray(value) || value.length !== 7) fail(path + '须含周一至周日7个参考分钟');
    value.forEach(function (minutes) { number(minutes, 1440, path, false); });
  }
  function subjectsForDate(state, date) { dateStamp(date); return clone(state.plan.subjects); }
  function subject(state, id) {
    var found = state.plan.subjects.find(function (item) { return item.id === id; });
    if (!found) fail('科目不存在：' + id);
    return found;
  }
  function target(state, date, id) {
    var time = dateStamp(date), item = subject(state, id);
    var stored = state.plan.targets[date];
    if (stored && has(stored, id)) return stored[id];
    return item.defaults[(new Date(time).getUTCDay() + 6) % 7];
  }
  function blankSubject() {
    return { minutes: null, content: '', problem: '', newWords: null, reviewWords: null, forgotWords: '' };
  }
  function record(state, date) {
    dateStamp(date);
    var value = has(state.records, date) ? clone(state.records[date]) : { subjects: {}, status: null, restKept: null, note: '' };
    state.plan.subjects.forEach(function (item) {
      if (!has(value.subjects, item.id)) value.subjects[item.id] = blankSubject();
    });
    return value;
  }
  function sessionsValid(value, ids, path) {
    if (!Array.isArray(value) || value.length > 100000) fail(path + '记录数量无效');
    var seen = Object.create(null);
    value.forEach(function (session, index) {
      var prefix = path + '[' + index + ']';
      keys(session, ['id', 'date', 'subjectId', 'seconds', 'endedAt'], [], prefix);
      string(session.id, 128, prefix + '.id', true);
      if (seen[session.id]) fail(path + '含重复计时记录');
      seen[session.id] = true;
      dateStamp(session.date);
      if (!ids[session.subjectId]) fail(prefix + '科目不存在');
      number(session.seconds, 86400, prefix + '.seconds', false);
      string(session.endedAt, 64, prefix + '.endedAt', true);
      if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(session.endedAt) || !Number.isFinite(Date.parse(session.endedAt))) fail(prefix + '结束时间无效');
      dateStamp(session.endedAt.slice(0, 10));
    });
  }
  function recordValid(value, ids, path) {
    keys(value, ['subjects', 'status', 'restKept', 'note'], ['sessions'], path);
    object(value.subjects, path + '.subjects');
    Object.keys(value.subjects).forEach(function (id) {
      if (!ids[id]) fail(path + '科目不存在：' + id);
      var item = value.subjects[id], prefix = path + '.' + id;
      keys(item, ['minutes', 'content', 'problem', 'newWords', 'reviewWords', 'forgotWords'], [], prefix);
      optionalNumber(item.minutes, 1440, prefix + '.minutes', false);
      optionalNumber(item.newWords, 100000, prefix + '.newWords', true);
      optionalNumber(item.reviewWords, 100000, prefix + '.reviewWords', true);
      string(item.content, 8000, prefix + '.content', false);
      string(item.problem, 8000, prefix + '.problem', false);
      string(item.forgotWords, 8000, prefix + '.forgotWords', false);
    });
    if (value.status !== null && STATUSES.indexOf(value.status) < 0) fail(path + '安排状态无效');
    optionalBoolean(value.restKept, path + '.restKept');
    string(value.note, 8000, path + '.note', false);
    if (has(value, 'sessions')) sessionsValid(value.sessions, ids, path + '.sessions');
  }
  function clock(value, path) {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail(path + '须为HH:mm');
  }
  function validateState(state) {
    keys(state, ['version', 'plan', 'records', 'reviews', 'settings'], ['sessions', '_revision'], 'state');
    if (state.version !== 1) fail('不支持此备份版本');
    if (has(state, '_revision')) number(state._revision, Number.MAX_SAFE_INTEGER, '_revision', true);
    var plan = state.plan;
    keys(plan, ['title', 'startDate', 'endDate', 'startWeek', 'subjects', 'targets', 'weekGoals', 'weekHints'], [], 'plan');
    string(plan.title, 128, 'plan.title', true);
    dates(plan.startDate, plan.endDate);
    weekNumber(plan.startWeek);
    if (!Array.isArray(plan.subjects) || plan.subjects.length < 1 || plan.subjects.length > 24) fail('科目数须为1—24');
    var ids = Object.create(null);
    plan.subjects.forEach(function (item) {
      keys(item, ['id', 'name', 'kind', 'defaults'], [], 'subject');
      if (typeof item.id !== 'string' || !ID.test(item.id) || ids[item.id] || item.id === 'constructor' || item.id === 'prototype') fail('科目ID无效或重复');
      ids[item.id] = true;
      string(item.name, 128, 'subject.name', true);
      if (['math', 'vocab', 'custom'].indexOf(item.kind) < 0) fail('科目类型无效');
      defaultsValid(item.defaults, 'subject.defaults');
    });
    object(plan.targets, 'plan.targets');
    if (Object.keys(plan.targets).length > 100000) fail('参考日期过多');
    Object.keys(plan.targets).forEach(function (date) {
      dateStamp(date);
      object(plan.targets[date], 'plan.targets.' + date);
      Object.keys(plan.targets[date]).forEach(function (id) {
        if (!ids[id]) fail('参考量的科目不存在：' + id);
        number(plan.targets[date][id], 1440, '参考分钟', false);
      });
    });
    ['weekGoals', 'weekHints'].forEach(function (field) {
      object(plan[field], 'plan.' + field);
      if (Object.keys(plan[field]).length > 100000) fail('周资料过多');
      Object.keys(plan[field]).forEach(function (date) { dateStamp(date); string(plan[field][date], 8000, field, false); });
    });
    object(state.records, 'records');
    if (Object.keys(state.records).length > 100000) fail('日记录过多');
    Object.keys(state.records).forEach(function (date) { dateStamp(date); recordValid(state.records[date], ids, 'records.' + date); });
    object(state.reviews, 'reviews');
    if (Object.keys(state.reviews).length > 100000) fail('复盘记录过多');
    Object.keys(state.reviews).forEach(function (date) {
      dateStamp(date);
      var review = state.reviews[date];
      keys(review, ['load', 'mathProblem', 'vocabReview', 'adjustment', 'reason', 'halfDayRest'], [], 'review');
      ['load', 'mathProblem', 'vocabReview', 'adjustment', 'reason'].forEach(function (field) { string(review[field], 8000, 'review.' + field, false); });
      optionalBoolean(review.halfDayRest, 'review.halfDayRest');
    });
    keys(state.settings, ['reminders'], [], 'settings');
    var reminders = state.settings.reminders;
    keys(reminders, ['enabled', 'weekdayTime', 'weekendTime'], [], 'reminders');
    if (typeof reminders.enabled !== 'boolean') fail('提醒开关须为布尔值');
    clock(reminders.weekdayTime, '工作日提醒');
    clock(reminders.weekendTime, '周末提醒');
    var weekdayMinutes = Number(reminders.weekdayTime.slice(0, 2)) * 60 + Number(reminders.weekdayTime.slice(3));
    var weekendMinutes = Number(reminders.weekendTime.slice(0, 2)) * 60 + Number(reminders.weekendTime.slice(3));
    if (weekdayMinutes >= 1230) fail('工作日提醒须早于20:30');
    if (weekendMinutes < 570 || weekendMinutes >= 1140) fail('周末提醒须在09:30至19:00之前');
    if (has(state, 'sessions')) sessionsValid(state.sessions, ids, 'sessions');
    return true;
  }
  function saveRecord(state, date, value) {
    dateStamp(date);
    validateState(state);
    var ids = Object.create(null);
    state.plan.subjects.forEach(function (item) { ids[item.id] = true; });
    recordValid(value, ids, '记录');
    state.records[date] = clone(value);
    return state;
  }
  function fillTargets(state) {
    dates(state.plan.startDate, state.plan.endDate).forEach(function (date) {
      if (!has(state.plan.targets, date)) state.plan.targets[date] = {};
      state.plan.subjects.forEach(function (item) {
        if (!has(state.plan.targets[date], item.id)) state.plan.targets[date][item.id] = item.defaults[(new Date(dateStamp(date)).getUTCDay() + 6) % 7];
      });
    });
  }
  function resizePlan(state, start, end, startWeek) {
    validateState(state);
    dates(start, end);
    weekNumber(startWeek);
    state.plan.startDate = start;
    state.plan.endDate = end;
    state.plan.startWeek = startWeek;
    fillTargets(state);
    return state;
  }
  function addSubject(state, name, defaults) {
    validateState(state);
    if (state.plan.subjects.length >= 24) fail('最多添加24个科目');
    string(name, 128, '科目名称', true);
    defaults = defaults === undefined ? [0, 0, 0, 0, 0, 0, 0] : defaults;
    defaultsValid(defaults, '科目参考');
    var index = 1;
    while (state.plan.subjects.some(function (item) { return item.id === 'custom_' + index; })) index++;
    var item = { id: 'custom_' + index, name: name.trim(), kind: 'custom', defaults: defaults.slice() };
    state.plan.subjects.push(item);
    fillTargets(state);
    return clone(item);
  }
  function updateSubject(state, id, name, defaults) {
    validateState(state);
    var item = subject(state, id);
    string(name, 128, '科目名称', true);
    defaultsValid(defaults, '科目参考');
    item.name = name.trim();
    item.defaults = defaults.slice();
    return clone(item);
  }
  function weekStats(state, date) {
    var info = weekInfo(state.plan, date);
    var start = info.start < state.plan.startDate ? state.plan.startDate : info.start;
    var end = info.end > state.plan.endDate ? state.plan.endDate : info.end;
    var days = start <= end ? dates(start, end) : [];
    var anyDays = 0, entryDays = 0;
    days.forEach(function (day) {
      var value = state.records[day];
      if (!value) return;
      entryDays++;
      if (state.plan.subjects.some(function (item) {
        return value.subjects[item.id] && value.subjects[item.id].minutes !== null;
      })) anyDays++;
    });
    return Object.assign({}, info, {
      days: days,
      subjects: state.plan.subjects.map(function (item) {
        var reference = 0, actual = 0, recordedDays = 0;
        days.forEach(function (day) {
          reference += target(state, day, item.id);
          var value = state.records[day] && state.records[day].subjects[item.id];
          if (value && value.minutes !== null) { actual += value.minutes; recordedDays++; }
        });
        return { id: item.id, name: item.name, kind: item.kind, reference: reference, actual: recordedDays ? actual : null, recordedDays: recordedDays, totalDays: days.length };
      }),
      recordedDays: anyDays,
      entryDays: entryDays,
      totalDays: days.length
    });
  }
  function allowed(date) {
    date = date === undefined ? new Date() : date;
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail('时间无效');
    var day = date.getDay(), minutes = date.getHours() * 60 + date.getMinutes();
    return day === 0 || day === 6 ? minutes >= 570 && minutes < 1140 : minutes < 1230;
  }
  return Object.freeze({
    today: today, dates: dates, weekKey: weekKey, weekInfo: weekInfo,
    subjectsForDate: subjectsForDate, target: target, record: record, saveRecord: saveRecord,
    resizePlan: resizePlan, addSubject: addSubject, updateSubject: updateSubject,
    weekStats: weekStats, validateState: validateState, validate: validateState, allowed: allowed
  });
});
