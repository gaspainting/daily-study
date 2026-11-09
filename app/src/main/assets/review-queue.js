(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.StudyReviewQueue = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var copy = function (v) { return JSON.parse(JSON.stringify(v)); };
  var FEEDBACK = ['independent', 'prompted', 'uncertain'];
  var STATUS = ['open', 'paused', 'ended'];
  var SOURCE = ['record_problem', 'manual'];
  function fail(message) { throw new Error(message); }
  function plain(value) { return !!value && typeof value === 'object' && !Array.isArray(value) && [null, Object.prototype].indexOf(Object.getPrototypeOf(value)) >= 0; }
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('回顾日期无效');
    var stamp = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) fail('回顾日期无效');
    return stamp;
  }
  function iso(value, label) {
    if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail(label || '回顾时间无效');
  }
  function id(value, prefix, label) {
    if (typeof value !== 'string' || !new RegExp('^' + prefix + '[A-Za-z0-9_-]{3,80}$').test(value)) fail(label || '回顾ID无效');
  }
  function text(value, max, label, required) {
    if (typeof value !== 'string' || value.length > max || required && !value.trim()) fail(label + '无效');
  }
  function queue(state) { if (!state.reviewQueue) state.reviewQueue = { items: [] }; return state.reviewQueue; }
  function itemKey(item) {
    var source = item.source || {};
    return [source.kind, source.date, source.subjectId || '', item.prompt.trim()].join('|');
  }
  function newId() { return 'review_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); }
  function eventId() { return 'review_event_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); }
  function validateSource(source, subjects) {
    if (!plain(source)) fail('回顾来源无效');
    var keys = Object.keys(source), allowed = ['kind', 'date', 'subjectId', 'recordDate'];
    if (keys.some(function (key) { return allowed.indexOf(key) < 0; }) || !own(source, 'kind') || !own(source, 'date') || !own(source, 'subjectId') || !own(source, 'recordDate')) fail('回顾来源格式无效');
    if (SOURCE.indexOf(source.kind) < 0) fail('回顾来源类型无效');
    date(source.date); if (source.recordDate !== null) date(source.recordDate);
    if (source.subjectId !== null && (typeof source.subjectId !== 'string' || subjects && !subjects.has(source.subjectId))) fail('回顾来源科目无效');
    if (source.kind === 'record_problem' && source.recordDate === null) fail('记录问题缺少来源日期');
  }
  function validateEvent(event, index) {
    var path = '回顾事件' + index;
    if (!plain(event) || Object.keys(event).sort().join(',') !== 'at,feedback,id,nextDate,note') fail(path + '格式无效');
    id(event.id, 'review_event_', path + 'ID');
    if (FEEDBACK.indexOf(event.feedback) < 0) fail(path + '反馈无效');
    iso(event.at, path + '时间');
    if (event.nextDate !== null) date(event.nextDate);
    text(event.note, 2000, path + '备注', false);
  }
  function validate(state) {
    if (!state.reviewQueue) return true;
    var value = state.reviewQueue;
    if (!plain(value) || Object.keys(value).some(function (key) { return key !== 'items'; }) || !Array.isArray(value.items) || value.items.length > 10000) fail('问题回顾队列无效');
    var subjects = new Set((state.plan && state.plan.subjects || []).map(function (subject) { return subject.id; })), seen = new Set();
    value.items.forEach(function (item, index) {
      if (!plain(item) || Object.keys(item).sort().join(',') !== 'createdAt,events,id,nextDate,prompt,source,status,updatedAt') fail('回顾项目格式无效');
      id(item.id, 'review_', '回顾项目ID'); if (seen.has(item.id)) fail('回顾项目ID重复'); seen.add(item.id);
      validateSource(item.source, subjects); text(item.prompt, 8000, '回顾问题', true); if (item.nextDate !== null) date(item.nextDate); if (STATUS.indexOf(item.status) < 0) fail('回顾项目状态无效');
      iso(item.createdAt, '回顾创建时间'); iso(item.updatedAt, '回顾更新时间');
      if (!Array.isArray(item.events) || item.events.length > 200) fail('回顾事件过多');
      var eventIds = new Set(); item.events.forEach(function (event, eventIndex) { validateEvent(event, eventIndex); if (eventIds.has(event.id)) fail('回顾事件ID重复'); eventIds.add(event.id); });
    });
    return true;
  }
  function ensure(state) { if (!state.reviewQueue) state.reviewQueue = { items: [] }; validate(state); return state.reviewQueue; }
  function all(state) { ensure(state); return state.reviewQueue.items.map(copy); }
  function find(state, itemId) { ensure(state); var item = state.reviewQueue.items.find(function (value) { return value.id === itemId; }); if (!item) fail('回顾项目不存在'); return item; }
  function create(state, input, at) {
    at = at || new Date().toISOString(); iso(at, '回顾创建时间');
    if (!plain(input)) fail('回顾项目输入无效');
    var source = input.source || { kind: 'manual', date: input.nextDate || at.slice(0, 10), subjectId: input.subjectId || null, recordDate: null };
    var prompt = String(input.prompt == null ? '' : input.prompt).trim(); text(prompt, 8000, '回顾问题', true);
    var value = { source: { kind: source.kind, date: source.date, subjectId: source.subjectId == null || source.subjectId === '' ? null : source.subjectId, recordDate: source.recordDate == null || source.recordDate === '' ? null : source.recordDate }, prompt: prompt, nextDate: input.nextDate == null || input.nextDate === '' ? source.date : input.nextDate };
    var q = ensure(state), duplicate = q.items.find(function (item) { return item.status !== 'ended' && itemKey(item) === itemKey(value); });
    if (duplicate) return { item: copy(duplicate), created: false };
    date(value.nextDate); validateSource(value.source, new Set(state.plan.subjects.map(function (subject) { return subject.id; })));
    var item = { id: newId(), source: value.source, prompt: value.prompt, nextDate: value.nextDate, status: 'open', createdAt: at, updatedAt: at, events: [] };
    q.items.push(item); validate(state); return { item: copy(item), created: true };
  }
  function addFromRecord(state, recordDate, subjectId, prompt, at) {
    date(recordDate); return create(state, { source: { kind: 'record_problem', date: recordDate, recordDate: recordDate, subjectId: subjectId || null }, prompt: prompt, nextDate: recordDate }, at);
  }
  function reschedule(state, itemId, nextDate, at, note) {
    at = at || new Date().toISOString(); iso(at, '回顾更新时间'); date(nextDate); var item = find(state, itemId); item.nextDate = nextDate; item.status = item.status === 'ended' ? 'ended' : 'open'; item.updatedAt = at;
    if (note) item.events.push({ id: eventId(), feedback: 'uncertain', nextDate: nextDate, note: String(note).slice(0, 2000), at: at });
    validate(state); return copy(item);
  }
  function recordEvent(state, itemId, input, at) {
    at = at || new Date().toISOString(); iso(at, '回顾事件时间'); input = input || {};
    var item = find(state, itemId), nextDate = input.nextDate == null || input.nextDate === '' ? null : input.nextDate;
    if (nextDate !== null) date(nextDate); if (FEEDBACK.indexOf(input.feedback) < 0) fail('回顾反馈无效');
    text(String(input.note == null ? '' : input.note), 2000, '回顾备注', false);
    var event = { id: eventId(), feedback: input.feedback, nextDate: nextDate, note: String(input.note == null ? '' : input.note), at: at };
    item.events.push(event); if (item.events.length > 200) item.events = item.events.slice(-200); item.nextDate = nextDate; item.status = nextDate === null ? 'ended' : 'open'; item.updatedAt = at; validate(state); return copy(item);
  }
  function setStatus(state, itemId, status, at) { at = at || new Date().toISOString(); iso(at, '回顾更新时间'); if (['open', 'paused', 'ended'].indexOf(status) < 0) fail('回顾项目状态无效'); var item = find(state, itemId); item.status = status; item.updatedAt = at; validate(state); return copy(item); }
  function pause(state, itemId, at) { return setStatus(state, itemId, 'paused', at); }
  function resume(state, itemId, at) { return setStatus(state, itemId, 'open', at); }
  function end(state, itemId, at) { return setStatus(state, itemId, 'ended', at); }
  function due(state, day) { date(day); return all(state).filter(function (item) { return item.status === 'open' && item.nextDate <= day; }); }
  function counts(state, day) { var items = all(state), dueItems = day ? due(state, day) : []; return { total: items.length, open: items.filter(function (item) { return item.status === 'open'; }).length, paused: items.filter(function (item) { return item.status === 'paused'; }).length, ended: items.filter(function (item) { return item.status === 'ended'; }).length, due: dueItems.length }; }
  return Object.freeze({ validate: validate, all: all, find: find, create: create, addFromRecord: addFromRecord, recordEvent: recordEvent, reschedule: reschedule, pause: pause, resume: resume, end: end, due: due, counts: counts });
});
