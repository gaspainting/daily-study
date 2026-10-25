(function (root, factory) {
  'use strict';
  var log = factory();
  if (typeof module === 'object' && module.exports) module.exports = log;
  root.StudyWordLog = log;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var fields = { new: 'newWords', review: 'reviewWords' };
  var copy = function (value) { return JSON.parse(JSON.stringify(value)); };
  function fail(message) { throw new Error(message); }
  function keys(value, required, optional) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('单词明细格式无效');
    if (required.some(function (k) { return !Object.prototype.hasOwnProperty.call(value, k); }) || Object.keys(value).some(function (k) { return !required.includes(k) && !optional.includes(k); })) fail('单词明细字段无效');
  }
  function count(value, nullable) {
    if (nullable && value === null) return;
    if (!Number.isInteger(value) || value < 0 || value > 100000) fail('单词数量须为 0 至 100000 的整数');
  }
  function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) fail('单词记录时间无效');
    var day = value.slice(0, 10), time = Date.parse(day + 'T00:00:00Z');
    if (day < '1900-01-01' || day > '2100-12-31' || new Date(time).toISOString().slice(0, 10) !== day) fail('单词记录日期无效');
  }
  function totals(log) {
    keys(log, ['base', 'entries'], []); keys(log.base, ['newWords', 'reviewWords'], []);
    count(log.base.newWords, true); count(log.base.reviewWords, true);
    if (!Array.isArray(log.entries) || log.entries.length > 1000) fail('每天每科最多记录 1000 条单词明细');
    var result = copy(log.base), seen = new Set();
    log.entries.forEach(function (entry) {
      keys(entry, ['id', 'kind', 'operation', 'count', 'at', 'source'], ['editedAt']);
      if (typeof entry.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(entry.id) || seen.has(entry.id)) fail('单词明细标识无效或重复');
      seen.add(entry.id);
      if (!Object.prototype.hasOwnProperty.call(fields, entry.kind) || !['add', 'set'].includes(entry.operation) || !['quick', 'manual'].includes(entry.source)) fail('单词明细类型无效');
      timestamp(entry.at); if (entry.editedAt !== undefined) timestamp(entry.editedAt);
      count(entry.count, entry.operation === 'set');
      if (entry.operation === 'add' && entry.count < 1 || entry.source === 'quick' && entry.operation !== 'add') fail('单词累加数量须大于 0');
      var field = fields[entry.kind];
      result[field] = entry.operation === 'set' ? entry.count : (result[field] === null ? 0 : result[field]) + entry.count;
      count(result[field], true);
    });
    return result;
  }
  function validate(log, record) {
    var sum = totals(log);
    if (record && (sum.newWords !== record.newWords || sum.reviewWords !== record.reviewWords)) fail('单词明细与每日总数不一致');
    return true;
  }
  function from(record) {
    return record.wordLog ? (validate(record.wordLog, record), copy(record.wordLog)) : {base: {newWords: record.newWords ?? null, reviewWords: record.reviewWords ?? null}, entries: []};
  }
  function append(log, entry) {
    var next = copy(log); next.entries.push(copy(entry)); totals(next); return next;
  }
  // Coalesce only an unsaved total edit; saved events and genuine additions
  // remain separate. Array order defines replay order even at equal timestamps.
  function setTotal(log, kind, value, id, at, savedIds) {
    var field = fields[kind]; if (!field) fail('单词类别无效'); count(value, true); totals(log);
    if (totals(log)[field] === value) return copy(log);
    var next = copy(log), previous;
    for (var i = next.entries.length - 1; i >= 0; i--) {
      var entry = next.entries[i]; if (entry.kind !== kind) continue;
      if (entry.operation === 'set' && entry.source === 'manual' && !(savedIds || []).includes(entry.id)) previous = next.entries.splice(i, 1)[0];
      break;
    }
    if (totals(next)[field] === value) return next;
    return append(next, {id: previous ? previous.id : id, kind: kind, operation: 'set', count: value, at: previous ? previous.at : at, source: 'manual'});
  }
  function edit(log, id, value, at) {
    var next = copy(log), entry = next.entries.find(function (e) { return e.id === id; });
    if (!entry) fail('这条单词明细已不存在');
    if (entry.count === value) return next;
    entry.count = value; entry.editedAt = at; totals(next); return next;
  }
  function remove(log, id) {
    var next = copy(log), index = next.entries.findIndex(function (e) { return e.id === id; });
    if (index < 0) fail('这条单词明细已不存在');
    next.entries.splice(index, 1); totals(next); return next;
  }
  function apply(record, log) {
    var result = copy(record), sum = totals(log);
    result.newWords = sum.newWords; result.reviewWords = sum.reviewWords; result.wordLog = copy(log); return result;
  }
  return Object.freeze({totals: totals, validate: validate, from: from, append: append, setTotal: setTotal, edit: edit, remove: remove, apply: apply});
});
