(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.StudyTasks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DAY = 86400000;
  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var copy = function (v) { return JSON.parse(JSON.stringify(v)); };
  function fail(message) { throw new Error(message); }
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('任务日期无效');
    var stamp = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) fail('任务日期无效');
    return stamp;
  }
  function stamp(value) {
    if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail('任务时间无效');
  }
  function within(plan, value) { return value >= plan.startDate && value <= plan.endDate; }
  function weekKey(plan, value) {
    var offset = Math.floor((date(value) - date(plan.startDate)) / DAY / 7);
    return new Date(date(plan.startDate) + offset * 7 * DAY).toISOString().slice(0, 10);
  }
  function eventId() { return 'task_event_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); }
  function taskId(plan) {
    var used = new Set(all(plan).map(function (entry) { return entry.task.id; }));
    var id;
    do { id = 'task_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); } while (used.has(id));
    return id;
  }
  function cloneHistory(value) { return Array.isArray(value) ? copy(value) : []; }
  function normalize(task, groupKey, index) {
    var value = copy(task);
    if (!own(value, 'scheduledDate')) value.scheduledDate = groupKey;
    if (!own(value, 'dueDate')) value.dueDate = null;
    if (!own(value, 'estimateMinutes')) value.estimateMinutes = null;
    if (!own(value, 'status')) value.status = value.done ? 'done' : 'planned';
    if (!own(value, 'history')) value.history = [];
    value._groupKey = groupKey;
    value._index = index;
    return value;
  }
  function all(plan) {
    var result = [];
    Object.keys(plan.weekTasks || {}).forEach(function (key) {
      (plan.weekTasks[key] || []).forEach(function (task, index) { result.push({ task: normalize(task, key, index), groupKey: key, index: index }); });
    });
    return result;
  }
  function publicTask(task) { var value = copy(task); delete value._groupKey; delete value._index; return value; }
  function find(plan, id) {
    var value = all(plan).find(function (entry) { return entry.task.id === id; });
    if (!value) fail('任务不存在');
    return value;
  }
  function validateDates(plan, scheduledDate, dueDate) {
    date(scheduledDate); if (!within(plan, scheduledDate)) fail('任务日期不在计划范围内');
    if (dueDate !== null) { date(dueDate); if (dueDate < scheduledDate) fail('截止日期不能早于安排日期'); }
  }
  function validateInput(plan, value, allowBlank) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('任务输入无效');
    var title = String(value.title == null ? '' : value.title).trim();
    if (!allowBlank && !title) fail('请填写任务名称');
    if (title.length > 500) fail('任务名称最多500字');
    var scheduledDate = value.scheduledDate || plan.startDate, dueDate = value.dueDate == null || value.dueDate === '' ? null : value.dueDate;
    validateDates(plan, scheduledDate, dueDate);
    if (value.subjectId !== null && value.subjectId !== undefined && value.subjectId !== '') {
      if (!plan.subjects.some(function (subject) { return subject.id === value.subjectId; })) fail('任务关联科目不存在');
    }
    if (value.estimateMinutes !== null && value.estimateMinutes !== undefined && value.estimateMinutes !== '') {
      if (!Number.isFinite(Number(value.estimateMinutes)) || Number(value.estimateMinutes) < 0 || Number(value.estimateMinutes) > 1440) fail('任务估时须为0至1440分钟');
    }
    return { title: title, subjectId: value.subjectId || null, scheduledDate: scheduledDate, dueDate: dueDate, estimateMinutes: value.estimateMinutes === '' || value.estimateMinutes == null ? null : Number(value.estimateMinutes) };
  }
  function appendHistory(task, action, fromDate, toDate, at, reason) {
    stamp(at);
    task.history = cloneHistory(task.history);
    task.history.push({ id: eventId(), action: action, fromDate: fromDate == null ? null : fromDate, toDate: toDate == null ? null : toDate, at: at, reason: String(reason || '').slice(0, 1000) });
    if (task.history.length > 200) task.history = task.history.slice(task.history.length - 200);
  }
  function create(plan, input, at) {
    at = at || new Date().toISOString(); stamp(at);
    var value = validateInput(plan, input, false), key = weekKey(plan, value.scheduledDate), list = plan.weekTasks[key] || [];
    if (list.length >= 50) fail('每周最多50项任务');
    var task = { id: taskId(plan), title: value.title, subjectId: value.subjectId, done: false, updatedAt: at, scheduledDate: value.scheduledDate, dueDate: value.dueDate, estimateMinutes: value.estimateMinutes, status: 'planned', history: [] };
    appendHistory(task, 'created', null, value.scheduledDate, at, '');
    plan.weekTasks[key] = list.concat([task]);
    return publicTask(task);
  }
  function update(plan, id, input, at) {
    at = at || new Date().toISOString(); stamp(at);
    var found = find(plan, id), current = found.task, value = validateInput(plan, Object.assign({}, current, input), false), oldDate = current.scheduledDate;
    var next = Object.assign({}, publicTask(current), value);
    next.status = current.status || (current.done ? 'done' : 'planned');
    next.done = next.status === 'done'; next.updatedAt = at; next.history = cloneHistory(current.history);
    if (value.scheduledDate !== oldDate) appendHistory(next, 'rescheduled', oldDate, value.scheduledDate, at, input.reason);
    else if (value.title !== current.title || value.subjectId !== current.subjectId || value.dueDate !== current.dueDate || value.estimateMinutes !== current.estimateMinutes) appendHistory(next, 'edited', oldDate, value.scheduledDate, at, input.reason);
    var oldList = plan.weekTasks[found.groupKey].slice(); oldList.splice(found.index, 1);
    plan.weekTasks[found.groupKey] = oldList;
    var key = weekKey(plan, next.scheduledDate), destination = plan.weekTasks[key] || [];
    if (key !== found.groupKey && destination.length >= 50) fail('目标周最多50项任务');
    destination.push(next); plan.weekTasks[key] = destination;
    return publicTask(next);
  }
  function setStatus(plan, id, status, at, reason) {
    if (!['planned', 'done', 'skipped'].includes(status)) fail('任务状态无效');
    at = at || new Date().toISOString(); stamp(at);
    var found = find(plan, id), task = publicTask(found.task), old = task.status || (task.done ? 'done' : 'planned');
    task.status = status; task.done = status === 'done'; task.updatedAt = at; task.history = cloneHistory(task.history);
    if (old !== status) appendHistory(task, status === 'done' ? 'completed' : status === 'skipped' ? 'skipped' : 'reopened', task.scheduledDate, task.scheduledDate, at, reason);
    plan.weekTasks[found.groupKey][found.index] = task;
    return task;
  }
  function reschedule(plan, id, scheduledDate, dueDate, at, reason) { return update(plan, id, { scheduledDate: scheduledDate, dueDate: dueDate, reason: reason }, at); }
  function reorder(plan, scheduledDate, ids) {
    date(scheduledDate); if (!Array.isArray(ids)) fail('任务顺序无效');
    var key = weekKey(plan, scheduledDate), list = (plan.weekTasks[key] || []).slice(), selected = list.filter(function (task) { return normalize(task, key, 0).scheduledDate === scheduledDate; });
    var allowed = new Set(selected.map(function (task) { return task.id; })); if (ids.length !== selected.length || ids.some(function (id) { return !allowed.has(id); })) fail('任务顺序与日期不匹配');
    var ordered = ids.map(function (id) { return selected.find(function (task) { return task.id === id; }); }), cursor = 0;
    list = list.map(function (task) { return normalize(task, key, 0).scheduledDate === scheduledDate ? ordered[cursor++] : task; });
    plan.weekTasks[key] = list; return list;
  }
  function forDate(plan, scheduledDate) { date(scheduledDate); return all(plan).filter(function (entry) { return entry.task.scheduledDate === scheduledDate; }).map(function (entry) { return publicTask(entry.task); }); }
  function pending(plan, today) {
    date(today); return all(plan).filter(function (entry) { var task = entry.task; return task.status === 'planned' && (task.scheduledDate < today || task.dueDate && task.dueDate < today); }).map(function (entry) { return publicTask(entry.task); });
  }
  function counts(plan, from, to) {
    var values = all(plan).map(function (entry) { return entry.task; }).filter(function (task) { return (!from || task.scheduledDate >= from) && (!to || task.scheduledDate <= to); });
    return { total: values.length, done: values.filter(function (task) { return task.status === 'done'; }).length, skipped: values.filter(function (task) { return task.status === 'skipped'; }).length, pending: values.filter(function (task) { return task.status === 'planned'; }).length };
  }
  return Object.freeze({ all: all, find: find, create: create, update: update, setStatus: setStatus, reschedule: reschedule, reorder: reorder, forDate: forDate, pending: pending, counts: counts, weekKey: weekKey, normalize: normalize, publicTask: publicTask, validateInput: validateInput });
});
