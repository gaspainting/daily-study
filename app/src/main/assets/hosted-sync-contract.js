(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.StudyHostedSyncContract = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var PROTOCOL_VERSION = 1;
  var SCHEMA_VERSION = 9;
  var TYPES = ['plan', 'record', 'task', 'review', 'evaluation', 'reminder'];
  var COMMANDS = Object.freeze({
    plan: ['upsert_plan', 'delete_plan'],
    record: ['upsert_record', 'delete_record'],
    task: ['upsert_task', 'delete_task'],
    review: ['upsert_review', 'delete_review'],
    evaluation: ['upsert_evaluation', 'delete_evaluation'],
    reminder: ['upsert_reminder', 'cancel_reminder']
  });
  var STATUSES = ['local_saved', 'pending_upload', 'cloud_confirmed', 'device_applied', 'conflict', 'offline', 'session_invalid', 'device_revoked', 'error'];
  var copy = function (v) { return JSON.parse(JSON.stringify(v)); };
  function fail(message) { throw new Error(message); }
  function text(value, max, label) { if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(label + '无效'); }
  function id(value, label) { text(value, 128, label); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) fail(label + '无效'); }
  function stamp(value, label) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail(label + '无效'); }
  function number(value, label) { if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) fail(label + '无效'); }
  function payload(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('同步载荷无效'); }
  function stableId(entityType, planId, key) {
    if (TYPES.indexOf(entityType) < 0) fail('实体类型不支持');
    text(planId, 128, '计划ID'); text(String(key), 256, '实体键');
    return entityType + ':' + planId + ':' + key;
  }
  function commandAllowed(entityType, command) { return Array.isArray(COMMANDS[entityType]) && COMMANDS[entityType].indexOf(command) >= 0; }
  function validateOperation(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('同步操作无效');
    var required = ['protocolVersion', 'workspaceId', 'deviceId', 'clientInstanceId', 'operationId', 'entityType', 'entityId', 'command', 'baseServerRevision', 'schemaVersion', 'occurredAtUtc', 'businessTimeZone', 'payload'];
    var keys = Object.keys(value);
    if (keys.some(function (key) { return required.indexOf(key) < 0; }) || required.some(function (key) { return !Object.prototype.hasOwnProperty.call(value, key); })) fail('同步操作字段无效');
    if (value.protocolVersion !== PROTOCOL_VERSION || value.schemaVersion !== SCHEMA_VERSION) fail('同步协议版本不支持');
    id(value.workspaceId, '工作区ID'); id(value.deviceId, '设备ID'); id(value.clientInstanceId, '客户端实例ID'); id(value.operationId, '操作ID');
    text(value.entityId, 384, '实体ID'); text(value.businessTimeZone, 64, '业务时区');
    if (TYPES.indexOf(value.entityType) < 0 || !commandAllowed(value.entityType, value.command)) fail('同步命令不支持');
    number(value.baseServerRevision, '服务端修订号'); stamp(value.occurredAtUtc, '发生时间'); payload(value.payload); return true;
  }
  function operation(input) {
    var value = Object.assign({ protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION }, copy(input));
    validateOperation(value); return value;
  }
  function dedupeKey(value) { validateOperation(value); return value.clientInstanceId + '|' + value.operationId; }
  function compareConflict(currentRevision, incoming) {
    validateOperation(incoming); number(currentRevision, '当前服务端修订号');
    if (incoming.baseServerRevision === currentRevision) return { kind: 'apply' };
    return { kind: 'conflict', baseServerRevision: incoming.baseServerRevision, currentServerRevision: currentRevision, entityId: incoming.entityId };
  }
  function status(value) { if (STATUSES.indexOf(value) < 0) fail('同步状态不支持'); return value; }
  function commands() { return copy(COMMANDS); }
  return Object.freeze({ protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION, entityTypes: TYPES.slice(), statuses: STATUSES.slice(), commands: commands, stableId: stableId, validate: validateOperation, operation: operation, dedupeKey: dedupeKey, compareConflict: compareConflict, status: status });
});
