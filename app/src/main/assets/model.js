(function (root, factory) {
  'use strict';
  var model = factory(root.StudySchedule || (typeof module === 'object' && module.exports ? require('./schedule.js') : null), root.StudyWeeks || (typeof module === 'object' && module.exports ? require('./weekly-goals.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = model;
  root.StudyModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (schedule, weeks) {
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
  function wordStepsValid(value) {
    if (!Array.isArray(value) || value.length !== 3) fail('快捷加数须为三个正整数');
    value.forEach(function (n) { number(n, 100000, '快捷加数', true); if (n < 1) fail('快捷加数须大于0'); });
    if (new Set(value).size !== 3) fail('快捷加数不能重复');
  }
  function wordSteps(state, id) {
    var item = subject(state, id); if (item.kind !== 'vocab') fail('快捷加数仅用于单词');
    return has(item, 'wordSteps') ? item.wordSteps.slice() : [5, 10, 20];
  }
  function setWordSteps(state, id, steps) {
    validateState(state); wordStepsValid(steps);
    var item = subject(state, id); if (item.kind !== 'vocab') fail('快捷加数仅用于单词');
    state.version = Math.max(state.version, 2); item.wordSteps = steps.slice(); validateState(state); return state;
  }
  function subjectActive(item, date) {
    dateStamp(date);
    return !has(item, 'activePeriods') || item.activePeriods.some(function (period) { return period.from <= date && (period.to === null || date < period.to); });
  }
  function subjectsForDate(state, date) { dateStamp(date); return clone(state.plan.subjects.filter(function (item) { return subjectActive(item, date); })); }
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
    if (![1, 2, 3].includes(state.version)) fail('不支持此备份版本');
    if (has(state, '_revision')) number(state._revision, Number.MAX_SAFE_INTEGER, '_revision', true);
    var plan = state.plan;
    keys(plan, ['title', 'startDate', 'endDate', 'startWeek', 'subjects', 'targets', 'weekGoals', 'weekHints'], state.version >= 2 ? ['wordTargets', 'manualWeekGoals'].concat(state.version === 3 ? ['weekTasks'] : []) : [], 'plan');
    string(plan.title, 128, 'plan.title', true);
    dates(plan.startDate, plan.endDate);
    weekNumber(plan.startWeek);
    if (!Array.isArray(plan.subjects) || plan.subjects.length < 1 || plan.subjects.length > 24) fail('科目数须为1—24');
    var ids = Object.create(null);
    plan.subjects.forEach(function (item) {
      keys(item, ['id', 'name', 'kind', 'defaults'], state.version >= 2 ? ['activePeriods', 'wordGoal', 'wordSteps'] : [], 'subject');
      if (typeof item.id !== 'string' || !ID.test(item.id) || ids[item.id] || item.id === 'constructor' || item.id === 'prototype') fail('科目ID无效或重复');
      ids[item.id] = true;
      string(item.name, 128, 'subject.name', true);
      if (['math', 'vocab', 'custom'].indexOf(item.kind) < 0) fail('科目类型无效');
      defaultsValid(item.defaults, 'subject.defaults');
      if (has(item, 'wordGoal')) { if (item.kind !== 'vocab') fail('词数目标仅用于单词'); number(item.wordGoal, 100000, '每日新学目标', true); }
      if (has(item, 'wordSteps')) { if (item.kind !== 'vocab') fail('快捷加数仅用于单词'); wordStepsValid(item.wordSteps); }
      if (has(item, 'activePeriods')) {
        if (!Array.isArray(item.activePeriods) || item.activePeriods.length > 1000) fail('科目启用时段无效');
        var previous = null;
        item.activePeriods.forEach(function (period, index) {
          keys(period, ['from', 'to'], [], 'activePeriod'); dateStamp(period.from);
          if (period.to !== null) { dateStamp(period.to); if (period.to <= period.from) fail('科目启用时段结束日期无效'); }
          if (index && (previous === null || period.from < previous)) fail('科目启用时段重叠或顺序无效');
          previous = period.to;
        });
      }
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
    if (has(plan, 'manualWeekGoals') && plan.manualWeekGoals !== true) fail('周目标模式无效');
    if (has(plan, 'wordTargets')) {
      object(plan.wordTargets, 'plan.wordTargets');
      if (Object.keys(plan.wordTargets).length > 100000) fail('词数目标日期过多');
      Object.keys(plan.wordTargets).forEach(function (day) {
        dateStamp(day); object(plan.wordTargets[day], '词数目标');
        Object.keys(plan.wordTargets[day]).forEach(function (id) { if (!ids[id] || subject(state, id).kind !== 'vocab') fail('词数目标科目无效'); number(plan.wordTargets[day][id], 100000, '新学目标', true); });
      });
    }
    ['weekGoals', 'weekHints'].forEach(function (field) {
      object(plan[field], 'plan.' + field);
      if (Object.keys(plan[field]).length > 100000) fail('周资料过多');
      Object.keys(plan[field]).forEach(function (date) { dateStamp(date); string(plan[field][date], 8000, field, false); });
    });
    weeks.validate(plan);
    object(state.records, 'records');
    if (Object.keys(state.records).length > 100000) fail('日记录过多');
    Object.keys(state.records).forEach(function (date) { dateStamp(date); recordValid(state.records[date], ids, 'records.' + date); });
    object(state.reviews, 'reviews');
    if (Object.keys(state.reviews).length > 100000) fail('复盘记录过多');
    Object.keys(state.reviews).forEach(function (date) {
      dateStamp(date);
      var review = state.reviews[date];
      keys(review, ['load', 'mathProblem', 'vocabReview', 'adjustment', 'reason', 'halfDayRest'], state.version >= 2 ? ['subjects'] : [], 'review');
      ['load', 'mathProblem', 'vocabReview', 'adjustment', 'reason'].forEach(function (field) { string(review[field], 8000, 'review.' + field, false); });
      optionalBoolean(review.halfDayRest, 'review.halfDayRest');
      if (has(review, 'subjects')) {
        object(review.subjects, 'review.subjects');
        Object.keys(review.subjects).forEach(function (id) { if (!ids[id]) fail('复盘科目不存在：' + id); string(review.subjects[id], 8000, 'review.subjects.' + id, false); });
      }
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
  var LEGACY_WEEKS = {"weekGoals":{"2026-10-12":"函数与极限符号、已忘基础定位。","2026-10-19":"极限运算与初等函数基础。","2026-10-26":"常见极限与连续性。","2026-11-02":"导数定义与基本求导。","2026-11-09":"求导法则、复合函数。","2026-11-16":"高阶导数与微分（选做隐函数）。","2026-11-23":"中值定理直观与条件。","2026-11-30":"单调性、极值与最值。","2026-12-07":"函数、极限、导数的综合回顾。","2026-12-14":"小检查和寒假起点；积分仅可选接触。"},"weekHints":{"2026-10-12":"周四3—4节、周五1—2节有单周课；周一就业指导、光电子学仍在。","2026-10-19":"本周不排周四3—4节、周五1—2节的单周课；就业指导、光电子学仍在。空课用于替换自习或休息。","2026-10-26":"就业指导已结束；光电子学仍在；周四3—4节、周五1—2节有单周课。","2026-11-02":"就业指导已结束；光电子学仍在；本周不排两处单周课。","2026-11-09":"光电子学固定课已结束；周四3—4节、周五1—2节有单周课；给习概实践、实验和作业留余量。","2026-11-16":"光电子学固定课已结束；本周不排两处单周课；空课优先兼顾作业、实验和休息。","2026-11-23":"光电子学固定课已结束；周四3—4节、周五1—2节有单周课；继续预留实践和作业时间。","2026-11-30":"光电子学固定课已结束；本周不排两处单周课；空课不自动转为额外考研任务。","2026-12-07":"周四3—4节、周五1—2节有单周课；如临近期末课程任务增加，可以减量。","2026-12-14":"本周不排两处单周课；完成短时检查并确定寒假起点，允许继续停在导数。"}};
  function clearPresetWeeks(plan) {
    if (plan.manualWeekGoals === true) return;
    ['weekGoals', 'weekHints'].forEach(function (field) { var values = Object.values(LEGACY_WEEKS[field]); Object.keys(plan[field]).forEach(function (day) { if (values.includes(plan[field][day])) delete plan[field][day]; }); });
    plan.manualWeekGoals = true;
  }
  function wordTarget(state, date, id) {
    dateStamp(date); var item = subject(state, id); if (item.kind !== 'vocab') fail('该科目使用分钟');
    var stored = state.plan.wordTargets && state.plan.wordTargets[date];
    return stored && has(stored, id) ? stored[id] : has(item, 'wordGoal') ? item.wordGoal : 50;
  }
  function setWordGoal(state, id, goal, from) {
    validateState(state); dateStamp(from); number(goal, 100000, '每日新学目标', true);
    var item = subject(state, id); if (item.kind !== 'vocab') fail('该科目使用分钟');
    if (goal === (has(item, 'wordGoal') ? item.wordGoal : 50)) return state;
    var targets = state.plan.wordTargets || (state.plan.wordTargets = {});
    dates(state.plan.startDate, state.plan.endDate).forEach(function (day) { var previous = wordTarget(state, day, id); targets[day] = targets[day] || {}; if (!has(targets[day], id)) targets[day][id] = previous; if (day >= from) targets[day][id] = goal; });
    state.version = Math.max(state.version, 2); item.wordGoal = goal; validateState(state);
  }
  function wordStats(state, days) {
    return state.plan.subjects.filter(function (item) { return item.kind === 'vocab'; }).map(function (item) {
      var target = 0, learned = 0, reviewed = 0, newDays = 0, reviewDays = 0, totalDays = 0, goalDays = 0;
      days.forEach(function (day) {
        var r = state.records[day] && state.records[day].subjects[item.id], active = day >= state.plan.startDate && day <= state.plan.endDate && subjectActive(item, day);
        if (active) { target += wordTarget(state, day, item.id); goalDays++; }
        if (active || r && (r.newWords != null || r.reviewWords != null)) totalDays++;
        if (r && r.newWords != null) { learned += r.newWords; newDays++; }
        if (r && r.reviewWords != null) { reviewed += r.reviewWords; reviewDays++; }
      });
      return {id:item.id,name:item.name,target:goalDays ? target : null,newWords:newDays ? learned : null,reviewWords:reviewDays ? reviewed : null,newRecordedDays:newDays,reviewRecordedDays:reviewDays,totalDays:totalDays};
    });
  }
  function migrateState(state, now) {
    validateState(state);
    var result = clone(state);
    result.version = 3;
    result.plan.weekTasks = result.plan.weekTasks || {};
    clearPresetWeeks(result.plan);
    Object.keys(result.reviews).forEach(function (date) {
      var review = result.reviews[date];
      if (!has(review, 'subjects')) review.subjects = {};
      result.plan.subjects.forEach(function (item) {
        var field = item.kind === 'math' ? 'mathProblem' : item.kind === 'vocab' ? 'vocabReview' : null;
        if (field && !has(review.subjects, item.id)) review.subjects[item.id] = review[field];
      });
    });
    if (schedule) { now = now === undefined ? today() : now; dateStamp(now); schedule.upgrade(result, now); }
    validateState(result);
    return result;
  }
  function applyCourseSchedule(state, now) {
    validateState(state); now = now === undefined ? today() : now; dateStamp(now);
    var result = clone(state); schedule.apply(result, now, true); validateState(result); return result;
  }
  function archiveSubject(state, id, date) {
    validateState(state); dateStamp(date);
    var item = subject(state, id);
    if (!subjectActive(item, date)) return clone(item);
    var periods = has(item, 'activePeriods') ? clone(item.activePeriods) : [{ from: '1900-01-01', to: null }];
    periods = periods.map(function (period) {
      if (period.from <= date && (period.to === null || date < period.to)) period.to = date;
      return period;
    }).filter(function (period) { return period.to === null || period.from < period.to; });
    state.version = Math.max(state.version, 2); item.activePeriods = periods;
    validateState(state); return clone(item);
  }
  function restoreSubject(state, id, date) {
    validateState(state); dateStamp(date);
    var item = subject(state, id);
    if (subjectActive(item, date)) return clone(item);
    var periods = clone(item.activePeriods);
    if (periods.some(function (period) { return period.from > date; })) fail('恢复日期早于已有启用时段');
    var last = periods[periods.length - 1];
    if (last && last.to === date) last.to = null;
    else periods.push({ from: date, to: null });
    if (periods.length > 1000) fail('科目启用时段过多');
    state.version = Math.max(state.version, 2); item.activePeriods = periods;
    validateState(state); return clone(item);
  }
  function moveSubject(state, id, direction) {
    validateState(state); subject(state, id);
    if (direction !== -1 && direction !== 1 && direction !== 'up' && direction !== 'down') fail('科目排序方向无效');
    var index = state.plan.subjects.findIndex(function (item) { return item.id === id; });
    var destination = index + (direction === -1 || direction === 'up' ? -1 : 1);
    if (destination >= 0 && destination < state.plan.subjects.length) {
      var item = state.plan.subjects.splice(index, 1)[0]; state.plan.subjects.splice(destination, 0, item);
    }
    return state;
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
  function addSubject(state, name, defaults, effectiveDate) {
    validateState(state);
    if (state.plan.subjects.length >= 24) fail('最多添加24个科目');
    string(name, 128, '科目名称', true);
    defaults = defaults === undefined ? [0, 0, 0, 0, 0, 0, 0] : defaults;
    defaultsValid(defaults, '科目参考');
    if (effectiveDate !== undefined) dateStamp(effectiveDate);
    var index = 1;
    while (state.plan.subjects.some(function (item) { return item.id === 'custom_' + index; })) index++;
    var item = { id: 'custom_' + index, name: name.trim(), kind: 'custom', defaults: defaults.slice() };
    if (effectiveDate !== undefined) { state.version = Math.max(state.version, 2); item.activePeriods = [{ from: effectiveDate, to: null }]; }
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
          if (subjectActive(item, day)) reference += target(state, day, item.id);
          var value = state.records[day] && state.records[day].subjects[item.id];
          if (value && value.minutes !== null) { actual += value.minutes; recordedDays++; }
        });
        var totalDays = days.filter(function (day) { return subjectActive(item, day) || state.records[day] && state.records[day].subjects[item.id] && state.records[day].subjects[item.id].minutes !== null; }).length;
        return { id: item.id, name: item.name, kind: item.kind, reference: reference, actual: recordedDays ? actual : null, recordedDays: recordedDays, totalDays: totalDays };
      }),
      recordedDays: anyDays,
      entryDays: entryDays,
      totalDays: days.length
    });
  }
  function meaningfulSubject(item) {
    return !!item && (item.minutes != null || item.newWords != null || item.reviewWords != null || !!item.content || !!item.problem || !!item.forgotWords);
  }
  function recordSummary(state, date) {
    dateStamp(date);
    var value = state.records[date], entries = value && value.subjects || {};
    var relevant = state.plan.subjects.filter(function (item) { return subjectActive(item, date) || meaningfulSubject(entries[item.id]); });
    var written = relevant.filter(function (item) { var r = entries[item.id]; return r && (r.minutes != null || item.kind === 'vocab' && (r.newWords != null || r.reviewWords != null)); });
    var times = written.filter(function (item) { return entries[item.id].minutes != null; });
    var total = times.length ? times.reduce(function (sum, item) { return sum + entries[item.id].minutes; }, 0) : null;
    var vocab = relevant.filter(function (item) { return item.kind === 'vocab'; });
    function count(field) { var values = vocab.map(function (item) { return entries[item.id] && entries[item.id][field]; }).filter(function (v) { return v != null; }); return values.length ? values.reduce(function (a,b) { return a+b; },0) : null; }
    var learned = count('newWords'), reviewed = count('reviewWords');
    var note = !!value && (!!value.note || value.status != null || value.restKept != null || Object.keys(entries).some(function (id) { return meaningfulSubject(entries[id]); }));
    var kind = written.length ? (written.length < relevant.length ? 'partial' : (total || 0) === 0 && (learned || 0) === 0 && (reviewed || 0) === 0 ? 'zero' : 'complete') : note ? 'note' : 'empty';
    return { date: date, total: total, newWords: learned, reviewWords: reviewed, recordedSubjects: written.length, totalSubjects: relevant.length, kind: kind, status: value ? value.status : null, note: value ? value.note : '', entry: !!value };
  }
  function normalizedFilters(filters) {
    filters = filters || {};
    var from = filters.from || filters.startDate || '', to = filters.to || filters.endDate || '';
    if (from) dateStamp(from); if (to) dateStamp(to);
    if (from && to && from > to) fail('开始日期晚于结束日期');
    return { from: from, to: to, subjectId: filters.subjectId || filters.subject || '', keyword: String(filters.keyword || '').trim().toLocaleLowerCase(), status: filters.status || '', kind: filters.recordKind || filters.kind || '' };
  }
  function historySearch(state, filters) {
    validateState(state); var query = normalizedFilters(filters);
    if (query.subjectId && query.subjectId !== 'all') subject(state, query.subjectId);
    var rows = [];
    Object.keys(state.records).forEach(function (date) {
      if (query.from && date < query.from || query.to && date > query.to) return;
      var value = state.records[date];
      if (query.subjectId && query.subjectId !== 'all' && !meaningfulSubject(value.subjects[query.subjectId])) return;
      if (query.status && query.status !== 'all' && value.status !== query.status) return;
      if (query.keyword) {
        var text = [date, value.note, value.status];
        state.plan.subjects.forEach(function (item) { var entry = value.subjects[item.id]; if (meaningfulSubject(entry)) text.push(item.name, entry.content, entry.problem, entry.forgotWords); });
        if (text.join(' ').toLocaleLowerCase().indexOf(query.keyword) < 0) return;
      }
      var summary = recordSummary(state, date);
      if (query.kind && query.kind !== 'all' && query.kind !== summary.kind) return;
      rows.push(Object.assign(summary, { record: clone(value) }));
    });
    return rows.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  }
  function monthStats(state, month) {
    validateState(state);
    if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) fail('月份须为YYYY-MM');
    var start = month + '-01'; dateStamp(start);
    var first = new Date(dateStamp(start));
    var end = iso(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)); dateStamp(end);
    var days = dates(start, end), entries = 0, recorded = 0;
    days.forEach(function (day) { if (has(state.records, day)) entries++; if (recordSummary(state, day).total !== null) recorded++; });
    var subjects = state.plan.subjects.map(function (item) {
      var actual = 0, reference = 0, recordedDays = 0, totalDays = 0;
      days.forEach(function (day) {
        var entry = state.records[day] && state.records[day].subjects[item.id], written = !!entry && entry.minutes !== null;
        var active = day >= state.plan.startDate && day <= state.plan.endDate && subjectActive(item, day);
        if (active) reference += target(state, day, item.id);
        if (active || written) totalDays++;
        if (written) { actual += entry.minutes; recordedDays++; }
      });
      return { id: item.id, name: item.name, kind: item.kind, actual: recordedDays ? actual : null, reference: reference, recordedDays: recordedDays, totalDays: totalDays };
    });
    var actualExists = subjects.some(function (item) { return item.actual !== null; });
    return { month: month, start: start, end: end, days: days, subjects: subjects, entryDays: entries, recordedDays: recorded, totalDays: days.length, actual: actualExists ? subjects.reduce(function (sum, item) { return sum + (item.actual || 0); }, 0) : null, reference: subjects.reduce(function (sum, item) { return sum + item.reference; }, 0) };
  }
  function sessionSearch(state, filters) {
    validateState(state); var query = normalizedFilters(filters), seen = Object.create(null), sessions = [];
    if (query.subjectId && query.subjectId !== 'all') subject(state, query.subjectId);
    function append(values) { (values || []).forEach(function (item) {
      if (seen[item.id]) return;
      seen[item.id] = true;
      if (query.from && item.date < query.from || query.to && item.date > query.to || query.subjectId && query.subjectId !== 'all' && item.subjectId !== query.subjectId) return;
      sessions.push({ value: item, time: Date.parse(item.endedAt) });
    }); }
    append(state.sessions);
    Object.keys(state.records).sort().forEach(function (date) { append(state.records[date].sessions); });
    return sessions.sort(function (a, b) { return b.time - a.time || b.value.id.localeCompare(a.value.id); }).map(function (item) { return clone(item.value); });
  }
  function allowed(date) {
    date = date === undefined ? new Date() : date;
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail('时间无效');
    var day = date.getDay(), minutes = date.getHours() * 60 + date.getMinutes();
    return day === 0 || day === 6 ? minutes >= 570 && minutes < 1140 : minutes < 1230;
  }
  return Object.freeze({
    today: today, dates: dates, weekKey: weekKey, weekInfo: weekInfo,
    subjectsForDate: subjectsForDate, subjectActive: subjectActive, target: target, record: record, saveRecord: saveRecord,
    resizePlan: resizePlan, addSubject: addSubject, updateSubject: updateSubject,
    wordTarget: wordTarget, setWordGoal: setWordGoal, wordStats: wordStats, wordSteps: wordSteps, setWordSteps: setWordSteps,
    weekStats: weekStats, monthStats: monthStats, recordSummary: recordSummary, historySearch: historySearch, sessionSearch: sessionSearch,
    migrateState: migrateState, applyCourseSchedule: applyCourseSchedule, archiveSubject: archiveSubject, restoreSubject: restoreSubject, moveSubject: moveSubject,
    validateState: validateState, validate: validateState, allowed: allowed
  });
});
