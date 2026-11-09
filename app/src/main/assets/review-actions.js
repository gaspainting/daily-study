(function (root, factory) {
  'use strict';
  var api = factory(root.StudyTasks || (typeof module === 'object' && module.exports ? require('./task-model.js') : null), root.StudyReviewQueue || (typeof module === 'object' && module.exports ? require('./review-queue.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.StudyReviewActions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (tasks, reviews) {
  'use strict';
  var DAY = 86400000, TYPES = ['reschedule_task', 'schedule_review', 'review_target'];
  var copy = function (v) { return JSON.parse(JSON.stringify(v)); };
  function fail(message) { throw new Error(message); }
  function date(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('行动日期无效'); var t = Date.parse(value + 'T00:00:00Z'); if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== value) fail('行动日期无效'); return t; }
  function stamp(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail('行动时间无效'); }
  function plain(value) { return !!value && typeof value === 'object' && !Array.isArray(value) && [null, Object.prototype].indexOf(Object.getPrototypeOf(value)) >= 0; }
  function nextWeek(start) { return new Date(date(start) + 7 * DAY).toISOString().slice(0, 10); }
  function end(start) { return new Date(date(start) + 6 * DAY).toISOString().slice(0, 10); }
  function id(prefix) { return prefix + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9); }
  function planMap(state) { if (!state.actionPlans) state.actionPlans = {}; return state.actionPlans; }
  function validateMetrics(metrics) {
    var keys = ['dueReviews', 'pendingTasks', 'planAdherence', 'recordCompleteness', 'recordedDays', 'targetDeviationMinutes', 'totalDays'];
    if (!plain(metrics) || Object.keys(metrics).sort().join(',') !== keys.join(',')) fail('复盘指标格式无效');
    ['planAdherence', 'recordCompleteness'].forEach(function (key) { if (typeof metrics[key] !== 'number' || metrics[key] < 0 || metrics[key] > 1) fail('复盘比例无效'); });
    ['dueReviews', 'pendingTasks', 'recordedDays', 'totalDays'].forEach(function (key) { if (!Number.isInteger(metrics[key]) || metrics[key] < 0 || metrics[key] > 10000) fail('复盘计数无效'); });
    if (typeof metrics.targetDeviationMinutes !== 'number' || !Number.isFinite(metrics.targetDeviationMinutes) || Math.abs(metrics.targetDeviationMinutes) > 1000000) fail('目标偏差无效');
  }
  function validate(state) {
    if (!state.actionPlans) return true;
    var map = state.actionPlans; if (!plain(map) || Object.keys(map).length > 1000) fail('行动方案无效');
    Object.keys(map).forEach(function (key) {
      date(key); var plan = map[key];
      if (!plain(plan) || Object.keys(plan).sort().join(',') !== 'actions,generatedAt,id,metrics,scope,sourceWeek,status,targetWeek') fail('行动方案格式无效');
      if (typeof plan.id !== 'string' || !/^action_[A-Za-z0-9_-]{3,80}$/.test(plan.id)) fail('行动方案ID无效'); date(plan.sourceWeek); date(plan.targetWeek); stamp(plan.generatedAt);
      if (!plain(plan.scope) || Object.keys(plan.scope).sort().join(',') !== 'from,to') fail('行动范围无效'); date(plan.scope.from); date(plan.scope.to); if (plan.scope.to < plan.scope.from) fail('行动范围无效');
      validateMetrics(plan.metrics); if (['draft', 'confirmed'].indexOf(plan.status) < 0) fail('行动方案状态无效');
      if (!Array.isArray(plan.actions) || plan.actions.length > 100) fail('行动项目过多');
      var seen = new Set(); plan.actions.forEach(function (action) {
        if (!plain(action) || Object.keys(action).sort().join(',') !== 'confirmedAt,createdAt,id,payload,refId,status,title,type') fail('行动项目格式无效');
        if (typeof action.id !== 'string' || !/^action_item_[A-Za-z0-9_-]{3,80}$/.test(action.id) || seen.has(action.id)) fail('行动项目ID无效或重复'); seen.add(action.id);
        if (TYPES.indexOf(action.type) < 0 || typeof action.refId !== 'string' || action.refId.length > 128 || typeof action.title !== 'string' || !action.title.trim() || action.title.length > 500) fail('行动项目内容无效');
        if (!plain(action.payload) || Object.keys(action.payload).some(function (key) { return ['fromDate', 'targetDate', 'reason'].indexOf(key) < 0; })) fail('行动参数无效');
        if (action.payload.targetDate != null) date(action.payload.targetDate); if (action.payload.fromDate != null) date(action.payload.fromDate); if (action.payload.reason != null && (typeof action.payload.reason !== 'string' || action.payload.reason.length > 1000)) fail('行动理由无效');
        if (['pending', 'confirmed', 'dismissed'].indexOf(action.status) < 0) fail('行动状态无效'); stamp(action.createdAt); if (action.confirmedAt !== null) stamp(action.confirmedAt);
      });
    }); return true;
  }
  function metrics(state, sourceWeek) {
    var stats = state.__reviewStats || null;
    if (!stats && typeof state.weekStats === 'function') stats = state.weekStats(sourceWeek);
    var start = sourceWeek, finish = end(sourceWeek), days = [], cursor = date(start); for (var i = 0; i < 7; i++) days.push(new Date(cursor + i * DAY).toISOString().slice(0, 10));
    var records = days.filter(function (day) { return state.records[day] && (state.records[day].status !== null || state.records[day].note || Object.values(state.records[day].subjects || {}).some(function (v) { return v.minutes != null || v.quantity != null || v.newWords != null || v.reviewWords != null; })); });
    var totalReference = 0, totalActual = 0; (stats && stats.subjects || []).forEach(function (subject) { if (subject.measure !== 'quantity' && subject.kind !== 'vocab') { totalReference += subject.reference || 0; if (subject.actual != null) totalActual += subject.actual; } });
    var pending = tasks ? tasks.pending(state.plan, finish).filter(function (task) { return task.scheduledDate >= start && task.scheduledDate <= finish; }) : [];
    var due = reviews ? reviews.due(state, finish) : [];
    var totalDays = stats && stats.totalDays || 7, recordedDays = stats && stats.recordedDays || records.length;
    return { planAdherence: totalReference ? Math.max(0, Math.min(1, totalActual / totalReference)) : 0, recordCompleteness: totalDays ? recordedDays / totalDays : 0, recordedDays: recordedDays, totalDays: totalDays, targetDeviationMinutes: totalActual - totalReference, pendingTasks: pending.length, dueReviews: due.length };
  }
  function generate(state, sourceWeek, suppliedStats, at) {
    date(sourceWeek); at = at || new Date().toISOString(); stamp(at); var map = planMap(state), old = map[sourceWeek]; if (old && old.status === 'confirmed') return copy(old);
    if (suppliedStats) state.__reviewStats = suppliedStats;
    var m = metrics(state, sourceWeek), target = nextWeek(sourceWeek); if (target > state.plan.endDate) target = sourceWeek; var actions = [], pending = tasks ? tasks.pending(state.plan, end(sourceWeek)).filter(function (task) { return task.scheduledDate >= sourceWeek && task.scheduledDate <= end(sourceWeek); }) : [], due = reviews ? reviews.due(state, end(sourceWeek)) : [];
    pending.slice(0, 10).forEach(function (task) { actions.push({ id: id('action_item_'), type: 'reschedule_task', refId: task.id, title: '安排未完成任务：' + task.title, payload: { fromDate: task.scheduledDate, targetDate: target, reason: '周复盘建议延期' }, status: 'pending', createdAt: at, confirmedAt: null }); });
    due.slice(0, 10).forEach(function (item) { actions.push({ id: id('action_item_'), type: 'schedule_review', refId: item.id, title: '安排问题回顾：' + item.prompt, payload: { fromDate: item.nextDate, targetDate: target, reason: '周复盘建议继续回顾' }, status: 'pending', createdAt: at, confirmedAt: null }); });
    if (m.recordCompleteness < 1 || m.planAdherence < 0.8) actions.push({ id: id('action_item_'), type: 'review_target', refId: sourceWeek, title: '检查下一周目标与记录安排', payload: { fromDate: sourceWeek, targetDate: target, reason: '本周记录完整率或目标执行率偏低' }, status: 'pending', createdAt: at, confirmedAt: null });
    var plan = { id: id('action_'), sourceWeek: sourceWeek, targetWeek: target, generatedAt: at, scope: { from: sourceWeek, to: end(sourceWeek) }, metrics: m, actions: actions, status: 'draft' }; map[sourceWeek] = plan; delete state.__reviewStats; validate(state); return copy(plan);
  }
  function get(state, sourceWeek) { planMap(state); return state.actionPlans[sourceWeek] ? copy(state.actionPlans[sourceWeek]) : null; }
  function mutate(state, sourceWeek, actionId, status, at) {
    at = at || new Date().toISOString(); stamp(at); var plan = planMap(state)[sourceWeek]; if (!plan) fail('本周还没有行动方案'); var action = plan.actions.find(function (value) { return value.id === actionId; }); if (!action) fail('行动项目不存在');
    if (status === 'confirmed') {
      if (action.type === 'reschedule_task' && tasks) tasks.reschedule(state.plan, action.refId, action.payload.targetDate, null, at, action.payload.reason);
      if (action.type === 'schedule_review' && reviews) reviews.reschedule(state, action.refId, action.payload.targetDate, at, action.payload.reason);
      action.confirmedAt = at;
    }
    action.status = status; if (status === 'confirmed') plan.status = 'confirmed'; validate(state); return copy(plan);
  }
  return Object.freeze({ validate: validate, metrics: metrics, generate: generate, get: get, confirm: function (state, week, id, at) { return mutate(state, week, id, 'confirmed', at); }, dismiss: function (state, week, id, at) { return mutate(state, week, id, 'dismissed', at); } });
});
