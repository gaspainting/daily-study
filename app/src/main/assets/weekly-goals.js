(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.StudyWeeks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var DAY = 86400000, LIMIT = 50;
  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var copy = function (v) { return JSON.parse(JSON.stringify(v)); };
  var equal = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  function fail(message) { throw new Error(message); }
  function date(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key) || key < '1900-01-01' || key > '2100-12-31') fail('目标日期无效');
    var stamp = Date.parse(key + 'T00:00:00Z');
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== key) fail('目标日期无效');
    return stamp;
  }
  function end(key) { return new Date(date(key) + 6 * DAY).toISOString().slice(0, 10); }
  function plain(o) { return !!o && typeof o === 'object' && !Array.isArray(o) && [null, Object.prototype].indexOf(Object.getPrototypeOf(o)) >= 0; }
  function validStamp(value) {
    if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/.test(value)) return false;
    try { date(value.slice(0,10)); return Number.isFinite(Date.parse(value)); } catch (_) { return false; }
  }
  function taskList(tasks, subjects, draft) {
    if (!Array.isArray(tasks) || tasks.length > LIMIT) fail('每周最多50项任务');
    var seen = new Set();
    tasks.forEach(function (task) {
      if (!plain(task) || Object.keys(task).sort().join(',') !== 'done,id,subjectId,title,updatedAt') fail('任务格式无效');
      if (typeof task.id !== 'string' || !/^task_[A-Za-z0-9_-]{1,59}$/.test(task.id) || seen.has(task.id)) fail('任务ID无效或重复');
      seen.add(task.id);
      if (typeof task.title !== 'string' || task.title.length > 500 || !draft && !task.title.trim()) fail('任务名称须为1至500字');
      if (task.subjectId !== null && (typeof task.subjectId !== 'string' || !subjects.has(task.subjectId))) fail('任务关联科目不存在');
      if (typeof task.done !== 'boolean') fail('任务完成状态无效');
      if (typeof task.updatedAt !== 'string' || task.updatedAt.length > 40 || !(draft && task.updatedAt === '') && !validStamp(task.updatedAt)) fail('任务记录时间无效');
    });
    return tasks;
  }
  function validate(plan) {
    if (!own(plan, 'weekTasks')) return;
    if (!plain(plan.weekTasks) || Object.keys(plan.weekTasks).length > 2000) fail('周任务资料无效');
    var subjects = new Set(plan.subjects.map(function (s) { return s.id; })), seen = new Set(), count = 0;
    Object.keys(plan.weekTasks).forEach(function (key) {
      date(key); taskList(plan.weekTasks[key], subjects, false);
      plan.weekTasks[key].forEach(function (task) { if (seen.has(task.id)) fail('任务ID跨周重复'); seen.add(task.id); count++; });
    });
    if (count > 10000) fail('任务总数超过10000项');
  }
  function snapshot(plan, key) {
    date(key);
    return { goal: plan.weekGoals[key] || '', hint: plan.weekHints[key] || '', tasks: copy(plan.weekTasks && plan.weekTasks[key] || []) };
  }
  function keys(plan) {
    var all = new Set(Object.keys(plan.weekGoals).concat(Object.keys(plan.weekHints), Object.keys(plan.weekTasks || {})));
    return Array.from(all).filter(function (key) { var g = snapshot(plan, key); return !!g.goal || !!g.hint || g.tasks.length; }).sort().reverse();
  }
  function active(plan, key) { return key >= plan.startDate && key <= plan.endDate && (date(key) - date(plan.startDate)) % (7 * DAY) === 0; }
  function content(task) { return task && { title: task.title, subjectId: task.subjectId, done: task.done }; }
  function merge(base, current, edited, choices) {
    choices = choices || {};
    var conflicts = [], value = { goal: '', hint: '', tasks: [] };
    function pick(key, label, before, saved, input) {
      if (equal(input, before)) return saved;
      if (equal(saved, before) || equal(saved, input)) return input;
      if (choices[key] === 'edited') return input;
      if (choices[key] === 'current') return saved;
      conflicts.push({ key: key, label: label, current: saved, edited: input }); return saved;
    }
    value.goal = pick('goal', '本周目标', base.goal, current.goal, edited.goal);
    value.hint = pick('hint', '随记', base.hint, current.hint, edited.hint);
    var maps = [base, current, edited].map(function (g) { return new Map(g.tasks.map(function (t) { return [t.id, t]; })); });
    var all = new Set(Array.from(maps[0].keys()).concat(Array.from(maps[1].keys()), Array.from(maps[2].keys()))), merged = new Map();
    all.forEach(function (id) {
      var b = maps[0].get(id), c = maps[1].get(id), e = maps[2].get(id), task;
      if (!b) {
        if (!c || !e || equal(content(c), content(e))) task = e || c;
        else task = pick(id, '新增任务：' + e.title, undefined, c, e);
      } else if (!c || !e) {
        var selected = pick(id, '删除或修改：' + b.title, content(b), content(c), content(e));
        task = selected === undefined ? undefined : Object.assign({}, c || e, selected);
      } else {
        task = copy(c);
        ['title', 'subjectId', 'done'].forEach(function (field) { task[field] = pick(id + ':' + field, b.title + ' · ' + ({ title: '名称', subjectId: '科目', done: '完成状态' })[field], b[field], c[field], e[field]); });
      }
      if (task) merged.set(id, copy(task));
    });
    var order = function (g) { return g.tasks.map(function (t) { return t.id; }).filter(function (id) { return merged.has(id); }); };
    var common = base.tasks.map(function (t) { return t.id; }).filter(function (id) { return maps[1].has(id) && maps[2].has(id) && merged.has(id); });
    var commonOrder = function (g) { return order(g).filter(function (id) { return common.indexOf(id) >= 0; }); };
    var bOrder = commonOrder(base), cOrder = commonOrder(current), eOrder = commonOrder(edited);
    var preferred = !equal(eOrder, bOrder) ? pick('order', '任务顺序', bOrder, cOrder, eOrder) : cOrder;
    var primary = equal(preferred, eOrder) && !equal(eOrder, bOrder) ? order(edited) : order(current);
    // Keep independent additions from both editors; unchanged rows retain the chosen order.
    var ids = primary.concat(order(edited), order(current));
    var used = new Set(); ids.forEach(function (id) { if (!used.has(id)) { used.add(id); value.tasks.push(merged.get(id)); } });
    return { value: value, conflicts: conflicts };
  }
  function prepare(plan, key, value, now) {
    date(key);
    if (!plain(value) || typeof value.goal !== 'string' || value.goal.length > 8000 || typeof value.hint !== 'string' || value.hint.length > 8000) fail('目标或随记最多8000字');
    taskList(value.tasks, new Set(plan.subjects.map(function (s) { return s.id; })), true);
    var before = new Map(snapshot(plan, key).tasks.map(function (t) { return [t.id, t]; }));
    var result = copy(value);
    result.tasks.forEach(function (task) {
      task.title = task.title.trim(); if (!task.title) fail('请填写任务名称');
      var old = before.get(task.id);
      task.updatedAt = old && equal(content(task), content(old)) ? old.updatedAt : now;
    });
    taskList(result.tasks, new Set(plan.subjects.map(function (s) { return s.id; })), false);
    return result;
  }
  function put(plan, key, value) {
    plan.weekTasks = plan.weekTasks || {};
    plan.weekGoals[key] = value.goal; plan.weekHints[key] = value.hint; plan.weekTasks[key] = copy(value.tasks);
  }
  function transfer(plan, from, to, mode) {
    date(from); date(to);
    if (from === to) fail('请选择另一周');
    if (!active(plan, to)) fail('请选择计划内的一周');
    if (mode !== 'merge' && mode !== 'replace') fail('目标移动方式无效');
    var source = snapshot(plan, from), dest = snapshot(plan, to);
    if (!source.goal && !source.hint && !source.tasks.length) fail('原周没有目标');
    var join = function (a, b) { return a && b ? a + '\n\n' + b : a || b; };
    var value = mode === 'replace' ? source : { goal: join(dest.goal, source.goal), hint: join(dest.hint, source.hint), tasks: dest.tasks.concat(source.tasks) };
    // Prepare the entire result before touching either group.
    if (value.goal.length > 8000 || value.hint.length > 8000 || value.tasks.length > LIMIT) fail('合并后目标超出长度或50项任务上限');
    var result = copy(plan);
    ['weekGoals', 'weekHints', 'weekTasks'].forEach(function (field) { if (result[field]) delete result[field][from]; });
    put(result, to, value); validate(result); return result;
  }
  return Object.freeze({ limit: LIMIT, end: end, validate: validate, taskList: taskList, snapshot: snapshot, keys: keys, active: active, merge: merge, prepare: prepare, put: put, transfer: transfer });
});
