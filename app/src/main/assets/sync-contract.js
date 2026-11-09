(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.StudySyncContract = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var PROTOCOL_VERSION = 1, TYPES = ['plan', 'record', 'task', 'review', 'evaluation', 'reminder'], OPS = ['upsert', 'delete'];
  var copy = function (v) { return JSON.parse(JSON.stringify(v)); };
  function fail(message) { throw new Error(message); }
  function date(value, label) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(label + '无效'); var t = Date.parse(value + 'T00:00:00Z'); if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== value) fail(label + '无效'); }
  function stamp(value, label) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail(label + '无效'); }
  function text(value, max, label) { if (typeof value !== 'string' || !value || value.length > max) fail(label + '无效'); }
  function stableId(type, planId, key) { text(type, 32, '实体类型'); text(planId, 128, '计划ID'); text(String(key), 256, '实体键'); if (TYPES.indexOf(type) < 0) fail('实体类型不支持'); return type + ':' + planId + ':' + key; }
  function validate(envelope) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) fail('同步信封无效');
    var required = ['protocolVersion', 'eventId', 'entityType', 'entityId', 'operation', 'baseRevision', 'entityRevision', 'originDeviceId', 'deviceSequence', 'clientMutationId', 'occurredAtUtc', 'timeZone', 'schemaVersion', 'payload'];
    if (Object.keys(envelope).some(function (key) { return required.indexOf(key) < 0; }) || required.some(function (key) { return !Object.prototype.hasOwnProperty.call(envelope, key); })) fail('同步信封字段无效');
    if (envelope.protocolVersion !== PROTOCOL_VERSION || envelope.schemaVersion !== 1) fail('同步协议版本不支持');
    text(envelope.eventId, 128, '事件ID'); text(envelope.entityId, 256, '实体ID'); text(envelope.originDeviceId, 64, '设备ID'); text(envelope.clientMutationId, 128, '客户端变更ID'); text(envelope.timeZone, 64, '时区');
    if (TYPES.indexOf(envelope.entityType) < 0 || OPS.indexOf(envelope.operation) < 0) fail('同步操作不支持');
    ['baseRevision', 'entityRevision', 'deviceSequence'].forEach(function (key) { if (!Number.isInteger(envelope[key]) || envelope[key] < 0) fail('同步修订号无效'); });
    stamp(envelope.occurredAtUtc, '发生时间'); if (!envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) fail('同步载荷无效'); return true;
  }
  function envelope(input) { var value = Object.assign({ protocolVersion: PROTOCOL_VERSION, schemaVersion: 1 }, copy(input)); validate(value); return value; }
  function dedupeKey(value) { validate(value); return value.eventId + '|' + value.clientMutationId; }
  function compareConflict(currentRevision, incoming) { validate(incoming); if (incoming.baseRevision === currentRevision) return { kind: 'apply' }; return { kind: 'conflict', baseRevision: incoming.baseRevision, currentRevision: currentRevision, entityId: incoming.entityId }; }
  return Object.freeze({ protocolVersion: PROTOCOL_VERSION, stableId: stableId, validate: validate, envelope: envelope, dedupeKey: dedupeKey, compareConflict: compareConflict });
});
