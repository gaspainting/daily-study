/* Offline UI. Native is the only production persistence/timing authority. */
(function () {
  'use strict';
  const app = document.getElementById('app');
  const dialog = document.getElementById('sheet');
  const dirty = new Set();
  const saving = new Set(), feedback = new Map();
  const wordUndo = new WeakMap();
  let dispatchingWordChange = false;
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const monDays = ['一', '二', '三', '四', '五', '六', '日'];
  const statuses = ['正常参考', '减量', '仅回顾', '休息'];
  let bridge, state, route = 'today', selectedDate, planDate, reviewDate;
  let courseContext=null,courseViewDate=null;
  let initialDaily = null, lastTimer = { active: false }, timerSignature = '';
  let nativeRefreshPending = false, toastTimeout, booted = false;
  let currentDraftKey = null, activePlanId = 'main', historyFilters = {}, sessionFilters = {}, month = '';
  let preview = !window.Native;
  let startupUpdatePending = false, startupUpdatePoll, foregroundUpdatePoll, updateOrigin = 'about';
  const clone = value => JSON.parse(JSON.stringify(value));
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  const M = () => window.StudyModel;
  const R = () => window.StudyReference;
  const iso = date => date?M().today(date):state?.evaluation?window.StudyEvaluation.context(state.evaluation.timezone).today:M().today(new Date());
  const localDate = date => new Date(date + 'T12:00:00');
  const shift = (date, count) => { const d = localDate(date); d.setDate(d.getDate() + count); return iso(d); };
  const within = date => date >= state.plan.startDate && date <= state.plan.endDate;
  const minuteLabel = value => value === null || value === undefined ? '未记录' : value > 0 && value < 1 ? '不足1' : String(Math.round(value * 10) / 10);
  const briefDate = date => date.slice(5).replace('-', '.');
  const fullDate = date => date.replaceAll('-', '.');
  const statusLabel = status => status === '正常参考' ? '照常' : status;
  const isQuantity = subject => subject?.measure === 'quantity';
  const restReason = () => { const d = new Date(); return d.getDay() === 0 || d.getDay() === 6 ? (d.getHours() * 60 + d.getMinutes() < 570 ? '09:30 前为休息时段' : '19:00 起为休息时段') : '20:30 起为休息时段'; };
  const recordCount = record => state.plan.subjects.filter(s => record && (isQuantity(s) ? record.subjects[s.id]?.quantity != null : record.subjects[s.id]?.minutes != null || s.kind === 'vocab' && (record.subjects[s.id]?.newWords != null || record.subjects[s.id]?.reviewWords != null))).length;
  const weekOf = date => M().weekInfo(state.plan, date);
  const meaningful = record => !!record && (record.status != null || record.restKept != null || !!record.note || Object.values(record.subjects || {}).some(s => s.minutes != null || s.quantity != null || s.content || s.problem || s.newWords != null || s.reviewWords != null || s.forgotWords || s.wordLog?.entries.length));
  const actualTotal = record => { const values = Object.values(record && record.subjects || {}).filter(s => s.minutes != null).map(s => s.minutes); return values.length ? values.reduce((a, b) => a + b, 0) : null; };
  const visibleSubjects = date => {const required=new Set((state.evaluation?.bases[date]?.items||[]).filter(i=>i.required).flatMap(i=>i.sources.filter(s=>s.requiredInput).map(s=>s.subjectId)));return state.plan.subjects.filter(s => M().subjectActive(s,date)||required.has(s.id)||meaningful({subjects:{[s.id]:state.records[date]?.subjects?.[s.id]||{}}}));};
  const refTotal = date => within(date)?R().total(state,date):null;
  const clampPlanDate = date => date < state.plan.startDate ? state.plan.startDate : date > state.plan.endDate ? state.plan.endDate : date;

  function tell(message) {
    clearTimeout(toastTimeout);
    const element = document.getElementById('toast');
    element.textContent = String(message);
    element.hidden = false;
    toastTimeout = setTimeout(() => { element.hidden = true; }, 3800);
  }
  function decode(result) {
    if (typeof result === 'string') { try { return JSON.parse(result); } catch (_) { throw new Error('本地数据返回异常，请重新打开 APP。'); } }
    return result;
  }
  function call(name, ...args) {
    const result = decode(bridge[name](...args));
    if (result && result.error) throw new Error(result.error);
    return result;
  }
  function readState() { return M().migrateState(call('getState')); }
  function completeDraft() { if (currentDraftKey) { try { window.StudyDrafts.removeKey(currentDraftKey); } catch (_) {} } }
  function persist(latest) {
    M().validateState(latest);
    if (JSON.stringify(latest) === JSON.stringify(state)) { completeDraft(); return latest; }
    const result = call('saveState', JSON.stringify(latest));
    if (!result || !result.ok) throw new Error('保存没有完成，请重试。');
    if (result.revision !== undefined) latest._revision = result.revision;
    state = result.state||readState();
    M().validateState(state);
    completeDraft();
    nativeRefreshPending = false;
    return state;
  }
  function attempt(action) { try { return action(); } catch (error) { tell(error.message || '操作未完成，请重试。'); return false; } }
  function syncFeedback(form) {
    if (!form) return;
    if(form.id==='daily-form'){
      const panel=document.querySelector('.daily-assessment');
      if(panel){panel.querySelector('.assessment-pending').hidden=!dirty.has('daily');panel.querySelector('.assessment-results').hidden=dirty.has('daily');}
    }
    let element = form.querySelector('.save-feedback');
    if (!element) { element = document.createElement('div'); element.className = 'save-feedback'; const row = form.querySelector('.save-row') || form.querySelector('[type="submit"]'); if (row) row.after(element); else form.append(element); }
    const item = feedback.get(form.dataset.dirty);
    element.hidden = !item;
    element.setAttribute('role', item?.kind === 'error' ? 'alert' : 'status');
    window.StudyLayout?.sync();
    element.innerHTML = item ? '<span>' + escape(item.message) + '</span>' + (item.kind === 'error' ? '<button class="text-button" type="button" data-action="retry-save" data-form="' + escape(form.id) + '">重试</button>' : '') : '';
    if(form.id==='daily-form'){const inside=form.querySelector('.layout-editor-feedback');if(inside){inside.hidden=!item;inside.setAttribute('role',item?.kind==='error'?'alert':'status');inside.innerHTML=element.innerHTML;}}
  }
  async function submitForm(form, closeDailyEditor = false) {
    if (!form || saving.has(form.dataset.dirty) || !form.reportValidity()) return false;
    if (window.StudyDrafts.hasContextConflict(form)) { tell(form.dataset.quantityConflict?'请选择数量草稿的处理方式':form.dataset.weekConflict ? '请选择目标冲突的处理方式' : '请先查看或清除其他日期的目标草稿'); return false; }
    const key = form.dataset.dirty, buttons = Array.from(form.querySelectorAll('[type="submit"]')), labels = buttons.map(b => b.innerHTML);
    saving.add(key); buttons.forEach(b => { b.disabled = true; b.textContent = '保存中…'; });
    feedback.set(key, { kind: 'saving', message: '保存中…' }); syncFeedback(form);
    await new Promise(resolve => setTimeout(resolve, 20));
    try {
      currentDraftKey = form.dataset.draftKey;
      let saved = false;
      if (form.id === 'daily-form') saved = saveDaily();
      else if (['timetable-form','course-change-form','course-review-form'].includes(form.id)) saved=saveCourses(form);
      else if (form.id === 'review-form') saved = saveReview(form);
      else if (form.id === 'range-form') saved = saveRange(form);
      else if (form.dataset.weekMode) saved = saveWeek(form);
      else if (form.id === 'week-move-form') saved = moveWeek(form);
      else if (form.dataset.subjectEdit) saved = saveSubject(form);
      else if (form.id === 'allocation-form') saved = saveAllocation(form);
      else if (form.id === 'evaluation-schedule-form') saved = saveEvaluationSchedule(form);
      else if (form.id === 'reminder-form') saved = saveReminder(form);
      else if (form.id === 'backup-reminder-form') { call('setBackupReminder', form.elements.namedItem('backup-enabled').checked, Number(form.elements.namedItem('backup-days').value)); completeDraft(); dirty.delete('backup-reminder'); render(); saved = true; }
      else if (['week-form', 'reference-form', 'new-subject-form', 'new-plan-form'].includes(form.id)) saved = saveSheet(form);
      if (saved) { feedback.set(key, { kind: 'saved', message: '已保存' }); syncFeedback(document.getElementById(form.id)); if(form.id==='daily-form'&&closeDailyEditor)window.StudyLayout.closeEditor(); }
      return !!saved;
    } catch (error) {
      feedback.set(key, { kind: 'error', message: '保存失败：' + (error.message || '请重试') });
      dirty.add(key); syncFeedback(document.getElementById(form.id));
      return false;
    } finally {
      currentDraftKey = null;
      saving.delete(key); buttons.forEach((b, i) => { if (b.isConnected) { b.disabled = false; b.innerHTML = labels[i]; } });
    }
  }
  const timeSubjects = (record, date) => visibleSubjects(date).filter(s => !isQuantity(s) && (s.kind !== 'vocab' || record?.subjects?.[s.id]?.minutes != null));
  const timeCaption = (record, date) => timeSubjects(record, date).filter(s => record?.subjects?.[s.id]?.minutes != null).length + '/' + timeSubjects(record, date).length + ' 科目有时长记录';
  function refreshStoredSummary() {
    const value = document.getElementById('daily-total'); if (!value || !state) return;
    const record = M().record(state, selectedDate), total = actualTotal(record);
    value.textContent = minuteLabel(total); value.classList.toggle('is-empty', total == null);
    document.getElementById('daily-unit').hidden = total == null;
    document.getElementById('daily-count').textContent = timeCaption(record, selectedDate);
  }
  function updatePermissionStatus() {
    const target = document.getElementById('notification-status'), input = document.getElementById('reminders-enabled');
    if (!target || !input) return;
    let platform; try { platform = call('getPlatformInfo'); } catch (_) { target.hidden = false; target.textContent = '通知状态读取失败'; return; }
    target.hidden = !input.checked || platform.notificationsGranted !== false;
    target.innerHTML = target.hidden ? '' : '<span>' + (platform.runtimePermissionGranted === false ? '通知权限未开启' : '学习提醒通知已关闭') + '</span><button class="text-button" type="button" data-action="notification-settings">打开通知设置</button>';
  }
  function restHours() { openSheet('休息时段', '<dl class="rest-hours"><dt>工作日</dt><dd>20:30 起</dd><dt>周末</dt><dd>09:30 前、19:00 起</dd></dl><p>正在运行的计时到休息边界自动暂停。</p>', true); }
  function reminderHelp() { openSheet('未收到提醒？', '<p>确认提醒设置已保存，并检查通知权限。</p><p>系统普通提醒可能受省电策略影响而延后。休息时段不补发，延迟超过一小时的提醒略过。</p><button class="secondary-wide" data-action="notification-settings">打开通知设置</button>', true); }
  function widgetHelp(unsupported) { openSheet('添加帮助', (unsupported ? '<p>当前桌面未接受应用内添加请求。</p>' : '') + '<p>长按桌面空白处，打开小组件列表，选择“每日学习”。</p>', true); }
  function showAbout() {
    updateOrigin = 'about';
    const info = call('getAppInfo');
    openSheet('关于', '<h3>每日学习</h3><p class="about-version" data-build-version="' + escape(info.versionName) + '">版本 ' + escape(info.versionName) + '</p><section id="app-update" aria-label="应用更新"></section><button class="text-button" type="button" data-action="licenses">开源许可</button>', true);
    updatePanel();
  }
  function showStartupUpdate() {
    updateOrigin = 'startup';
    window.InspirationUI.dismiss();
    openSheet('应用更新', '<section id="app-update" aria-label="应用更新"></section><button type="button" class="text-button update-later" data-action="close-sheet">稍后</button>', true);
    dialog.classList.add('startup-update-sheet');
    updatePanel();
  }
  function returnToUpdate() { if (updateOrigin === 'startup') showStartupUpdate(); else showAbout(); }
  function updatePanel(update) {
    if (!update) { try { update = decode(bridge.getUpdateState()); } catch (_) { update = { phase: 'error', error: '更新状态读取失败，请重试' }; } }
    const entry = document.getElementById('update-entry');
    const newer = update.candidate && Number(update.candidate.versionCode) > Number(update.currentCode);
    entry.hidden = !newer || !['available', 'downloading', 'ready', 'error'].includes(update.phase);
    entry.textContent = update.phase === 'downloading' ? '正在下载更新' : update.phase === 'ready' ? '安装新版' : '有新版本';
    const panel = document.getElementById('app-update');
    if (!panel) return;
    const focused = panel.contains(document.activeElement) ? document.activeElement.dataset.action : null;
    const candidate = update.candidate || null;
    const button = (action, text, primary = false) => '<button type="button" class="' + (primary ? 'primary' : 'secondary-wide') + '" data-action="update-' + action + '">' + text + '</button>';
    let content = '';
    if (candidate && ['available', 'downloading', 'ready', 'error'].includes(update.phase)) {
      content += '<h3>新版本 ' + escape(candidate.versionName) + '</h3><p class="update-notes">' + escape(candidate.releaseNotes) + '</p>';
    }
    if (update.phase === 'checking') content += '<p role="status">正在检查更新…</p>' + button('cancel', '取消');
    else if (update.phase === 'current') content += '<p role="status">已是最新版本</p>' + button('check', '检查更新');
    else if (update.phase === 'available') content += button('download', '下载更新', true) + button('check', '重新检查');
    else if (update.phase === 'downloading') {
      const total = Number(update.total) || 0, bytes = Number(update.bytes) || 0, percent = total ? Math.min(100, Math.floor(bytes / total * 100)) : 0;
      content += '<label for="update-progress">下载中 ' + percent + '%</label><progress id="update-progress" max="100" value="' + percent + '">' + percent + '%</progress>' + button('cancel', '取消下载');
    } else if (update.phase === 'ready') {
      content += '<p role="status">下载完成</p>';
      if (!update.canInstall) content += '<p class="update-permission">安装权限未开启</p>';
      content += button('install', update.canInstall ? '安装更新' : '开启安装权限', true) + button('check', '重新检查');
    } else if (update.phase === 'error') {
      content += '<p role="alert">' + escape(update.error || '检查更新失败') + '</p>' + button(candidate ? 'download' : 'check', '重试', true) + (candidate ? button('check', '重新检查') : '');
    } else content += button('check', '检查更新');
    panel.innerHTML = content + '<p id="update-action-feedback" role="alert" hidden></p>';
    if (focused) panel.querySelector('[data-action="' + focused + '"]')?.focus({ preventScroll: true });
  }
  function installUpdate() {
    if (dirty.size || saving.size) {
      const message = document.getElementById('update-action-feedback');
      if (message) { message.hidden = false; message.textContent = '页面有未保存的修改，请先保存。'; }
      else tell('页面有未保存的修改，请先保存。');
      return;
    }
    if (call('getTimer').active) {
      openSheet('当前计时尚未保存', '<div class="save-row"><button class="cancel-button" data-action="update-return">取消</button><button class="primary" data-action="update-finish">保存并继续</button><button data-action="update-discard">丢弃本次计时</button></div>', true);
      return;
    }
    call('installUpdate');
  }
  window.onStartupUpdateBackground = () => {
    startupUpdatePending = false;
    clearInterval(startupUpdatePoll);
    clearInterval(foregroundUpdatePoll);
  };
  function startupUpdateChanged() {
    let update;
    try { update = decode(bridge.getUpdateState()); } catch (_) { window.onStartupUpdateBackground(); return; }
    updatePanel(update);
    if (!startupUpdatePending || ['checking', 'downloading'].includes(update.phase)) return;
    window.onStartupUpdateBackground();
    const newer = update.candidate && Number(update.candidate.versionCode) > Number(update.currentCode);
    if (newer && ['available', 'ready'].includes(update.phase) && !document.hidden && !dialog.open && !document.querySelector('.layout-editor[open]') && !dirty.size && !saving.size) showStartupUpdate();
  }
  function checkStartupUpdate() {
    if (preview || typeof bridge.checkStartupUpdate !== 'function') return;
    try {
      if (!decode(bridge.checkStartupUpdate()).started) return;
      startupUpdatePending = true;
      // Poll only this launch check: a previous Activity may own the native callback.
      startupUpdatePoll = setInterval(startupUpdateChanged, 600);
      startupUpdateChanged();
    } catch (_) { window.onStartupUpdateBackground(); }
  }
  window.onAppUpdateChanged = () => { if (bridge) startupUpdateChanged(); };
  function checkForegroundUpdate(){
    if(preview||document.hidden||startupUpdatePending||typeof bridge.checkForegroundUpdate!=='function')return;
    clearInterval(foregroundUpdatePoll);
    const observe=()=>{
      if(document.hidden){clearInterval(foregroundUpdatePoll);return;}
      try{const update=decode(bridge.getUpdateState());updatePanel(update);if(!['checking','downloading'].includes(update.phase))clearInterval(foregroundUpdatePoll);}catch(_){clearInterval(foregroundUpdatePoll);}
    };
    try{call('checkForegroundUpdate');const update=decode(bridge.getUpdateState());updatePanel(update);if(['checking','downloading'].includes(update.phase))foregroundUpdatePoll=setInterval(observe,600);}catch(_){}
  }
  function leaveEdits() {
    if (saving.size) return false;
    if (!dirty.size) { feedback.clear(); return true; }
    if (!window.StudyDrafts.flush() && !window.confirm('草稿未保存。丢弃输入并离开？')) return false;
    feedback.clear();
    dirty.clear();
    if (nativeRefreshPending) state = readState();
    nativeRefreshPending = false;
    return true;
  }
  const scrollPositions=new Map();
  const scrollKey=()=>activePlanId+':'+route+(route==='today'?':'+selectedDate:'');
  function navigate(destination, date) {
    if (destination === route && !date) return;
    const previousScroll=window.scrollY,previousKey=scrollKey();
    if (!attempt(leaveEdits)) return;
    scrollPositions.set(previousKey,previousScroll);
    if (dialog.open) dialog.close();
    dialog.replaceChildren();
    route = destination;
    if (date) selectedDate = date;
    if (route === 'plan') planDate = clampPlanDate(planDate || selectedDate);
    if (route === 'review') reviewDate = clampPlanDate(reviewDate || selectedDate);
    render();
    window.scrollTo({top:scrollPositions.get(scrollKey())||0,behavior:'instant'});
    app.focus({ preventScroll: true });
  }
  function trackingTabs() { return '<div class="tracking-tabs" role="group" aria-label="记录视图">' + [['review', '周复盘'], ['month', '月历'], ['history', '历史'], ['sessions', '计时明细']].map(([id, text]) => '<button data-nav="' + id + '" aria-pressed="' + (route === id) + '">' + text + '</button>').join('') + '</div>'; }
  const trackingHelpers = { escape, minuteLabel, icon };
  function historyView() { return trackingTabs() + window.StudyTracking.renderHistory(state, historyFilters, trackingHelpers); }
  function monthView() { return trackingTabs() + window.StudyTracking.renderMonth(state, month || iso().slice(0, 7), trackingHelpers); }
  function sessionsView() { return trackingTabs() + window.StudyTracking.renderSessions(state, sessionFilters, trackingHelpers); }
  function draftKey(form) {
    if(form.id==='course-review-form')form.dataset.plan=activePlanId;
    let key;
    if (form.id === 'daily-form') key = 'daily:' + selectedDate;
    else if(form.id==='course-review-form')key='courses:'+form.dataset.date;
    else if (form.id === 'review-form') key = 'review:' + weekOf(reviewDate).key;
    else if (form.dataset.weekMode) key = 'week:' + form.dataset.key;
    else if (form.id === 'reference-form') key = 'reference:' + form.elements.namedItem('reference-date').value;
    else if (form.dataset.subjectEdit) key = 'subject:' + form.dataset.subjectEdit;
    else key = form.id;
    return activePlanId + ':' + key;
  }
  function planPicker() {
    const catalog = call('getPlans');
    openSheet('切换计划', '<div class="plan-picker">' + catalog.plans.map(p => '<button class="setting-action" data-action="switch-plan" data-plan="' + escape(p.id) + '"' + (p.id === catalog.activeId ? ' disabled' : '') + '><span>' + escape(p.name) + '</span><span>' + (p.id === catalog.activeId ? '当前' : icon('next')) + '</span></button>').join('') + '</div><button class="secondary-wide" data-action="new-plan">新建计划</button>', true);
  }
  function newPlan() {
    openSheet('新建计划', '<form id="new-plan-form" data-dirty="sheet">' + field('计划名称', 'new-plan-name', '', { required: true, maxLength: 120 }) + field('开始日期', 'new-plan-start', iso(), { type: 'date', required: true, min: '1900-01-01', max: '2100-12-31' }) + field('结束日期', 'new-plan-end', shift(iso(), 69), { type: 'date', required: true, min: '1900-01-01', max: '2100-12-31' }) + '<div class="field"><span class="field-label">科目</span><p>' + escape(state.plan.subjects.filter(s => M().subjectActive(s, iso())).map(s => s.name).join(' / ') || state.plan.subjects[0].name) + '</p></div><button class="primary" type="submit">创建计划</button></form>');
  }
  function switchPlan(id, prepared = false) {
    if (!prepared && !leaveEdits()) return;
    if (call('getTimer').active) { openSheet('当前计时尚未保存', '<div class="save-row"><button data-action="close-sheet">取消</button><button class="primary" data-action="plan-finish" data-plan="' + escape(id) + '">保存并切换</button><button data-action="plan-discard" data-plan="' + escape(id) + '">丢弃本次计时</button></div>', true); return; }
    call('switchPlan', id); activePlanId = id; dirty.clear(); feedback.clear(); state = readState(); selectedDate = iso(); planDate = clampPlanDate(selectedDate); reviewDate = planDate; historyFilters = {}; sessionFilters = {}; closeSheet(true); render();
  }
  function reportForm() {
    const first = localDate((month || iso().slice(0, 7)) + '-01'), last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
    const d = route === 'review' ? weekOf(reviewDate) : route === 'month' ? { start: iso(first), end: iso(last) } : { start: state.plan.startDate, end: state.plan.endDate };
    openSheet('导出学习报表', '<form id="report-form">' + field('开始日期', 'report-from', d.start || d.key, { type: 'date', required: true }) + field('结束日期', 'report-to', d.end, { type: 'date', required: true }) + selectField('科目', 'report-subject', '', [['', '全部科目'], ...state.plan.subjects.map(s => [s.id, s.name])]) + selectField('格式', 'report-format', 'pdf', [['pdf', 'PDF'], ['csv', 'CSV']]) + '<button class="primary" type="submit">导出报表</button></form>', true);
  }
  function field(label, name, value, options = {}) {
    const type = options.type || 'text',controlId=options.id||name;
    const attrs = (options.min !== undefined ? ' min="' + options.min + '"' : '') + (options.max !== undefined ? ' max="' + options.max + '"' : '') + (options.step ? ' step="' + options.step + '"' : '') + (options.required ? ' required' : '') + (options.maxLength ? ' maxlength="' + options.maxLength + '"' : '') + (controlId!==name?' data-draft-field="'+escape(name)+'"':'') + (options.help ? ' aria-describedby="' + escape(controlId) + '-help"' : '');
    return '<div class="field"><label for="' + escape(controlId) + '">' + escape(label) + '</label>' + (options.textarea ? '<textarea id="' + escape(controlId) + '" name="' + escape(name) + '" rows="' + (options.rows || 2) + '"' + attrs + ' placeholder="' + escape(options.placeholder || '') + '">' + escape(value) + '</textarea>' : '<input id="' + escape(controlId) + '" name="' + escape(name) + '" type="' + type + '" value="' + escape(value) + '"' + attrs + (type === 'number' ? ' inputmode="' + (Number(options.step) === 1 ? 'numeric' : 'decimal') + '"' : '') + ' placeholder="' + escape(options.placeholder || '') + '">') + (options.help ? '<small id="' + escape(controlId) + '-help">' + escape(options.help) + '</small>' : '') + '</div>';
  }
  function selectField(label, name, value, values) {
    return '<div class="field"><label for="' + escape(name) + '">' + escape(label) + '</label><select id="' + escape(name) + '" name="' + escape(name) + '">' + values.map(item => '<option value="' + escape(item[0]) + '"' + (String(value) === String(item[0]) ? ' selected' : '') + '>' + escape(item[1]) + '</option>').join('') + '</select></div>';
  }
  function weekNavigation(date, scope) {
    const w = weekOf(date);
    const previous = shift(w.key, -1), next = shift(w.key, 7);
    return '<div class="week-navigation"><button class="icon-button" data-action="week-prev" data-scope="' + scope + '" aria-label="上一周"' + (previous < state.plan.startDate ? ' disabled' : '') + '>' + icon('prev') + '</button><div class="week-label"><strong>第 ' + w.number + ' 教学周 <span class="saved-mark">' + w.parity + '</span></strong><small>' + fullDate(w.start || w.key) + ' — ' + briefDate(w.end) + '</small></div><button class="icon-button" data-action="week-next" data-scope="' + scope + '" aria-label="下一周"' + (next > state.plan.endDate ? ' disabled' : '') + '>' + icon('next') + '</button></div>';
  }
  function vocabEntry(subject, r, index) {
    const id=subject.id,goal=within(selectedDate)?M().wordTarget(state,selectedDate,id):null;
    const quick=(field,label)=>'<div class="word-add-row"><span>'+label+'累加</span>'+M().wordSteps(state,id).map(n=>'<button type="button" data-action="add-words" data-field="'+field+'-'+id+'" data-amount="'+n+'" aria-label="'+escape(subject.name)+' '+label+'增加'+n+'个">+'+n+'</button>').join('')+'<button type="button" class="word-undo" data-action="undo-words" data-field="'+field+'-'+id+'" aria-label="撤销'+escape(subject.name)+'最近一次'+label+'累加" hidden>撤销</button></div>';
    return '<div class="subject-entry word-entry"><div class="subject-heading"><h3><span class="subject-index">'+String(index+1).padStart(2,'0')+'</span>'+escape(subject.name)+'</h3>'+(goal!==null&&M().subjectActive(subject,selectedDate)?'<button type="button" class="reference-pill reference-edit" data-action="edit-reference" data-date="'+selectedDate+'" data-subject="'+escape(id)+'" aria-label="修改'+escape(subject.name)+'新学目标">新学目标 '+goal+' 个</button>':'<span class="reference-pill">'+(!M().subjectActive(subject,selectedDate)?'已归档':'计划范围外')+'</span>')+'</div><div class="field-inline">'+field('新学（个）','newWords-'+id,r.newWords,{type:'number',min:0,max:100000,step:1,placeholder:'未记录'})+field('复习（个）','reviewWords-'+id,r.reviewWords,{type:'number',min:0,max:100000,step:1,placeholder:'未记录'})+'</div>'+quick('newWords','新学')+quick('reviewWords','复习')+'<span class="visually-hidden" role="status" aria-live="polite" data-word-feedback></span>'+window.StudyWordLogUI.view(subject,r,escape)+'<details class="details-toggle"'+(r.content||r.forgotWords?' open':'')+'><summary>内容与易忘词</summary>'+field('学习内容','content-'+id,r.content,{maxLength:3000})+field('易忘词','forgotWords-'+id,r.forgotWords,{textarea:true,maxLength:3000})+'</details>'+(r.minutes!=null?'<details class="details-toggle"><summary>时长记录</summary>'+field('历史时长（分钟）','minutes-'+id,r.minutes,{type:'number',min:0,max:1440,step:'any',placeholder:'未记录'})+'</details>':'')+'</div>';
  }
  function assessmentView(date){
    if(state.evaluation&&window.StudyEvaluation.covers(state,date))return window.StudyEvaluationUI.card(state,date);
    const result=R().assess(state,date),t=result.time;
    const detail=['below','within','above'].includes(t.kind)?statusLabel(t.status)+' · '+t.scope+' '+R().decimal(t.actual)+' / '+R().text({min:t.min,max:t.max})+' 分钟':t.kind==='partial'?statusLabel(t.status)+' · '+t.missing+' 科时长未记录':'';
    let html='<section class="daily-assessment" aria-label="今日评估"><div class="section-heading"><h2>今日评估</h2><button class="text-button" type="button" data-action="assessment-rules">评估规则</button></div><p class="assessment-pending" role="status" hidden>待保存</p><div class="assessment-results"><div class="assessment-row"><span>时长</span><strong data-time-assessment="'+t.kind+'">'+escape(t.label)+'</strong></div>'+(detail?'<p class="assessment-detail">'+escape(detail)+'</p>':'');
    result.words.forEach(w=>{html+='<div class="assessment-row"><span>'+escape(w.name)+'新学</span><strong data-word-assessment="'+w.kind+'">'+escape(w.label)+'</strong></div><p class="assessment-detail">'+(w.newWords===null?'未记录':w.newWords+' 个')+(w.goal===null?'':' / '+w.goal+' 个')+(w.reviewWords===null?'':' · 复习 '+w.reviewWords+' 个')+'</p>';});
    (result.quantities||[]).forEach(q=>{html+='<div class="assessment-row"><span>'+escape(q.name)+'数量</span><strong data-quantity-assessment="'+q.kind+'">'+escape(q.label)+'</strong></div><p class="assessment-detail">'+(q.quantity===null?'未记录':q.quantity+' '+escape(q.actualUnit||q.unit))+(q.goal===null?'':' / '+q.goal+' '+escape(q.unit))+'</p>';});
    if(within(date))html+='<button class="text-button" type="button" data-action="edit-reference" data-date="'+date+'">修改参考区间</button>';
    html+='<button class="text-button" type="button" data-action="assessment-basis" data-date="'+date+'">评估依据</button>';
    return html+'</div></section>';
  }
  function assessmentSummary(days){return window.StudyTracking.renderAssessments(state,days,{today:iso(),icon:icon});}
  function basisLabel(source){return ({fixed:'原计划依据',record:'保存时参考',existing:'首次留存参考',recalculated:'重评时参考',current:'当前参考（未留存）'})[source];}
  function assessmentResultLine(result){const t=result.time;return '<p>'+t.scope+'：'+escape(t.label)+(t.actual===null?'':' · '+R().decimal(t.actual)+(['below','within','above'].includes(t.kind)?' / '+R().text({min:t.min,max:t.max}):'')+' 分钟')+'</p>'+result.words.map(w=>'<p>'+escape(w.name)+'新学：'+escape(w.label)+(w.newWords===null?'':' · '+w.newWords+(w.goal===null?'':' / '+w.goal)+' 个')+'</p>').join('')+(result.quantities||[]).map(q=>'<p>'+escape(q.name)+'：'+escape(q.label)+(q.quantity===null?'':' · '+q.quantity+' '+escape(q.actualUnit||q.unit)+(q.goal===null?'':' / '+q.goal+' '+escape(q.unit)))+'</p>').join('');}
  function assessmentBasis(date){
    if(state.evaluation&&window.StudyEvaluation.covers(state,date)){openSheet('评估依据',window.StudyEvaluationUI.basis(readState(),date),true);return;}
    const latest=readState(),b=R().basis(latest,date),r=R().assess(latest,date);
    let html='<p>'+fullDate(date)+'</p><p>'+escape(basisLabel(b.source))+(b.capturedAt?' · '+escape(new Date(b.capturedAt).toLocaleString('zh-CN')):'')+'</p><dl class="assessment-basis">'+b.time.map(s=>'<div><dt>'+escape(s.name)+'</dt><dd>'+R().text(s.reference)+' 分钟</dd></div>').join('')+b.words.map(s=>'<div><dt>'+escape(s.name)+'新学</dt><dd>'+s.goal+' 个</dd></div>').join('')+(b.quantities||[]).map(s=>'<div><dt>'+escape(s.name)+'</dt><dd>'+s.goal+' '+escape(s.unit)+'</dd></div>').join('')+'</dl><p>今日安排：'+(r.time.status?statusLabel(r.time.status):'未选择')+'</p>'+assessmentResultLine(r);
    if(latest.records[date])html+='<button type="button" class="secondary-wide" data-action="assessment-preview" data-date="'+date+'">按当前目标重评</button>';
    openSheet('评估依据',html,true);
  }
  function assessmentPreview(date){
    if(dirty.has('daily'))throw new Error('先保存当天记录');
    const latest=readState();if(!latest.records[date])throw new Error('当天尚未保存记录');
    const proposed=clone(latest);R().recalculate(proposed,date);
    openSheet('重新评估','<p>'+fullDate(date)+'</p><h3>原评估</h3>'+assessmentResultLine(R().assess(latest,date))+'<h3>按当前目标</h3>'+assessmentResultLine(R().assess(proposed,date))+'<p>将替换这一天的评估依据，学习记录不变。</p><div class="save-row"><button type="button" class="cancel-button" data-action="close-sheet">取消</button><button type="button" class="primary" data-action="assessment-apply" data-date="'+date+'" data-plan="'+escape(call('getPlans').activeId)+'" data-revision="'+(latest._revision||0)+'">确认重评</button></div>',true);
  }
  function applyAssessment(button){
    if(dirty.has('daily'))throw new Error('先保存当天记录');
    const latest=readState(),date=button.dataset.date;
    if(button.dataset.plan!==call('getPlans').activeId||Number(button.dataset.revision)!==(latest._revision||0)){button.dataset.action='assessment-preview';button.textContent='重新预览';throw new Error('记录已更新，请重新预览');}
    R().recalculate(latest,date);persist(latest);closeSheet(true);render();tell('已重新评估');
  }
  function courseAgenda(date) {
    const schedule=window.StudySchedule,a=schedule.agenda(state,date);
    if(!a)return window.StudyCourseUI.checklist(state,date);
    const item=(name,value,detail,id)=>'<li><div class="agenda-heading"><span>'+escape(name)+'</span>'+(value===null?'':id?'<button type="button" class="reference-edit" data-action="edit-reference" data-date="'+date+'" data-subject="'+escape(id)+'" aria-label="修改'+escape(name)+'参考区间"><strong>'+escape(value)+'</strong></button>':'<strong>'+escape(value)+'</strong>')+'</div>'+(detail?'<p class="agenda-detail">'+escape(detail)+'</p>':'')+'</li>';
    const detail=a.weekday===5?'本周课堂笔记、例题与作业':a.weekday===6?'本周易错点与未理清的问题':a.courses&&a.courses.length?a.courses.join('、'):'近期课程笔记与作业';
    const range=value=>value[0]/60+'—'+value[1]/60+' 小时';
    let html='<section class="course-agenda" aria-label="复习顺序"><div class="section-heading"><h2>复习顺序</h2><span class="section-number">参考区间</span></div><ol>'+item(a.courseName,a.courseRange===null?null:R().text(a.courseRange)+' 分钟',(a.periods?'上午 '+range(a.periods.morning)+' · ':'')+detail,a.courseId);
    if(a.mathRange!==null)html+=item(a.mathName,R().text(a.mathRange)+' 分钟',a.periods?'下午 '+range(a.periods.afternoon):'','math');
    const vocab=M().subjectsForDate(state,date).find(s=>s.id==='vocab'&&s.kind==='vocab');
    if(vocab)html+=item(vocab.name,'新学 '+M().wordTarget(state,date,vocab.id)+' 个','','vocab');
    html+='</ol>';
    if(a.weekday>=5&&!a.periods&&date>=iso()&&schedule.weekendDates(state,iso()).length)html+='<button class="text-button" data-action="weekend-schedule">调整周末参考</button>';
    return html+window.StudyCourseUI.checklist(state,date)+'<button class="text-button" type="button" data-action="course-manager">查看课表</button></section>';
  }
  function todayView() {
    const w = weekOf(selectedDate), date = localDate(selectedDate), today = iso();
    const record = M().record(state, selectedDate);
    initialDaily = clone(record);
    const total = actualTotal(record), reference = refTotal(selectedDate), subjects = visibleSubjects(selectedDate);
    const weekDays = Array.from({ length: 7 }, (_, i) => shift(w.key, i));
    let html = '<div class="date-line"><h1 class="date-title">' + (selectedDate === today ? '今天' : '记录') + '<small>' + briefDate(selectedDate) + ' · 周' + weekdays[date.getDay()] + '</small></h1><div class="date-tools"><button type="button" class="icon-button" data-action="day-prev" aria-label="前一天">' + icon('prev') + '</button><label class="calendar-control icon-button" aria-label="选择打卡日期">' + icon('today') + '<input id="day-picker" type="date" min="1900-01-01" max="2100-12-31" value="' + selectedDate + '" aria-label="选择打卡日期"></label><button class="icon-button" data-action="day-next" aria-label="后一天">' + icon('next') + '</button></div></div>';
    if (selectedDate !== today) html += '<button class="text-button" data-action="go-today">回到今天 · ' + briefDate(today) + '</button>';
    html += '<div class="week-strip" aria-label="本周日期">' + weekDays.map(d => '<button type="button" class="day-cell' + (d === selectedDate ? ' current' : '') + (d === today ? ' today' : '') + '" data-action="choose-day" data-date="' + d + '"' + (d === selectedDate ? ' aria-current="date"' : '') + '><span>周' + weekdays[localDate(d).getDay()] + '</span><strong>' + Number(d.slice(8)) + '</strong>' + (meaningful(state.records[d]) ? '<i class="record-dot" aria-label="已留记录"></i>' : '') + '</button>').join('') + '</div>';
    if (!within(selectedDate)) html += '<div class="outside-notice">' + (selectedDate > state.plan.endDate ? '计划已结束' : '计划尚未开始') + '<br><button data-nav="plan">查看 / 修改计划</button></div>';
    if (timeSubjects(record,selectedDate).length) html += '<div class="overview with-reference-range"><div><span class="metric-label">已记录时长</span><strong class="metric-value' + (total == null ? ' is-empty' : '') + '" id="daily-total">' + minuteLabel(total) + '</strong><span class="metric-unit" id="daily-unit"' + (total == null ? ' hidden' : '') + '>分钟</span><span class="metric-caption" id="daily-count">' + timeCaption(record, selectedDate) + '</span></div><div class="range-metric">'+(within(selectedDate)?'<button type="button" class="text-button range-edit" data-action="edit-reference" data-date="'+selectedDate+'" aria-label="修改总参考区间">':'')+'<span class="metric-label">'+(state.evaluation&&window.StudyEvaluation.covers(state,selectedDate)?'执行参考':'参考区间')+(within(selectedDate)?icon('next'):'')+'</span><strong class="metric-value range-value">' + R().text(reference) + '</strong><span class="metric-unit">分钟</span>'+(within(selectedDate)?'</button>':'')+'</div></div>';
    html+=assessmentView(selectedDate);

    if (selectedDate === today && within(selectedDate) && M().subjectsForDate(state,selectedDate).some(s=>s.kind!=='vocab'&&!isQuantity(s))) html += '<div class="quick-timers" aria-label="开始今日学习计时">' + M().subjectsForDate(state, selectedDate).filter(s => s.kind !== 'vocab' && !isQuantity(s)).map(subject => '<button type="button" data-action="start-timer" data-subject="' + escape(subject.id) + '"' + (!M().allowed() ? ' disabled' : '') + '>' + icon('play') + escape(subject.name) + '计时</button>').join('') + '</div>' + (!M().allowed() ? '<p class="inline-form-note">' + escape(restReason()) + '</p>' : '');
    html += '<div id="timer-panel" class="timer-panel" hidden></div>';
    html += courseAgenda(selectedDate);
    if (within(selectedDate)) html += '<div class="section"><div class="section-heading"><h2>本周目标</h2><span class="section-number">01 / PLAN</span></div>' + window.StudyWeekUI.controls(state.plan, w.key, 'today') + '<div class="week-links"><button class="text-button" type="button" data-action="edit-week" data-scope="today">编辑本周目标</button><button class="text-button" type="button" data-action="week-history">历史目标</button></div></div>';
    html += '<form id="daily-form" data-dirty="daily"><div class="section"><div class="section-heading"><h2>今日记录</h2><span class="section-number">02 / RECORD</span></div>';
    html += subjects.map((subject, index) => {
      const r = record.subjects[subject.id] || {}, id = subject.id;
      if (subject.kind === 'vocab') return vocabEntry(subject, r, index);
      if (isQuantity(subject)) {
        const goal = within(selectedDate) ? M().quantityTarget(state, selectedDate, id) : null;
        const unit = r.quantityUnit || M().quantityUnit(state,selectedDate,id),goalUnit=M().quantityUnit(state,selectedDate,id);
        return '<div class="subject-entry quantity-entry"><div class="subject-heading"><h3><span class="subject-index">' + String(index + 1).padStart(2, '0') + '</span>' + escape(subject.name) + '</h3>' + (goal !== null && M().subjectActive(subject, selectedDate) ? '<button type="button" class="reference-pill reference-edit" data-action="edit-reference" data-date="' + selectedDate + '" data-subject="' + escape(id) + '" aria-label="修改' + escape(subject.name) + '每日目标">目标 ' + goal + ' ' + escape(goalUnit) + '</button>' : '<span class="reference-pill">' + (M().subjectActive(subject, selectedDate) ? '目标 ' + (goal === null ? '—' : goal) + ' ' + escape(unit) : '已归档') + '</span>') + '</div><div class="actual-row"><div class="actual-input"><input type="number" id="quantity-' + id + '" name="quantity-' + id + '" data-unit="'+escape(unit)+'" min="0" max="100000" step="1" inputmode="numeric" value="' + escape(r.quantity) + '" placeholder="未记录" aria-label="' + escape(subject.name) + '实际数量（'+escape(unit)+'）"><span>实际 ' + escape(unit) + '</span><input type="hidden" id="quantity-unit-'+id+'" name="quantity-unit-'+id+'" data-draft-unit-for="quantity-'+id+'" value="'+escape(unit)+'"></div></div><details class="details-toggle"' + (r.content || r.problem ? ' open' : '') + '><summary>内容与问题 <span class="visually-hidden">展开记录</span></summary>' + field('内容 / 题号', 'content-' + id, r.content, { placeholder: '这次完成了什么', maxLength: 3000 }) + field('需要回顾的一个问题', 'problem-' + id, r.problem, { textarea: true, maxLength: 3000 }) + '</details></div>';
      }
      const ref = within(selectedDate) ? R().text(M().reference(state, selectedDate, id)) : '—';
      const editable = selectedDate === today && within(selectedDate) && M().allowed() && M().subjectActive(subject, selectedDate);
      return '<div class="subject-entry"><div class="subject-heading"><h3><span class="subject-index">' + String(index + 1).padStart(2, '0') + '</span>' + escape(subject.name) + '</h3>' + (within(selectedDate)&&M().subjectActive(subject,selectedDate)?'<button type="button" class="reference-pill reference-edit" data-action="edit-reference" data-date="'+selectedDate+'" data-subject="'+escape(id)+'" aria-label="修改'+escape(subject.name)+'参考区间">参考 '+ref+' 分钟</button>':'<span class="reference-pill">'+(M().subjectActive(subject,selectedDate)?'参考 '+ref+' 分钟':'已归档')+'</span>') + '</div><label class="visually-hidden" for="minutes-' + id + '">' + escape(subject.name) + '实际净学习分钟</label><div class="actual-row"><div class="actual-input"><input type="number" id="minutes-' + id + '" name="minutes-' + id + '" min="0" max="1440" step="any" inputmode="decimal" value="' + escape(r.minutes) + '" placeholder="未记录" aria-label="' + escape(subject.name) + '实际分钟"><span>实际分钟</span></div><button type="button" class="start-button" data-action="start-timer" data-subject="' + id + '"' + (!editable ? ' disabled' : '') + '>' + icon('play') + '计时</button></div><details class="details-toggle"' + (r.content || r.problem || r.newWords != null || r.reviewWords != null || r.forgotWords ? ' open' : '') + '><summary>内容与' + '问题' + ' <span class="visually-hidden">展开记录</span></summary>' + field('内容 / 题号', 'content-' + id, r.content, { placeholder: subject.kind === 'math' ? '例如：左右极限；教材第 12 页' : '这次主要学习了什么', maxLength: 3000 }) + field('需要回顾的一个问题', 'problem-' + id, r.problem, { textarea: true, placeholder: subject.kind === 'math' ? '例如：链式求导漏乘内层导数' : '', maxLength: 3000 }) + '</details></div>';
    }).join('');
    html += (selectedDate !== today ? '<p class="hint">'+(selectedDate<today?'历史日期':'计划日期')+' · 手动记录</p>' : '') + '</div><div class="section"><div class="section-heading"><h2>今日安排</h2><span class="section-number">03 / REST</span></div><fieldset class="status-fieldset"><legend class="field-label">今日安排（选填）</legend><div class="status-options">' + statuses.map(status => '<label class="status-option"><input type="radio" name="status" value="' + status + '"' + (record.status === status ? ' checked' : '') + '><span>' + statusLabel(status) + '</span></label>').join('') + '</div></fieldset><div class="rest-control"><label for="rest-kept">休息记录（选填）</label><select id="rest-kept" name="restKept"><option value=""' + (record.restKept == null ? ' selected' : '') + '>未记录</option><option value="true"' + (record.restKept === true ? ' selected' : '') + '>已保留</option><option value="false"' + (record.restKept === false ? ' selected' : '') + '>需要调整</option></select></div>' + field('随记', 'daily-note', record.note, { textarea: true, placeholder: '', maxLength: 5000 }) + '<div class="save-row"><button type="submit" class="primary">' + icon('check') + '保存这一天</button></div></div></form>';
    return html;
  }

  function defaultsFields(prefix, values) {
    return '<div class="default-grid range-defaults">' + monDays.map((name, i) => rangeFields('周'+name,prefix+'-'+i,values?values[i]:0)).join('') + '</div>';
  }
  function quantityDefaultsFields(prefix, values) {
    return '<div class="default-grid quantity-defaults">' + monDays.map((name, i) => field('周'+name, prefix+'-'+i, values ? values[i] : 0, { type:'number', min:0, max:100000, step:1, required:true, help:'每日目标数量' })).join('') + '</div>';
  }
  function rangeFields(label,id,value,limit=1440){
    const r=R().range(value);
    const input=(key,bound,title)=>'<div class="field"><label for="'+escape(key)+'">'+title+'</label><input id="'+escape(key)+'" name="'+escape(key)+'" type="number" min="0" max="'+limit+'" step="any" inputmode="decimal" value="'+escape(bound)+'" required aria-label="'+escape(label)+'参考'+title+'分钟"'+(title==='上限'?' data-legacy-range="'+escape(id)+'"':'')+'></div>';
    return '<fieldset class="reference-range"><legend>'+escape(label)+'（分钟）</legend><div class="field-inline">'+input(id,r.min,'下限')+input(id+':max',r.max,'上限')+'</div></fieldset>';
  }
  function planView() {
    const w = weekOf(planDate), dates = M().dates(w.start || w.key, w.end).filter(within);
    const allDays = M().dates(state.plan.startDate, state.plan.endDate);
    let html = '<div class="page-intro"><h1>计划</h1><p>' + fullDate(state.plan.startDate) + ' — ' + fullDate(state.plan.endDate) + ' · ' + allDays.length + ' 天</p></div>' + weekNavigation(planDate, 'plan');
    html+='<button class="secondary-wide allocation-entry" type="button" data-action="edit-allocation">总体任务分配'+icon('next')+'</button>';
    if(state.evaluation)html+='<button class="secondary-wide" type="button" data-action="evaluation-schedule">评估日程'+icon('next')+'</button>';
    html+='<button class="secondary-wide" type="button" data-action="course-manager">课程表</button>';
    if(window.StudySchedule.canApply(state,iso()))html+='<button class="text-button" data-action="course-schedule">课程与区间安排</button>';
    if(window.StudySchedule.weekendDates(state,iso()).length)html+='<button class="text-button" data-action="weekend-schedule">周末安排</button>';
    html += window.StudyWeekUI.readonly(state.plan, w.key, false);
    html += '<div class="week-list">' + dates.map(date => {
      const r = state.records[date], today = date === iso();
      const recorded=M().recordSummary(state,date),subjects=M().subjectsForDate(state,date),timed=subjects.some(s=>s.kind!=='vocab'&&!isQuantity(s));
      const caption=r?.status==='休息'?'休息':recorded.recordedSubjects?'<strong>'+recorded.recordedSubjects+'/'+recorded.totalSubjects+'</strong><small>已记录</small>':meaningful(r)?'有随记':'未记录';
      const reference=timed?R().text(R().total(state,date))+' 分钟':subjects.map(s=>s.kind==='vocab'?'新学 '+M().wordTarget(state,date,s.id)+' 个':M().quantityTarget(state,date,s.id)+' '+escape(M().quantityUnit(state,date,s.id))).join(' · ');
      const agenda=window.StudySchedule.agenda(state,date);
      const detail=agenda?(agenda.periods?'上午 '+R().text({min:agenda.periods.morning[0],max:agenda.periods.morning[1]})+' · 下午 '+R().text({min:agenda.periods.afternoon[0],max:agenda.periods.afternoon[1]})+' 分钟':agenda.courses.length?agenda.courses.join('、'):'课程回顾与考研高数'):subjects.map(s=>s.name).join('、');
      return '<button class="plan-day plan-entry' + (today ? ' today' : '') + '" data-action="open-history" data-date="' + date + '" aria-label="打开' + fullDate(date) + '记录"><strong class="day-number">' + Number(date.slice(8)) + '</strong><span class="plan-day-meta"><span class="plan-day-date">周' + weekdays[localDate(date).getDay()] + ' · '+reference+'</span><span class="plan-day-subjects">'+escape(detail)+'</span></span><span class="plan-day-state">'+caption+'</span>' + icon('next') + '</button>';
    }).join('') + '</div><button class="secondary-wide" data-action="edit-week">编辑本周目标</button><button class="text-button" data-action="week-history">历史目标</button><button class="secondary-wide" data-action="edit-reference">修改某一天目标</button><div class="section"><div class="section-heading"><h2>调整计划</h2><span class="section-number">EDIT / PLAN</span></div><details class="plain-details plan-editor"><summary>日期与教学周</summary><form id="range-form" data-dirty="range">' + field('计划名称', 'plan-title', state.plan.title, { required: true, maxLength: 120 }) + '<div class="field-inline">' + field('开始日期', 'range-start', state.plan.startDate, { type: 'date', min: '1900-01-01', max: '2100-12-31', required: true }) + field('结束日期', 'range-end', state.plan.endDate, { type: 'date', min: '1900-01-01', max: '2100-12-31', required: true }) + '</div>' + field('起始教学周', 'start-week', state.plan.startWeek, { type: 'number', min: 1, max: 999, step: '1', required: true }) + '<p class="inline-form-note">最多 730 天</p><button class="small-submit primary" type="submit">保存日期范围</button></form></details><details class="plain-details"><summary>科目与目标</summary>';
    html += state.plan.subjects.map(subject => '<form id="subject-' + subject.id + '" class="subject-editor-item" data-dirty="subject-' + subject.id + '" data-subject-edit="' + subject.id + '">' + field('科目名称', 'name-' + subject.id, subject.name, { required: true, maxLength: 40 }) + (subject.kind === 'vocab' ? field('每日新学目标（个）', 'word-goal-' + subject.id, subject.wordGoal ?? 50, {type:'number',min:0,max:100000,step:1,required:true}) + '<fieldset class="word-step-settings"><legend>快捷加数</legend><div class="word-step-fields">' + M().wordSteps(state,subject.id).map((n,i) => field('加数 '+(i+1), 'word-step-'+subject.id+'-'+i, n, {type:'number',min:1,max:100000,step:'1',required:true})).join('') + '</div></fieldset>' : isQuantity(subject) ? '<p class="line-label">计量方式：数量</p>' + field('单位','unit-' + subject.id,subject.unit,{required:true,maxLength:32,placeholder:'例如：题、页、组',help:'次日起未记录的日期使用新单位'}) + '<p class="line-label">新增日期的默认每日目标</p>' + quantityDefaultsFields('defaults-' + subject.id, subject.defaults) : '<p class="line-label">计量方式：时间（分钟）</p><p class="line-label">新增日期的默认参考区间（分钟）</p>' + defaultsFields('defaults-' + subject.id, subject.defaults)) + '<button class="compact-button" type="submit">保存 ' + escape(subject.name) + '</button><div class="subject-actions"><button type="button" data-action="move-subject" data-subject="' + subject.id + '" data-direction="-1">上移</button><button type="button" data-action="move-subject" data-subject="' + subject.id + '" data-direction="1">下移</button><button type="button" data-action="' + (M().subjectActive(subject, iso()) ? 'archive-subject' : 'restore-subject') + '" data-subject="' + subject.id + '">' + (M().subjectActive(subject, iso()) ? '归档' : '恢复科目') + '</button></div></form>').join('');
    html += '<button class="secondary-wide" data-action="add-subject">' + icon('plus') + '添加新科目</button></details></div>';
    return html;
  }

  function reviewView() {
    const stats = M().weekStats(state, reviewDate), w = weekOf(reviewDate);
    const review = state.reviews[w.key] || {};
    const total = stats.subjects.filter(s => s.measure !== 'quantity').reduce((sum, s) => sum + (s.actual || 0), 0);
    const actualExists = stats.subjects.some(s => s.measure !== 'quantity' && s.actual != null);
    let html = trackingTabs() + '<div class="page-intro"><h1>复盘</h1></div>' + weekNavigation(reviewDate, 'review');
    html += '<section class="review-goals" aria-label="本周目标"><h2>本周目标</h2>' + window.StudyWeekUI.readonly(state.plan, w.key, true) + '<div class="week-links"><button class="text-button" data-action="edit-week" data-scope="review">编辑本周目标</button><button class="text-button" data-action="week-history">历史目标</button></div></section>';
    html += '<div class="overview"><div><span class="metric-label">已记录时长</span><strong class="metric-value' + (actualExists ? '' : ' is-empty') + '">' + (actualExists ? minuteLabel(total) : '未记录') + '</strong>' + (actualExists ? '<span class="metric-unit">分钟</span>' : '') + '</div><div><span class="metric-label">时长记录天数</span><strong class="metric-value">' + stats.recordedDays + '<small class="metric-unit"> / ' + stats.totalDays + ' 天</small></strong><span class="metric-caption">数量记录 ' + (stats.quantityRecordedDays || 0) + ' 天 · 随记 ' + (stats.entryDays ?? stats.recordedDays) + ' 天</span></div></div><div class="legend"><span><i></i>已记录</span><span><i class="ref-line"></i>参考</span><span>虚线：未记录</span></div>';
    html += assessmentSummary(Array.from({length:7},(_,i)=>shift(w.key,i)))+window.StudyTracking.renderWordStats(state,stats.days)+window.StudyTracking.renderQuantityStats(state,stats.days);
    html += stats.subjects.filter(s => s.measure!=='quantity'&&(s.kind !== 'vocab' ? s.totalDays || s.actual != null : s.actual != null)).map(subject => {
      const item = state.plan.subjects.find(s => s.id === subject.id);
      const referenceFor = d => M().subjectActive(item,d) ? M().reference(state,d,subject.id) : null;
      const days = stats.days, maximum = Math.max(1, ...days.flatMap(d => [referenceFor(d)===null?0:R().range(referenceFor(d)).max, state.records[d]?.subjects?.[subject.id]?.minutes || 0]));
      const description = days.map(d => fullDate(d) + '，' + minuteLabel(state.records[d]?.subjects?.[subject.id]?.minutes ?? null) + (state.records[d]?.subjects?.[subject.id]?.minutes != null ? '分钟' : '') + '，参考' + R().text(referenceFor(d))+'分钟').join('；');
      return '<div class="chart-subject"><div class="chart-subject-head"><h3>' + escape(subject.name) + (subject.kind === 'vocab' ? ' · 历史时长' : '') + '</h3><span class="chart-value">' + minuteLabel(subject.actual) + (subject.actual != null ? ' 分钟' : '') + ' <small>/ 参考 ' + R().text(subject.referenceRange||subject.reference) + ' 分钟</small></span></div><div class="bar-chart" role="img" aria-label="' + escape(subject.name + '：' + description) + '">' + days.map(date => {
        const actual = state.records[date]?.subjects?.[subject.id]?.minutes ?? null, ref = referenceFor(date);
        const r=ref===null?{min:0,max:0,legacy:true}:R().range(ref),bottom=r.legacy?0:r.min;
        return '<div class="chart-day" title="' + date + ' 已记录：' + minuteLabel(actual) + '；参考：' + R().text(ref) + '"><i class="bar reference'+(r.legacy?'':' ranged')+'" data-bottom="'+bottom/maximum*100+'" data-height="' + (r.max-bottom) / maximum * 100 + '"></i><i class="bar' + (actual == null ? ' missing' : actual === 0 ? ' zero' : '') + '" data-height="' + (actual || 0) / maximum * 100 + '"></i></div>';
      }).join('') + '</div><div class="chart-labels">' + days.map(date => '<span>周' + weekdays[localDate(date).getDay()] + '</span>').join('') + '</div><p class="chart-caption">' + subject.recordedDays + '/' + subject.totalDays + ' 天已记录</p></div>';
    }).join('');
    html += '<form id="review-form" data-dirty="review"><div class="section"><div class="section-heading"><h2>本周随记</h2><span class="section-number">WEEK / NOTE</span></div>' + field('学习强度', 'review-load', review.load, { textarea: true, maxLength: 5000 }) + state.plan.subjects.filter(s => stats.subjects.find(x => x.id === s.id)?.totalDays || review.subjects?.[s.id]).map(s => field(s.name + (s.kind === 'vocab' ? '复习' : '回顾'), s.id === 'math' ? 'review-mathProblem' : s.id === 'vocab' ? 'review-vocabReview' : 'review-subject-' + s.id, review.subjects?.[s.id] ?? (s.id === 'math' ? review.mathProblem : s.id === 'vocab' ? review.vocabReview : ''), { textarea: true, maxLength: 5000 })).join('') + selectField('下周安排（选填）', 'review-adjustment', review.adjustment || '', [['', '暂不决定'], ['维持', '维持'], ['减量', '减量'], ['仅回顾', '仅回顾'], ['休息', '休息'], ['其他', '其他']]) + field('随记', 'review-reason', review.reason, { textarea: true, maxLength: 5000 }) + selectField('半天休息记录（选填）', 'review-halfDayRest', review.halfDayRest == null ? '' : String(review.halfDayRest), [['', '未记录'], ['true', '已保留'], ['false', '未保留']]) + '<div class="save-row"><button class="primary" type="submit">' + icon('check') + '保存本周复盘</button></div></div></form>';
    return html + '<button class="secondary-wide" data-action="export-report">导出周报</button>';
  }

  function settingsView() {
    const reminders = state.settings.reminders, backup = call('getBackupStatus');
    return '<div class="page-intro"><div class="eyebrow">SETTINGS / 设置</div><h1>设置</h1></div><button class="setting-action manual-entry" type="button" data-action="user-manual"><span>使用手册</span>'+icon('next')+'</button><form id="reminder-form" data-dirty="reminders"><div class="section-heading"><h2>学习提醒</h2><span class="section-number">01 / REMIND</span></div><div class="settings-row"><h3>开启提醒</h3><label class="switch" aria-label="开启学习提醒"><input id="reminders-enabled" name="enabled" type="checkbox"' + (reminders.enabled ? ' checked' : '') + '><span></span></label></div><div class="field-inline">' + field('工作日', 'weekday-time', reminders.weekdayTime, { type: 'time', required: true, help: '20:30 前' }) + field('周末', 'weekend-time', reminders.weekendTime, { type: 'time', required: true, help: '09:30 — 18:59' }) + '</div><div id="notification-status" class="permission-status" role="status" aria-live="polite" hidden></div><button class="small-submit primary" type="submit">保存提醒设置</button><button class="text-button" type="button" data-action="reminder-help">未收到提醒？</button></form><div class="section"><div class="section-heading"><h2>备份与恢复</h2><span class="section-number">02 / DATA</span></div><p class="backup-date">上次备份：' + (backup.lastExportAt ? escape(new Date(backup.lastExportAt).toLocaleString('zh-CN')) : '未导出') + '</p><button class="setting-action" data-action="export-backup"><span>' + icon('download') + '导出备份</span>' + icon('next') + '</button><button class="setting-action" data-action="import-backup"><span>' + icon('upload') + '从备份恢复</span>' + icon('next') + '</button><form id="backup-reminder-form" data-dirty="backup-reminder"><div class="settings-row"><label for="backup-enabled">备份提醒</label><label class="switch" aria-label="备份提醒"><input id="backup-enabled" name="backup-enabled" type="checkbox"' + (backup.reminderEnabled ? ' checked' : '') + '><span></span></label></div>' + selectField('间隔', 'backup-days', String(backup.reminderDays), [['7', '7 天'], ['14', '14 天'], ['30', '30 天']]) + (backup.reminderEnabled && !backup.notificationsAllowed ? '<div class="permission-status"><span>备份提醒通知未开启</span><button type="button" class="text-button" data-action="backup-notification-settings">打开通知设置</button></div>' : '') + '<button class="small-submit primary" type="submit">保存备份提醒</button></form><button class="setting-action" data-action="export-report"><span>导出学习报表</span>' + icon('next') + '</button><button class="text-button" data-action="clear-drafts">清除全部草稿</button></div><div class="section"><div class="section-heading"><h2>桌面小组件</h2><span class="section-number">03 / WIDGET</span></div><button class="secondary-wide" data-action="pin-widget">' + icon('widget') + '添加到桌面</button><button class="text-button" data-action="widget-help">添加帮助</button></div><div class="section settings-links"><button class="setting-action" data-action="rest-hours"><span>休息时段</span>' + icon('next') + '</button><button class="setting-action" data-action="about"><span>关于</span>' + icon('next') + '</button></div>';
  }

  function render() {
    if (!state) return;
    const layoutState = window.StudyLayout.snapshot();
    // A plan page contains several independent forms. Saving one must retain
    // edits in the others, including their expanded detail sections.
    const drafts = Array.from(app.querySelectorAll('form[data-dirty]')).filter(form => dirty.has(form.dataset.dirty)).map(form => ({ id: form.id, controls: Array.from(form.elements).filter(control => control.name).map(control => ({ name: control.name, type: control.type, value: control.value, checked: control.checked })) }));
    const dailyBaseline=dirty.has('daily')&&initialDaily?clone(initialDaily):null;
    const openDetails = Array.from(app.querySelectorAll('details')).map(detail => detail.open);
    document.querySelectorAll('[data-nav]').forEach(button => {
      if (button.closest('.bottom-nav')) { if (button.dataset.nav === route || button.dataset.nav === 'review' && ['month', 'history', 'sessions'].includes(route)) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }
    });
    const headerTag = document.getElementById('header-tag');
    headerTag.hidden = !preview; headerTag.textContent = preview ? '开发预览' : '';
    try { document.documentElement.classList.toggle('large-text', call('getPlatformInfo').fontScale >= 1.5); } catch (_) {}
    try { activePlanId = call('getPlans').activeId; } catch (_) {}
    document.getElementById('header-plan-name').textContent = state.plan.title;
    document.getElementById('header-plan').setAttribute('aria-label','切换计划：'+state.plan.title);
    app.innerHTML = (preview ? '<p class="preview-banner">开发预览</p>' : '') + ({ today: todayView, plan: planView, review: reviewView, history: historyView, month: monthView, sessions: sessionsView, inspiration: () => window.InspirationUI.view(), settings: settingsView }[route])();
    const automaticForm=app.querySelector('#daily-form');
    if(automaticForm&&state.evaluation&&window.StudyEvaluation.covers(state,selectedDate)){
      automaticForm.dataset.automaticEvaluation='true';const group=automaticForm.querySelector('.status-fieldset'),control=document.createElement('input');control.type='hidden';control.name='status';control.value=M().record(state,selectedDate).status||'';group.replaceChildren(control);group.hidden=true;
    }
    window.StudyLayout.mount(app,{route,state,planId:activePlanId,date:selectedDate,isDailyDirty:()=>dirty.has('daily'),minuteLabel});
    app.querySelectorAll('form[data-dirty]').forEach(syncFeedback);
    app.querySelectorAll('form[data-week-mode]').forEach(window.StudyWeekUI.sync);
    // Capture the saved baseline before restoring in-memory edits.
    app.querySelectorAll('form[data-dirty]').forEach(window.StudyDrafts.attach);
    drafts.forEach(draft => { const form = document.getElementById(draft.id); if (!form) return; draft.controls.forEach(saved => { const controls = Array.from(form.elements).filter(control => control.name === saved.name); const control = saved.type === 'radio' ? controls.find(item => item.value === saved.value) : controls[0]; if (!control) return; if (saved.type === 'checkbox' || saved.type === 'radio') control.checked = saved.checked; else control.value = saved.value; }); if (form.dataset.weekMode) { window.StudyWeekUI.sync(form); form.querySelector('.save-row').hidden=false; } });
    if(dailyBaseline&&document.getElementById('daily-form'))initialDaily=dailyBaseline;
    window.StudyWordLogUI.sync(document.getElementById('daily-form'),true);
    app.querySelectorAll('form[data-dirty]').forEach(syncFeedback);
    window.StudyLayout.sync();
    if (drafts.length) Array.from(app.querySelectorAll('details')).forEach((detail, index) => { if (openDetails[index]) detail.open = true; });
    document.querySelectorAll('[data-height]').forEach(bar => { bar.style.height = Math.max(0, Number(bar.dataset.height)) + '%';if(bar.dataset.bottom!==undefined)bar.style.bottom=Math.max(0,Number(bar.dataset.bottom))+'%'; });
    updatePermissionStatus();
    timerSignature = '';
    updateTimer();
    window.StudyLayout.restore(layoutState);
  }

  function optionalNumber(form, name, integer = false) {
    const input = form.elements.namedItem(name);
    if (!input || input.value.trim() === '') return null;
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 0 || value > (integer ? 100000 : 1440) || (integer && !Number.isInteger(value))) throw new Error(integer ? '词数请填写 0 至 100000 的整数，或留空。' : '实际分钟请填写 0 至 1440 的数字，或留空。');
    return value;
  }
  function optionalQuantity(form, name) {
    const input = form.elements.namedItem(name);
    if (!input || input.value.trim() === '') return null;
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 0 || value > 100000 || !Number.isInteger(value)) throw new Error('数量请填写 0 至 100000 的整数，或留空。');
    return value;
  }
  function saveDaily() {
    const form = document.getElementById('daily-form');
    if (!form || !form.reportValidity()) return false;
    const latest = readState();
    const record = M().record(latest, selectedDate);
    visibleSubjects(selectedDate).forEach(subject => {
      const id = subject.id, baseline = initialDaily.subjects[id] || {};
      const r = record.subjects[id] || (record.subjects[id] = { minutes: null, content: '', problem: '', newWords: null, reviewWords: null, forgotWords: '' });
      if (isQuantity(subject) && r.quantity === undefined) { r.quantity = null; r.quantityUnit = r.quantityUnit || M().quantityUnit(latest,selectedDate,id); }
      const quantity = isQuantity(subject) ? optionalQuantity(form, 'quantity-' + id) : null;
      if (isQuantity(subject)) {
        const before = baseline.quantity ?? null,unit=form.elements.namedItem('quantity-unit-'+id).value,beforeUnit=baseline.quantityUnit||M().quantityUnit(latest,selectedDate,id);
        if ((quantity !== before||unit!==beforeUnit) && (r.quantity !== before||r.quantityUnit!==beforeUnit) && (r.quantity !== quantity||r.quantityUnit!==unit) && !window.confirm('「' + subject.name + '」已有新的数量记录。用表单中的数量替换？')) throw new Error('数量未替换，输入已保留');
        if (quantity !== before||unit!==beforeUnit) { r.quantity = quantity; r.quantityUnit = unit; }
      }
      const minutes = form.elements.namedItem('minutes-' + id) ? optionalNumber(form, 'minutes-' + id) : (baseline.minutes ?? null);
      if (minutes !== (baseline.minutes ?? null) && r.minutes !== (baseline.minutes ?? null) && r.minutes !== minutes && !window.confirm('「' + subject.name + '」已有新的时长记录。用表单中的时长替换？')) throw new Error('时长未替换，输入已保留');
      if (minutes !== (baseline.minutes ?? null)) {r.minutes = minutes;if(latest.version>=9){record.timeCorrections=record.timeCorrections||{};delete record.timeCorrections[id];const seconds=window.StudyEvaluation.timerTotals(latest,selectedDate)[id]||0;if(seconds>0&&(minutes===null||minutes+1/60<seconds/60)){if(!window.confirm('「'+subject.name+'」已有 '+minuteLabel(seconds/60)+' 分钟计时。将正式时长修正为'+(minutes===null?'未记录':minuteLabel(minutes)+' 分钟')+'？'))throw new Error('时长修正未确认');record.timeCorrections[id]={minutes,timerSeconds:seconds,at:new Date().toISOString()};}if(!Object.keys(record.timeCorrections).length)delete record.timeCorrections;}}
      const content = form.elements.namedItem('content-' + id).value;
      if (content !== (baseline.content || '')) r.content = content;
      if (subject.kind === 'vocab') {
        optionalNumber(form, 'newWords-' + id, true); optionalNumber(form, 'reviewWords-' + id, true);
        const words = window.StudyWordLogUI.record(form,id), forgotWords = form.elements.namedItem('forgotWords-' + id).value;
        const group = s => ({newWords:s.newWords??null,reviewWords:s.reviewWords??null,wordLog:s.wordLog??null});
        const before=JSON.stringify(group(baseline)),next=JSON.stringify(group(words)),current=JSON.stringify(group(r));
        if(next!==before){
          if(current!==before&&current!==next&&!window.confirm('「'+subject.name+'」的数量或明细已更新。用当前输入替换？'))throw new Error('数量和明细未替换');
          r.newWords=words.newWords;r.reviewWords=words.reviewWords;
          if(words.wordLog)r.wordLog=clone(words.wordLog);else delete r.wordLog;
        }
        if (forgotWords !== (baseline.forgotWords || '')) r.forgotWords = forgotWords;
      } else { const problem = form.elements.namedItem('problem-' + id).value; if (problem !== (baseline.problem || '')) r.problem = problem; }
    });
    const status = form.elements.namedItem('status').value || null;
    if (status !== initialDaily.status) record.status = status;
    const restValue = form.elements.namedItem('restKept').value;
    const restKept = restValue === '' ? null : restValue === 'true';
    if (restKept !== initialDaily.restKept) record.restKept = restKept;
    const note = form.elements.namedItem('daily-note').value;
    if (note !== initialDaily.note) record.note = note;
    M().saveRecord(latest, selectedDate, record);
    persist(latest);
    dirty.delete('daily');
    render();
    return true;
  }
  function saveReview(form) {
    if (!form.reportValidity()) return false;
    const latest = readState(), key = M().weekInfo(latest.plan, reviewDate).key;
    const review = clone(latest.reviews[key] || {load:"",mathProblem:"",vocabReview:"",adjustment:"",reason:"",halfDayRest:null,subjects:{}}); review.subjects = review.subjects || {};
    ['load', 'adjustment', 'reason'].forEach(name => { review[name] = form.elements.namedItem('review-' + name).value; }); latest.plan.subjects.forEach(s => { const name = s.id === 'math' ? 'review-mathProblem' : s.id === 'vocab' ? 'review-vocabReview' : 'review-subject-' + s.id, input = form.elements.namedItem(name); if (input) { review.subjects[s.id] = input.value; if (s.id === 'math') review.mathProblem = input.value; if (s.id === 'vocab') review.vocabReview = input.value; } });
    const rest = form.elements.namedItem('review-halfDayRest').value;
    review.halfDayRest = rest === '' ? null : rest === 'true';
    latest.reviews[key] = review;
    persist(latest);
    dirty.delete('review');
    render();
    return true;
  }
  function saveRange(form) {
    if (!form.reportValidity()) return false;
    const latest = readState();
    M().resizePlan(latest, form.elements.namedItem('range-start').value, form.elements.namedItem('range-end').value, Number(form.elements.namedItem('start-week').value));
    latest.plan.title = form.elements.namedItem('plan-title').value.trim();
    persist(latest);
    dirty.delete('range');
    planDate = clampPlanDate(planDate);
    reviewDate = clampPlanDate(reviewDate);
    render();
    return true;
  }
  function readDefaults(form) { return Array.from(form.querySelectorAll('.reference-range')).map(group=>{const inputs=group.querySelectorAll('input');const r={min:Number(inputs[0].value),max:Number(inputs[1].value)};R().validate(r,true);return r;}); }
  function readQuantityDefaults(form) { return Array.from(form.querySelectorAll('.quantity-defaults input')).map(input=>{const n=Number(input.value);if(!Number.isInteger(n)||n<0||n>100000)throw new Error('每日数量目标须为 0 至 100000 的整数');return n;}); }
  function saveSubject(form) {
    if (!form.reportValidity()) return false;
    const latest = readState(), id = form.dataset.subjectEdit;
    const subject = latest.plan.subjects.find(s => s.id === id);
    const quantity = isQuantity(subject), measure = quantity ? 'quantity' : 'minutes';
    M().updateSubject(latest, id, form.elements.namedItem('name-' + id).value.trim(), subject.kind === 'vocab' ? subject.defaults : quantity ? readQuantityDefaults(form) : readDefaults(form), measure, quantity ? form.elements.namedItem('unit-' + id).value.trim() : undefined);
    if (subject.kind === 'vocab') M().setWordGoal(latest, id, Number(form.elements.namedItem('word-goal-' + id).value), latest.evaluation?shift(iso(),1):iso());
    if (subject.kind === 'vocab') M().setWordSteps(latest, id, [0,1,2].map(i => Number(form.elements.namedItem('word-step-' + id + '-' + i).value)));
    persist(latest);
    dirty.delete('subject-' + id);
    render();
    return true;
  }
  function saveReminder(form) {
    if (!form.reportValidity()) return false;
    const weekday = form.elements.namedItem('weekday-time').value, weekend = form.elements.namedItem('weekend-time').value;
    if (!/^\d{2}:\d{2}$/.test(weekday) || weekday >= '20:30') throw new Error('工作日提醒时间须早于 20:30。');
    if (!/^\d{2}:\d{2}$/.test(weekend) || weekend < '09:30' || weekend >= '19:00') throw new Error('周末提醒时间须在 09:30 至 18:59。');
    const latest = readState();
    latest.settings.reminders = { enabled: form.elements.namedItem('enabled').checked, weekdayTime: weekday, weekendTime: weekend };
    persist(latest);
    dirty.delete('reminders');
    render();
    return true;
  }

  function openSheet(title, content, preserveEdits = false) {
    if (!preserveEdits && !attempt(leaveEdits)) return;
    feedback.delete('sheet');
    dialog.classList.remove('manual-sheet', 'startup-update-sheet', 'timer-picker-sheet');
    dialog.innerHTML = '<div class="sheet-heading"><h2 id="sheet-title">' + title + '</h2><button class="icon-button" type="button" data-action="close-sheet" aria-label="关闭">×</button></div>' + content;
    dialog.showModal();
    dialog.querySelectorAll('form[data-dirty]').forEach(syncFeedback);
    dialog.querySelectorAll('form[data-week-mode]').forEach(window.StudyWeekUI.sync);
    dialog.querySelectorAll('form[data-dirty]').forEach(window.StudyDrafts.attach);
  }
  function closeSheet(force = false) {
    if (!force && dirty.has('sheet') && !window.StudyDrafts.flush() && !window.confirm('草稿未保存。丢弃输入并离开？')) return false;
    dirty.delete('sheet');
    feedback.delete('sheet');
    dialog.close();
    dialog.replaceChildren();
    return true;
  }
  function showCourses(date,preserve=false){
    const latest=readState();courseViewDate=clampPlanDate(date||courseViewDate||selectedDate);
    openSheet('课程表',window.StudyCourseUI.manager(latest,courseViewDate,iso()),preserve);
  }
  function editCourses(change=false){
    const latest=readState();if(iso()>latest.plan.endDate)throw new Error('计划已结束，请先调整日期范围');
    courseContext={plan:activePlanId,revision:latest._revision||0,schedule:JSON.stringify(latest.plan.courseSchedule)};
    openSheet(change?'临时调课 / 停课':'编辑课表',change?window.StudyCourseUI.changeForm(latest,courseViewDate||iso(),iso()):window.StudyCourseUI.editor(latest,iso()));
    if(change)window.StudyCourseUI.refreshChange(document.getElementById('course-change-form'),latest);
  }
  function saveCourses(form){
    const C=window.StudyCourses,U=window.StudyCourseUI,latest=readState();let next;
    if(form.id==='course-review-form'){
      if(form.dataset.plan&&form.dataset.plan!==call('getPlans').activeId)throw new Error('当前计划已切换，请重新打开');
      next=C.saveReviews(latest,form.dataset.date,U.readChecklist(form,latest),JSON.parse(form.dataset.baseline));
    }else{
      if(!courseContext||courseContext.plan!==call('getPlans').activeId||courseContext.revision!==(latest._revision||0)&&courseContext.schedule!==JSON.stringify(latest.plan.courseSchedule))throw new Error('课表已更新，请重新打开编辑');
      if(form.id==='timetable-form')next=C.putVersion(latest,{from:form.elements.namedItem('course-effective').value,anchor:form.elements.namedItem('course-anchor').value,startWeek:Number(form.elements.namedItem('course-start-week').value),courses:U.sync(form)},iso());
      else next=C.putChange(latest,{id:U.uid(),courseId:form.elements.namedItem('course-change-id').value,fromDate:form.elements.namedItem('course-from').value,toDate:form.elements.namedItem('course-change-mode').value==='cancel'?null:form.elements.namedItem('course-to').value,note:form.elements.namedItem('course-change-note').value},iso());
    }
    persist(next);dirty.delete(form.dataset.dirty);
    if(form.id!=='course-review-form'){closeSheet(true);render();showCourses(courseViewDate,true);tell(form.id==='timetable-form'?'课表已保存':'调课已保存');}else render();
    return true;
  }
  function showCourseSchedule(weekendsOnly=false) {
    if(dirty.size){tell('请先保存当前修改');return;}
    const latest=readState(),schedule=window.StudySchedule,dates=weekendsOnly?schedule.weekendDates(latest,iso()):null,b=schedule.budgetRanges;
    if(weekendsOnly?!dates.length:!schedule.canApply(latest,iso()))throw new Error(weekendsOnly?'当前计划没有可调整的周末日期':'当前计划无法应用课程优先安排');
    const from=weekendsOnly?dates[0]:schedule.from(latest,iso()),to=weekendsOnly?dates[dates.length-1]:latest.plan.endDate;
    const affected=weekendsOnly?'替换这 '+dates.length+' 个周末日期的课程复习和高数参考区间，包括自定值，并更新新增周末日期的默认区间。':'替换上述日期内课程复习和高数的自定参考量，并更新新增日期的默认区间。';
    openSheet(weekendsOnly?'周末安排':'课程与区间安排','<p>'+fullDate(from)+' — '+fullDate(to)+'</p><dl class="schedule-budget">'+(weekendsOnly?'':'<div><dt>工作日</dt><dd>'+R().text(b.weekday)+' 分钟</dd></div>')+'<div><dt>周六参考</dt><dd>'+R().text(b.saturday)+' 分钟</dd></div><div><dt>周日参考</dt><dd>'+R().text(b.sunday)+' 分钟</dd></div></dl><p>周末上午：课程复习 1—2 小时。</p><p>周末下午：高数，周六 3—4 小时、周日 2—3 小时。</p><p>'+affected+'</p><div class="save-row"><button class="cancel-button" data-action="close-sheet">取消</button><button class="primary" data-action="apply-course-schedule" data-mode="'+(weekendsOnly?'weekends':'all')+'" data-plan="'+escape(activePlanId)+'" data-from="'+from+'" data-to="'+to+'" data-revision="'+(latest._revision||0)+'">应用安排</button></div>');
  }
  function editWeek(date = planDate) {
    const w = weekOf(date);
    editWeekKey(w.key);
  }
  function editWeekKey(key) {
    M().dates(key,key);
    openSheet('周目标', window.StudyWeekUI.controls(state.plan, key, 'editor') + '<div class="week-links"><button class="text-button" data-action="week-move" data-key="'+key+'">移到另一周</button><button class="text-button" data-action="week-history">历史目标</button></div>');
  }
  function weekHistory() {
    const keys = window.StudyWeeks.keys(state.plan);
    openSheet('历史目标', keys.length ? '<div class="week-history">' + keys.map(key => {
      const value = window.StudyWeeks.snapshot(state.plan,key), done = value.tasks.filter(t=>t.done).length;
      return '<button class="setting-action" data-action="week-open" data-key="'+key+'"><span><strong>'+fullDate(key)+' — '+fullDate(window.StudyWeeks.end(key))+'</strong><small>'+(value.tasks.length ? done+' / '+value.tasks.length+' 项已完成' : '文字目标')+(window.StudyWeeks.active(state.plan,key)?'':' · 原日期分组')+'</small></span>'+icon('next')+'</button>';
    }).join('') + '</div>' : '<p class="empty-state">暂无目标记录</p>');
  }
  function saveWeek(form) {
    const latest = readState(), key = form.dataset.key, W = window.StudyWeeks, UI = window.StudyWeekUI;
    const current = W.snapshot(latest.plan,key), base = UI.base(form), edited = UI.values(form), merged = W.merge(base,current,edited);
    if (merged.conflicts.length) { UI.showConflicts(form,base,current,edited,'save'); throw new Error('目标已更新，请选择冲突项'); }
    const value = W.prepare(latest.plan,key,merged.value,new Date().toISOString());
    W.put(latest.plan,key,value); latest.version = Math.max(latest.version,4);
    persist(latest); dirty.delete(form.dataset.dirty);
    if(form.dataset.weekMode==='editor') closeSheet(true);
    render(); if(form.dataset.weekMode==='editor')tell('已保存'); return true;
  }
  function showWeekMove(key) {
    if (dirty.size) { tell('请先保存当前修改'); return; }
    const W = window.StudyWeeks, value = W.snapshot(state.plan,key);
    if(!value.goal&&!value.hint&&!value.tasks.length){tell('本周没有目标');return;}
    openSheet('移动周目标','<form id="week-move-form" data-dirty="sheet" data-key="'+key+'" data-original="'+escape(JSON.stringify(value))+'"><p>'+fullDate(key)+' — '+fullDate(W.end(key))+'</p>'+field('移入哪一周','week-move-date',clampPlanDate(selectedDate),{type:'date',min:state.plan.startDate,max:state.plan.endDate,required:true})+selectField('已有目标的处理方式','week-move-mode','merge',[['merge','合并'],['replace','替换']])+'<div class="save-row"><button type="button" class="cancel-button" data-action="close-sheet">取消</button><button class="primary" type="submit">移动目标</button></div></form>');
  }
  function moveWeek(form) {
    const latest=readState(),W=window.StudyWeeks,from=form.dataset.key,day=form.elements.namedItem('week-move-date').value;
    if(day<latest.plan.startDate||day>latest.plan.endDate)throw new Error('请选择计划内的日期');
    const to=M().weekKey(latest.plan,day),mode=form.elements.namedItem('week-move-mode').value;
    if(from===to)throw new Error('请选择另一周');
    if(JSON.stringify(W.snapshot(latest.plan,from))!==form.dataset.original)throw new Error('原周目标已更新，请重新打开');
    for(const key of [from,to]) if(call('getDraft',activePlanId+':week:'+key).draft)throw new Error('相关周有未保存草稿，请先在历史目标中处理');
    const dest=W.snapshot(latest.plan,to),next=W.transfer(latest.plan,from,to,mode);
    const impact=mode==='replace'?'将替换目标周的文字、随记及'+dest.tasks.length+'项任务。':'与目标周现有内容合并。';
    if(!window.confirm('将 '+fullDate(from)+' — '+fullDate(W.end(from))+' 的目标移到 '+fullDate(to)+' — '+fullDate(W.end(to))+'？\n'+impact+'原周目标将移除。')){feedback.delete('sheet');syncFeedback(form);return false;}
    latest.plan=next;persist(latest);dirty.delete('sheet');closeSheet(true);render();tell('目标已移动');return true;
  }
  function referenceFields(date) {
    const count=M().subjectsForDate(state,date).filter(s=>s.kind!=='vocab'&&s.measure!=='quantity').length,canKeep=!count||R().basis(state,date).time.some(s=>R().range(s.reference).max>0);
    return (count?rangeFields('总参考区间','reference-total',R().total(state,date),count*1440):'')+M().subjectsForDate(state,date).map(s => s.kind==='vocab'?field(s.name+' · 新学目标（个）','target-'+s.id,M().wordTarget(state,date,s.id),{type:'number',min:0,max:100000,step:1,required:true}):s.measure==='quantity'?field(s.name+' · 每日目标（'+M().quantityUnit(state,date,s.id)+'）','quantity-'+s.id,M().quantityTarget(state,date,s.id),{id:'quantity-target-'+s.id,type:'number',min:0,max:100000,step:1,required:true}):rangeFields(s.name,'target-'+s.id,M().reference(state,date,s.id))).join('')+(state.evaluation&&window.StudyEvaluation.covers(state,date)?(date<=window.StudyEvaluation.context(state.evaluation.timezone).today?'<p class="inline-form-note">调整执行目标；原计划评估保留，可在评估依据中查看对照。</p>':''):(state.records[date]?selectField('评估依据','reference-assessment','recalculate',[['recalculate','按新目标评估']].concat(canKeep?[['keep','保留原依据']]:[])):''));
  }
  function editReference(requestedDate,subjectId) {
    state=readState();
    const date = clampPlanDate(requestedDate||selectedDate);
    openSheet('参考区间', '<form id="reference-form" data-dirty="sheet">' + field('选择计划内日期', 'reference-date', date, { type: 'date', min: state.plan.startDate, max: state.plan.endDate, required: true }) + '<div id="reference-fields">' + referenceFields(date) + '</div><div class="save-row"><button class="cancel-button" type="button" data-action="close-sheet">取消</button><button class="primary" type="submit">保存目标</button></div></form>',true);
    const form=document.getElementById('reference-form');form.dataset.referenceDate=document.getElementById('reference-date').value;form.dataset.plan=activePlanId;form.dataset.revision=state._revision||0;
    const target=form.elements.namedItem(subjectId?'target-'+subjectId:'reference-total');if(target){target.focus();target.closest('fieldset,.field').scrollIntoView({block:'nearest'});}
  }
  function editAllocation(){
    state=readState();if(state.plan.endDate<iso())throw new Error('计划已结束，请先在计划设置中调整日期');
    window.StudyAllocationUI.init({field,rangeFields,quantityDefaultsFields,selectField,escape,today:()=>state.evaluation?window.StudyEvaluation.shift(window.StudyEvaluation.context(state.evaluation.timezone).today,1):iso()});
    openSheet('总体任务分配',window.StudyAllocationUI.view(state),true);
    const form=document.getElementById('allocation-form');form.dataset.plan=activePlanId;form.dataset.revision=state._revision||0;
    window.StudyAllocationUI.sync(form,state);
  }
  function saveEvaluationSchedule(form){
    const latest=readState(),command=window.StudyEvaluationUI.command(form,latest);
    if(command.planId!==activePlanId||command.expectedRevision!==(latest._revision||0))throw new Error('记录已更新，请重新打开日程');
    const candidate=window.StudyEvaluation.scheduleChange(latest,command,window.StudyEvaluation.context(latest.evaluation.timezone));M().validateState(candidate);
    const changed=Object.keys(candidate.evaluation.bases).filter(d=>d>=command.from&&JSON.stringify(candidate.evaluation.bases[d].items)!==JSON.stringify(latest.evaluation.bases[d]?.items));
    if(!window.confirm('保存评估日程？\n'+command.from+' 起，'+changed.length+' 个未来日期的目标要求将更新。'))return false;
    const result=call('saveEvaluationSchedule',JSON.stringify(command));if(!result.ok)throw new Error('日程未能保存，请重试');completeDraft();dirty.delete('sheet');state=readState();closeSheet(true);render();tell('日程已保存');return true;
  }
  function saveAllocation(form){
    const latest=readState();
    if(form.dataset.plan!==call('getPlans').activeId)throw new Error('计划已切换，请重新打开总体任务分配');
    if(Number(form.dataset.revision)!==(latest._revision||0))throw new Error('记录已更新，请重新打开总体任务分配');
    const result=window.StudyAllocation.apply(latest,window.StudyAllocationUI.values(form,latest),iso());
    if(!result.report.changes.length){feedback.delete('sheet');syncFeedback(form);tell('分配未修改');return false;}
    if(!window.confirm(window.StudyAllocationUI.summary(result.report))){feedback.delete('sheet');syncFeedback(form);return false;}
    persist(result.state);dirty.delete('sheet');closeSheet(true);render();tell('分配已应用');return true;
  }
  function syncReferenceForm(form,changed){
    const date=form.elements.namedItem('reference-date').value,subjects=M().subjectsForDate(state,date).filter(s=>s.kind!=='vocab'&&!isQuantity(s)),entries=subjects.map(s=>({id:s.id,reference:{min:Number(form.elements.namedItem('target-'+s.id).value),max:Number(form.elements.namedItem('target-'+s.id+':max').value)}}));
    if(!entries.length)return;
    const lower=form.elements.namedItem('reference-total'),upper=form.elements.namedItem('reference-total:max');
    if(changed==='reference-total'||changed==='reference-total:max'){
      const total={min:Number(lower.value),max:Number(upper.value)};
      if(lower.value===''||upper.value===''||total.min>total.max||!lower.checkValidity()||!upper.checkValidity())return;
      R().distribute(entries,total).forEach(e=>{form.elements.namedItem('target-'+e.id).value=R().decimal(e.reference.min);form.elements.namedItem('target-'+e.id+':max').value=R().decimal(e.reference.max);});
    }else{
      lower.value=R().decimal(entries.reduce((sum,e)=>sum+e.reference.min,0));upper.value=R().decimal(entries.reduce((sum,e)=>sum+e.reference.max,0));
    }
  }
  function clearWordUndo(input) {
    if (!input) return;
    wordUndo.delete(input);
    input.closest('.word-entry')?.querySelector('[data-action="undo-words"][data-field="'+input.id+'"]')?.setAttribute('hidden','');
  }
  function clearFormWordUndo(form) { form.querySelectorAll('.word-entry input').forEach(clearWordUndo); }
  function changeWords(input, amount) {
    if (!input.checkValidity()) { input.reportValidity(); return; }
    const change = window.StudyWords.addition(input.value, amount);
    change.entryId = window.StudyWordLogUI.addition(input, amount);
    wordUndo.set(input, change); input.value = change.after;
    input.closest('.word-entry').querySelector('[data-action="undo-words"][data-field="'+input.id+'"]').hidden = false;
    notifyWordChange(input);
  }
  function undoWords(input) {
    const change = wordUndo.get(input), before = window.StudyWords.undo(change, input.value);
    if (before === null) { clearWordUndo(input); return; }
    window.StudyWordLogUI.undoAddition(input,change.entryId);
    clearWordUndo(input);
    input.value = before; notifyWordChange(input);
  }
  function notifyWordChange(input) {
    dispatchingWordChange = true;
    try { input.dispatchEvent(new Event('input', {bubbles:true})); } finally { dispatchingWordChange = false; }
    input.closest('.word-entry').querySelector('[data-word-feedback]').textContent = (input.id.startsWith('newWords-') ? '新学 ' : '复习 ') + (input.value === '' ? '未记录' : input.value + ' 个');
  }
  function addSubject() {
    if (state.plan.subjects.length >= 24) { tell('最多支持 24 个科目。'); return; }
    openSheet('添加一个新科目', '<form id="new-subject-form" data-dirty="sheet">' + field('科目名称', 'new-subject-name', '', { required: true, maxLength: 40, placeholder: '例如：专业课' }) + selectField('计量方式','new-subject-measure','minutes',[['minutes','时间（分钟）'],['quantity','数量']]) + field('单位（数量科目）','new-subject-unit','',{maxLength:32,placeholder:'例如：题、页、组'}) + '<p id="new-subject-default-label" class="line-label">周一至周日的默认参考区间（分钟）</p><div id="new-subject-defaults">' + defaultsFields('new-default', [0, 0, 0, 0, 0, 0, 0]) + '</div><div class="save-row"><button class="cancel-button" type="button" data-action="close-sheet">取消</button><button class="primary" type="submit">添加科目</button></div></form>');
  }
  function saveSheet(form) {
    if (!form.reportValidity()) return false;
    const latest = readState();
    if (form.id === 'reference-form') {
      const date = form.elements.namedItem('reference-date').value;
      if (date < latest.plan.startDate || date > latest.plan.endDate) throw new Error('请选择计划日期范围内的一天。');
      const reevaluate=form.elements.namedItem('reference-assessment')?.value==='recalculate';
      if(form.dataset.plan!==call('getPlans').activeId)throw new Error('计划已切换，请重新打开目标');
      if(Number(form.dataset.revision)!==(latest._revision||0))throw new Error('记录已更新，请重新打开目标后保存');
      const times=M().subjectsForDate(latest,date).filter(s=>s.kind!=='vocab'&&!isQuantity(s)),lower=form.elements.namedItem('reference-total'),upper=form.elements.namedItem('reference-total:max');
      if(times.length){
        if(Number(lower.value)>Number(upper.value))throw new Error('总参考下限不能超过上限');
        const sums=times.reduce((r,s)=>({min:r.min+Number(form.elements.namedItem('target-'+s.id).value),max:r.max+Number(form.elements.namedItem('target-'+s.id+':max').value)}),{min:0,max:0});
        if(Math.abs(sums.min-Number(lower.value))>0.0001||Math.abs(sums.max-Number(upper.value))>0.0001)throw new Error('总参考区间与分项不一致，请重新调整');
      }
      R().preserve(latest,latest);
      latest.plan.targets[date] = latest.plan.targets[date] || {};
      M().subjectsForDate(latest,date).forEach(s => { if(s.kind==='vocab'){const value = Number(form.elements.namedItem('target-' + s.id).value);latest.plan.wordTargets=latest.plan.wordTargets||{};latest.plan.wordTargets[date]=latest.plan.wordTargets[date]||{};latest.plan.wordTargets[date][s.id]=value;} else if(isQuantity(s)){const input=form.elements.namedItem('quantity-'+s.id);latest.plan.quantityTargets=latest.plan.quantityTargets||{};latest.plan.quantityTargets[date]=latest.plan.quantityTargets[date]||{};latest.plan.quantityTargets[date][s.id]=Number(input.value);} else {const value = Number(form.elements.namedItem('target-' + s.id).value);const r={min:value,max:Number(form.elements.namedItem('target-'+s.id+':max').value)};R().validate(r,true);const old=M().reference(latest,date,s.id);if(R().range(old).min!==r.min||R().range(old).max!==r.max)window.StudySchedule.markManual(latest,date,[s.id]);latest.plan.targets[date][s.id]=r;} });
      if(reevaluate){const old=R().basis(latest,date),next=R().capture(latest,date);if(JSON.stringify([old.inside,old.time,old.words,old.quantities||[]])!==JSON.stringify([next.inside,next.time,next.words,next.quantities||[]]))R().recalculate(latest,date);}
      planDate = date;
    }
    if (form.id === 'new-plan-form') {
      const subjects = latest.plan.subjects.filter(s => M().subjectActive(s, iso()));
      const fresh = { version: 8, plan: { title: form.elements.namedItem('new-plan-name').value.trim(), startDate: form.elements.namedItem('new-plan-start').value, endDate: form.elements.namedItem('new-plan-end').value, startWeek: 1, subjects: clone(subjects.length ? subjects : latest.plan.subjects.slice(0, 1)).map(s => { delete s.activePeriods; return s; }), targets: {}, weekGoals: {}, weekHints: {}, weekTasks: {}, manualWeekGoals: true }, records: {}, reviews: {}, sessions: [], settings: { reminders: { enabled: false, weekdayTime: '19:15', weekendTime: '10:00' } } };
      if(latest.plan.manualReferenceDefaults)fresh.plan.manualReferenceDefaults=latest.plan.manualReferenceDefaults.filter(id=>fresh.plan.subjects.some(s=>s.id===id));
      M().dates(fresh.plan.startDate, fresh.plan.endDate).forEach(date => { fresh.plan.targets[date] = {}; fresh.plan.subjects.forEach(s => {const value=clone(s.defaults[(localDate(date).getDay()+6)%7]);if(isQuantity(s)){fresh.plan.quantityTargets=fresh.plan.quantityTargets||{};fresh.plan.quantityTargets[date]=fresh.plan.quantityTargets[date]||{};fresh.plan.quantityTargets[date][s.id]=value;}else fresh.plan.targets[date][s.id]=value;}); });
      M().validateState(fresh); const result = call('createPlan', JSON.stringify(fresh)); completeDraft(); dirty.delete('sheet'); switchPlan(result.id, true); return true;
    }
    if (form.id === 'new-subject-form') {
      const measure=form.elements.namedItem('new-subject-measure').value, unit=form.elements.namedItem('new-subject-unit').value.trim();
      if(measure==='quantity') { if(!unit) throw new Error('请填写数量单位'); const defaults=readQuantityDefaults(form); M().addSubject(latest, form.elements.namedItem('new-subject-name').value.trim(), defaults, iso(), 'quantity', unit); }
      else M().addSubject(latest, form.elements.namedItem('new-subject-name').value.trim(), readDefaults(form), iso(), 'minutes');
    }
    persist(latest);
    closeSheet(true);
    render();
    tell('已保存');
    return true;
  }

  function timerText(milliseconds) {
    const seconds = Math.floor(Math.max(0, milliseconds || 0) / 1000);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
  }
  function updateTimer() {
    if (!bridge || !booted) return;
    let snapshot;
    try { snapshot = call('getTimer'); } catch (_) { return; }
    const previous = lastTimer;
    lastTimer = snapshot;
    if (previous.active && !snapshot.active && !window.__finishingTimer) {
      if (dirty.size) { nativeRefreshPending = true; state = readState(); refreshStoredSummary(); }
      else { try { state = readState(); render(); return; } catch (e) { tell(e.message); } }
    }
    const panel = document.getElementById('timer-panel');
    if (!panel) return;
    panel.hidden = !snapshot.active;
    if (!snapshot.active) { timerSignature = ''; return; }
    const signature = [snapshot.subjectId, snapshot.subjectName, snapshot.date, snapshot.running, snapshot.message].join('|');
    if (signature !== timerSignature) {
      timerSignature = signature;
      panel.innerHTML = '<div class="timer-title-row"><strong><i class="timer-indicator' + (snapshot.running ? ' running' : '') + '"></i>' + escape(snapshot.subjectName) + ' · ' + (snapshot.running ? '正在计时' : '已暂停') + '</strong><span class="saved-mark">' + briefDate(snapshot.date) + '</span></div><div class="timer-time" id="timer-elapsed">' + timerText(snapshot.elapsedMs) + '</div>' + (snapshot.message ? '<p class="timer-message" role="status">' + escape(snapshot.message) + '</p>' : '') + '<div class="timer-actions"><button type="button" data-action="timer-' + (snapshot.running ? 'pause' : 'resume') + '">' + icon(snapshot.running ? 'pause' : 'play') + (snapshot.running ? '暂停' : '继续') + '</button><button class="primary" type="button" data-action="timer-finish">' + icon('check') + '结束并保存</button></div><button class="text-button timer-discard" data-action="timer-discard" type="button">丢弃本次计时</button>';
    }
    const elapsed = document.getElementById('timer-elapsed');
    if (elapsed) elapsed.textContent = timerText(snapshot.elapsedMs);
  }
  function startTimer(id) {
    if (selectedDate !== iso()) throw new Error('只能为真实的今天计时；历史日期可以手动补记。');
    const subject = state.plan.subjects.find(s => s.id === id);
    if (!subject) throw new Error('未找到这个科目。');
    const timer = call('startTimer', id, subject.name, selectedDate);
    if (timer.active) { timerSignature = ''; updateTimer(); tell('计时已开始'); }
    return !!timer.active;
  }
  function timerPicker() {
    if(selectedDate!==iso())throw new Error('请选择今天开始计时');
    const subjects=M().subjectsForDate(state,selectedDate).filter(s=>s.kind!=='vocab'&&!isQuantity(s));
    const allowed=M().allowed();
    openSheet('选择计时科目',subjects.map(subject=>'<button type="button" class="setting-action" data-action="start-timer" data-subject="'+escape(subject.id)+'"'+(allowed?'':' disabled')+'><span>'+escape(subject.name)+'</span>'+icon('play')+'</button>').join('')+(allowed?'':'<p class="inline-form-note">'+escape(restReason())+'</p>'),true);
    dialog.classList.add('timer-picker-sheet');
  }
  function timerAction(action) {
    if (action === 'discard' && !window.confirm('丢弃这次未保存的计时？')) return;
    if (action === 'finish' && dirty.has('daily')) { submitForm(document.getElementById('daily-form')).then(saved => { if (saved) attempt(() => timerAction('finish')); }); return; }
    window.__finishingTimer = action === 'finish';
    try {
      const result = call('timerAction', action);
      if (action === 'finish' && result.finished) {
        state = readState();
        lastTimer = call('getTimer');
        if (!dirty.size) render();
        tell('已保存 ' + minuteLabel(result.minutes) + ' 分钟');
      } else { timerSignature = ''; updateTimer(); }
    } finally { window.__finishingTimer = false; }
  }
  function backupAction(name) {
    if (dirty.size) { tell('页面有未保存的修改，请先保存。'); return; }
    if (name === 'importBackup' && call('getTimer').active) { openSheet('当前计时尚未保存', '<div class="save-row"><button class="cancel-button" data-action="close-sheet">取消</button><button class="primary" data-action="finish-for-restore">保存本次记录</button><button data-action="discard-for-restore">丢弃本次计时</button></div>'); return; }
    const result = call(name);
    if (result.ok && preview && name === 'exportBackup') tell('备份已生成，请保存下载的 JSON 文件。');
  }

  document.addEventListener('click', event => {
    const nav = event.target.closest('[data-nav]');
    if (nav) { event.preventDefault(); attempt(() => navigate(nav.dataset.nav)); return; }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    attempt(() => {
      const action = button.dataset.action;
      if (action === 'close-sheet') { closeSheet(); return; }
      if (action === 'timer-picker') { timerPicker(); return; }
      if (action === 'edit-allocation') { editAllocation(); return; }
      if(action==='evaluation-schedule'){const ctx=window.StudyEvaluation.context(state.evaluation.timezone);if(window.StudyEvaluation.shift(ctx.today,1)>state.plan.endDate)throw new Error('计划内没有可安排的未来日期');openSheet('评估日程',window.StudyEvaluationUI.editor(state));window.StudyEvaluationUI.sync(document.getElementById('evaluation-schedule-form'));return;}
      if(action==='auto-continue'){const r=window.StudyEvaluation.assess(state,selectedDate),item=r&&r.items.find(i=>i.required&&i.achieved!==true),id=(item?.sources.find(s=>s.requiredInput&&state.records[selectedDate]?.subjects?.[s.subjectId]?.[s.field]==null)||item?.sources[0])?.subjectId||visibleSubjects(selectedDate)[0]?.id;if(id)window.StudyLayout.showSubject(id);return;}
      if (action === 'allocation-weekdays') { window.StudyAllocationUI.weekdays(button.closest('form'),state); return; }
      if (action === 'start-timer') { const started=startTimer(button.dataset.subject);if(started&&dialog.classList.contains('timer-picker-sheet'))closeSheet(true);return; }
      if (action.startsWith('timer-')) { timerAction(action.slice(6)); return; }
      if (action === 'choose-day' || action === 'day-prev' || action === 'day-next' || action === 'go-today') {
        if (!leaveEdits()) return;
        selectedDate = action === 'choose-day' ? button.dataset.date : action === 'go-today' ? iso() : shift(selectedDate, action === 'day-prev' ? -1 : 1);
        render(); return;
      }
      if (action === 'open-history') { navigate('today', button.dataset.date); return; }
      if (action === 'week-prev' || action === 'week-next') {
        if (!leaveEdits()) return;
        const scope = button.dataset.scope;
        const day = scope === 'plan' ? planDate : reviewDate;
        const next = shift(weekOf(day).key, action === 'week-prev' ? -1 : 7);
        if (scope === 'plan') planDate = clampPlanDate(next); else reviewDate = clampPlanDate(next);
        render(); return;
      }
      if (action === 'edit-week') editWeek(button.dataset.scope === 'today' ? selectedDate : button.dataset.scope === 'review' ? reviewDate : planDate);
      if (action === 'week-history') weekHistory();
      if (action === 'week-open') editWeekKey(button.dataset.key);
      if (action === 'week-move') showWeekMove(button.dataset.key);
      if(action==='course-manager')showCourses(route==='plan'?planDate:selectedDate);
      if(action==='course-edit')editCourses();
      if(action==='course-change')editCourses(true);
      if(action==='course-add-row'||action==='course-remove-row'){
        const form=button.closest('form');
        if(action==='course-add-row')window.StudyCourseUI.add(form);else{button.closest('[data-course-id]').remove();window.StudyCourseUI.sync(form);}
        dirty.add('sheet');feedback.delete('sheet');syncFeedback(form);window.StudyDrafts.save(form);
      }
      if(action==='course-revert-change'){
        const latest=readState();if(!window.confirm('撤销这次调课，恢复原日期的课程？'))return;
        persist(window.StudyCourses.removeChange(latest,button.dataset.id,iso()));closeSheet(true);render();showCourses(courseViewDate);tell('调课已撤销');
      }
      if (action === 'course-schedule') showCourseSchedule();
      if (action === 'weekend-schedule') showCourseSchedule(true);
      if (action === 'apply-course-schedule') {
        const latest=readState(),weekendsOnly=button.dataset.mode==='weekends',schedule=window.StudySchedule,dates=weekendsOnly?schedule.weekendDates(latest,iso()):null;
        const from=weekendsOnly?dates[0]:schedule.from(latest,iso()),to=weekendsOnly?dates[dates.length-1]:latest.plan.endDate;
        if(call('getPlans').activeId!==button.dataset.plan||to!==button.dataset.to||from!==button.dataset.from||String(latest._revision||0)!==button.dataset.revision)throw new Error('计划已变化，请重新打开安排');
        persist(weekendsOnly?M().applyWeekendSchedule(latest,iso()):M().applyCourseSchedule(latest,iso()));closeSheet();render();tell('安排已更新');
      }
      if (action === 'word-log-reset') window.StudyWordLogUI.restoreSaved(button.dataset.subject);
      if (action === 'word-log-add') window.StudyWordLogUI.editor(button.dataset.subject);
      if (action === 'word-log-edit') window.StudyWordLogUI.editor(button.dataset.subject,button.dataset.entry);
      if (action === 'word-log-remove') window.StudyWordLogUI.remove(button.dataset.subject,button.dataset.entry);
      if (action === 'word-log-restore') window.StudyWordLogUI.restore(button.dataset.subject);
      if (action === 'add-words') changeWords(document.getElementById(button.dataset.field), Number(button.dataset.amount));
      if (action === 'undo-words') undoWords(document.getElementById(button.dataset.field));
      if (action === 'edit-reference') editReference(button.dataset.date,button.dataset.subject);
      if(action==='assessment-basis')assessmentBasis(button.dataset.date);
      if(action==='assessment-preview')assessmentPreview(button.dataset.date);
      if(action==='assessment-apply')applyAssessment(button);
      if(action==='assessment-history'){historyFilters={from:button.dataset.from,to:button.dataset.to,assessmentDimension:button.dataset.dimension,assessmentKind:button.dataset.kind||''};navigate('history');}
      if(action==='assessment-rules'&&state.evaluation&&window.StudyEvaluation.covers(state,selectedDate)){openSheet('评估规则',window.StudyEvaluationUI.rules(),true);return;}
      if (action === 'assessment-rules') openSheet('评估规则','<dl class="rest-hours"><dt>照常</dt><dd>当日学习总参考区间</dd><dt>减量</dt><dd>总参考区间的 50%</dd><dt>仅回顾</dt><dd>只计算课程复习，使用课程复习区间</dd><dt>休息</dt><dd>休息日</dd></dl><p>低于下限：未完成；区间内（含上下限）：完成；超过上限：超额完成。</p><p>时长未记齐：待补全。单词新学按目标数单独评估，复习另记。</p>',true);
      if (action === 'add-subject') addSubject();
      if (action === 'export-backup') backupAction('exportBackup');
      if (action === 'import-backup') backupAction('importBackup');
      if (action === 'pin-widget') { const result = call('pinWidget'); if (result.requested) tell('已发起添加请求'); else widgetHelp(true); }
      if (action === 'widget-help') widgetHelp(false);
      if(action==='user-manual'){openSheet('使用手册',window.StudyManual.view(),true);dialog.classList.add('manual-sheet');dialog.querySelector('.sheet-heading h2').insertAdjacentHTML('afterend','<button class="text-button manual-directory" type="button" data-action="manual-top">目录</button>');dialog.scrollTop=0;}
      if(action==='manual-section')window.StudyManual.section(button.dataset.section);
      if(action==='manual-top')window.StudyManual.top();
      if (action === 'rest-hours') restHours();
      if (action === 'reminder-help') reminderHelp();
      if (action === 'notification-settings') call('openNotificationSettings');
      if (action === 'about') showAbout();
      if (action === 'licenses') openSheet('开源许可','<p>报表字体：Daily Study Report，基于 Noto Sans SC。</p><pre class="license-text">'+escape(call('getFontLicense').text)+'</pre>',true);
      if (action === 'plan-picker') planPicker();
      if (action === 'new-plan') newPlan();
      if (action === 'switch-plan') switchPlan(button.dataset.plan);
      if (action === 'plan-finish') { const result = call('timerAction', 'finish'); if (!result.finished) throw new Error('当前计时未能保存'); switchPlan(button.dataset.plan); }
      if (action === 'plan-discard') { if (!window.confirm('丢弃本次未保存计时？')) return; call('timerAction', 'discard'); switchPlan(button.dataset.plan); }
      if (['archive-subject', 'restore-subject', 'move-subject'].includes(action)) {
        if (!leaveEdits()) return;
        const id = button.dataset.subject, timer = call('getTimer');
        if (action === 'archive-subject' && timer.active && timer.subjectId === id) throw new Error('请先保存或丢弃该科目的计时');
        const latest = readState();
        if (action === 'archive-subject') { if (!window.confirm('归档「' + M().subjectsForDate(latest, iso()).find(s => s.id === id).name + '」？')) return; M().archiveSubject(latest, id, iso()); }
        if (action === 'restore-subject') M().restoreSubject(latest, id, iso());
        if (action === 'move-subject') M().moveSubject(latest, id, Number(button.dataset.direction));
        persist(latest); render();
      }
      if (action === 'tracking-open-day') navigate('today', button.dataset.date);
      if (action === 'tracking-search') { historyFilters = {}; document.querySelectorAll('[data-tracking-filter]').forEach(e => { historyFilters[e.dataset.trackingFilter] = e.value; }); render(); }
      if (action === 'tracking-reset') { historyFilters = {}; render(); }
      if (action === 'tracking-sessions-search') { sessionFilters = {}; document.querySelectorAll('[data-session-filter]').forEach(e => { sessionFilters[e.dataset.sessionFilter] = e.value; }); render(); }
      if (action === 'tracking-sessions-reset') { sessionFilters = {}; render(); }
      if (action === 'tracking-month-prev' || action === 'tracking-month-next') { const d = localDate((month || iso().slice(0, 7)) + '-01'); d.setMonth(d.getMonth() + (action.endsWith('prev') ? -1 : 1)); month = iso(d).slice(0, 7); render(); }
      if (action === 'export-report') reportForm();
      if (action === 'clear-drafts' && window.confirm('清除全部计划的未保存草稿？')) { call('clearDrafts'); dirty.clear(); feedback.clear(); render(); }
      if (action === 'backup-notification-settings') call('openBackupNotificationSettings');
      if (action === 'update-open') showStartupUpdate();
      if (action === 'update-check') { call('checkUpdate'); updatePanel(); }
      if (action === 'update-download') { call('downloadUpdate'); updatePanel(); }
      if (action === 'update-cancel') { call('cancelUpdate'); updatePanel(); }
      if (action === 'update-install') installUpdate();
      if (action === 'update-return') returnToUpdate();
      if (action === 'update-finish') { const result = call('timerAction', 'finish'); if (!result.finished) throw new Error('当前计时未能保存'); state = readState(); returnToUpdate(); installUpdate(); }
      if (action === 'update-discard') { if (!window.confirm('丢弃本次未保存计时？')) return; const result = call('timerAction', 'discard'); if (result.active) throw new Error('当前计时未能丢弃'); returnToUpdate(); installUpdate(); }
      if (action === 'retry-save') { submitForm(document.getElementById(button.dataset.form),!!button.closest('#daily-record-editor')); return; }
      if (action === 'finish-for-restore') { const result = call('timerAction', 'finish'); if (!result.finished) throw new Error('当前计时未能保存'); state = readState(); closeSheet(true); backupAction('importBackup'); }
      if (action === 'discard-for-restore') { if (!window.confirm('丢弃本次未保存计时？')) return; const result = call('timerAction', 'discard'); if (result.active) throw new Error('当前计时未能丢弃'); closeSheet(true); backupAction('importBackup'); }
      if (action === 'retry-load') boot();
    });
  });
  document.addEventListener('input', event => {
    const form = event.target.closest('form[data-dirty]');
    if (!form || event.target.id === 'reference-date') return;
    if(form.id==='reference-form')syncReferenceForm(form,event.target.id);
    if(form.id==='allocation-form'){window.StudyAllocationUI.sync(form,state,event.target.id);if(event.target.id==='allocation-weekday')return;}
    if (!dispatchingWordChange) { clearWordUndo(event.target); attempt(()=>window.StudyWordLogUI.input(event.target)); }
    dirty.add(form.dataset.dirty);
    feedback.delete(form.dataset.dirty);
    syncFeedback(form);
    window.StudyDrafts.save(form);
  });
  document.addEventListener('study-draft-applied',event=>{if(event.target.id==='reference-form')syncReferenceForm(event.target,'');if(event.target.id==='allocation-form')window.StudyAllocationUI.sync(event.target,state);window.StudyWordLogUI.reset(event.target);window.StudyWordLogUI.sync(event.target,true);window.StudyLayout.sync();});
  document.addEventListener('study-reference-draft', event => attempt(() => {
    const {form,draft,sourceKey}=event.detail,date=draft.values['reference-date'];
    if(typeof date!=='string'||!within(date))throw new Error('草稿日期不在当前计划范围，请先调整计划日期');
    M().dates(date,date);
    const destination=activePlanId+':reference:'+date,existing=call('getDraft',destination).draft;
    if(existing&&JSON.stringify(existing.values)!==JSON.stringify(draft.values)&&!window.confirm(date+' 已有目标草稿。使用这份草稿替换？'))return;
    const base=clone(draft.base);base['reference-date']=date;
    call('saveDraft',destination,JSON.stringify(base),JSON.stringify(draft.values));
    call('deleteDraft',sourceKey);
    form.elements.namedItem('reference-date').value=date;form.dataset.referenceDate=date;
    document.getElementById('reference-fields').innerHTML=referenceFields(date);
    dirty.delete('sheet');feedback.delete('sheet');syncFeedback(form);window.StudyDrafts.attach(form);
  }));
  document.addEventListener('change', event => {
    if(event.target.closest('#evaluation-schedule-form'))window.StudyEvaluationUI.sync(event.target.form,event.target.id==='evaluation-type');
    if (event.target.id === 'new-subject-measure') {
      const quantity = event.target.value === 'quantity', label = document.getElementById('new-subject-default-label'), box = document.getElementById('new-subject-defaults');
      if (label) label.textContent = quantity ? '周一至周日的默认每日目标' : '周一至周日的默认参考区间（分钟）';
      if (box) box.innerHTML = quantity ? quantityDefaultsFields('new-default-quantity', [0,0,0,0,0,0,0]) : defaultsFields('new-default', [0,0,0,0,0,0,0]);
      const unit = document.getElementById('new-subject-unit'); if (unit) unit.required = quantity;
    }
    if (event.target.id === 'day-picker') {
      const date = event.target.value;
      if (!date) return;
      attempt(() => { if (leaveEdits()) { selectedDate = date; render(); } else event.target.value = selectedDate; });
    }
    if (event.target.id === 'reference-date') {
      const date = event.target.value, form = event.target.form, previous = form.dataset.referenceDate;
      if (!date || !within(date)) { event.target.value = previous; return; }
      event.target.value = previous;
      if (!window.StudyDrafts.save(form) && !window.confirm('草稿未保存。丢弃输入并切换日期？')) return;
      event.target.value = date;
      document.getElementById('reference-fields').innerHTML = referenceFields(date);
      form.dataset.referenceDate = date;form.dataset.revision=state._revision||0;
      dirty.delete('sheet'); feedback.delete('sheet'); syncFeedback(form);
      window.StudyDrafts.attach(form);
      return;
    }
    if(event.target.id==='allocation-weekday'){window.StudyAllocationUI.sync(event.target.form,state);return;}
    if(event.target.id==='course-view-date'){showCourses(event.target.value);return;}
    if(event.target.closest('#course-change-form')&&['course-from','course-change-mode'].includes(event.target.id))window.StudyCourseUI.refreshChange(event.target.form,state);
    const form = event.target.closest('form[data-dirty]');
    if (form) { clearWordUndo(event.target);dirty.add(form.dataset.dirty); feedback.delete(form.dataset.dirty); syncFeedback(form); window.StudyDrafts.save(form); }
    if (event.target.id === 'reminders-enabled') { if (event.target.checked) attempt(() => call('requestNotificationAccess')); updatePermissionStatus(); }
    if (event.target.id === 'backup-enabled' && event.target.checked) attempt(() => call('requestNotificationAccess'));
    if (event.target.id === 'tracking-month') { month = event.target.value; render(); }
  });
  document.addEventListener('submit', event => {
    event.preventDefault();
    if (event.target.id === 'report-form') { const form = event.target; if (!form.reportValidity()) return; attempt(() => { call('exportReport', form.elements.namedItem('report-format').value, form.elements.namedItem('report-from').value, form.elements.namedItem('report-to').value, form.elements.namedItem('report-subject').value); closeSheet(true); }); return; }
    if (event.target.matches('form[data-dirty]')) submitForm(event.target,event.submitter?.hasAttribute('data-daily-editor-save'));
  });

  dialog.addEventListener('cancel', event => { event.preventDefault(); closeSheet(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientY < box.top || event.clientY > box.bottom) closeSheet(); } });

  function launchRoute() {
    if (bridge && typeof bridge.getLaunchRoute === 'function') { const target = call('getLaunchRoute').route; if (target) navigate(target); }
  }
  window.onNativeResume = function () {
    if (!booted || !bridge) return;
    attempt(() => {
      launchRoute();
      const currentPlan = call('getPlans').activeId;
      if (currentPlan !== activePlanId) { window.StudyDrafts.flush(); dirty.clear(); feedback.clear(); activePlanId = currentPlan; }
      updatePermissionStatus();
      updatePanel();
      checkForegroundUpdate();
      if (dirty.size) { nativeRefreshPending = true; state = readState(); refreshStoredSummary(); updateTimer(); return; }
      state = readState();
      planDate = clampPlanDate(planDate); reviewDate = clampPlanDate(reviewDate);
      render();
    });
  };
  window.onBackupRestored = function () {
    dirty.clear(); feedback.clear(); nativeRefreshPending = false;
    historyFilters = {}; sessionFilters = {};
    window.InspirationUI.restored();
    window.InspirationUI.init(bridge, () => { if (booted && route === 'inspiration') render(); }, tell, false);
    if (dialog.open) dialog.close();
    dialog.replaceChildren();
    attempt(() => { state = readState(); booted = true; selectedDate = iso(); planDate = clampPlanDate(selectedDate); reviewDate = planDate; lastTimer = call('getTimer'); render(); tell('备份已恢复'); });
  };
  // Native may display this message after its asynchronous document picker completes.
  window.onNativeMessage = message => tell(message);
  window.handleNativeBack = function () {
    try {
      if (window.InspirationUI.back()) return true;
      if (dialog.open) { closeSheet(); return true; }
      if (window.StudyLayout.closeEditor()) return true;
      if (route !== 'today') { navigate('today'); return true; }
      if (dirty.size) return !leaveEdits();
      return false;
    } catch (error) { tell(error.message); return true; }
  };

  async function createPreviewBridge() {
    const key = 'study-checkin-preview-v1', timerKey = 'study-checkin-preview-timer-v1';
    const existing = localStorage.getItem(key);
    if (!existing) {
      const response = await fetch('seed.json');
      if (!response.ok) throw new Error('无法加载本地预览数据。请通过 HTTP 打开 assets 目录。');
      const seed = await response.json(); M().validateState(seed); localStorage.setItem(key, JSON.stringify(seed));
    }
    const load = () => JSON.parse(localStorage.getItem(key));
    const save = s => { localStorage.setItem(key, JSON.stringify(s)); };
    save(M().migrateState(load()));
    const timerLoad = () => JSON.parse(localStorage.getItem(timerKey) || '{"active":false}');
    const timerSave = t => localStorage.setItem(timerKey, JSON.stringify(t));
    const allowedNow = () => { const d = new Date(), minutes = d.getHours() * 60 + d.getMinutes(); return d.getDay() === 0 || d.getDay() === 6 ? minutes >= 570 && minutes < 1140 : minutes < 1230; };
    const snapshot = () => {
      const t = timerLoad();
      if (!t.active) return { active: false };
      if (t.running) {
        const now = Date.now();
        const boundary = localDate(t.date); boundary.setHours(0, 0, 0, 0); const wd = boundary.getDay(); boundary.setMinutes(wd === 0 || wd === 6 ? 1140 : 1230);
        const elapsedEnd = Math.min(now, boundary.getTime());
        const extra = Math.max(0, elapsedEnd - t.startedAt);
        if (!allowedNow() || t.date !== iso()) { t.elapsedMs += extra; t.running = false; t.message = '已经到了休息时段，计时已暂停。'; timerSave(t); }
        else return { ...t, elapsedMs: t.elapsedMs + extra };
      }
      return t;
    };
    const adapter = {
      getState: () => JSON.stringify(M().migrateState(load())),
      getPlans: () => JSON.stringify({activeId:'main',plans:[{id:'main',name:load().plan.title}]}),
      getDraft: k => JSON.stringify({draft:JSON.parse(localStorage.getItem('preview-draft:'+k)||'null')}),
      saveDraft: (k,b,v) => { localStorage.setItem('preview-draft:'+k,JSON.stringify({base:JSON.parse(b),values:JSON.parse(v)}));return JSON.stringify({ok:true}); },
      deleteDraft: k => { localStorage.removeItem('preview-draft:'+k);return JSON.stringify({ok:true}); },
      clearDrafts: () => {Object.keys(localStorage).filter(k=>k.startsWith('preview-draft:')).forEach(k=>localStorage.removeItem(k));return JSON.stringify({ok:true});},
      getBackupStatus: () => JSON.stringify({lastExportAt:null,reminderEnabled:false,reminderDays:7,notificationsAllowed:false}),
      setBackupReminder: () => JSON.stringify({error:'请在安卓 APP 中设置备份提醒'}),
      createPlan: () => JSON.stringify({error:'请在安卓 APP 中创建计划'}),
      exportReport: () => JSON.stringify({error:'请在安卓 APP 中导出报表'}),
      saveEvaluationSchedule: raw => {const command=JSON.parse(raw),current=load();if(command.expectedRevision!==(current._revision||0))return JSON.stringify({error:'记录已更新，请重新打开日程'});const next=window.StudyEvaluation.scheduleChange(current,command,window.StudyEvaluation.context(current.evaluation.timezone));next._revision=(current._revision||0)+1;M().validateState(next);save(next);return JSON.stringify({ok:true,revision:next._revision});},
      saveState: json => { const s = JSON.parse(json); M().validateState(s); const current = load(); if ((s._revision || 0) !== (current._revision || 0)) return JSON.stringify({ error: '记录已经更新，请刷新后保存。' }); R().preserve(current,s);window.StudyEvaluation.reconcile(current,s,window.StudyEvaluation.context(current.evaluation.timezone));s._revision = (current._revision || 0) + 1; save(s); return JSON.stringify({ ok: true, revision: s._revision }); },
      getTimer: () => JSON.stringify(snapshot()),
      startTimer: (id, name, date) => { if (snapshot().active) return JSON.stringify({ error: '已有活动计时，请先结束或丢弃。' }); if (date !== iso()) return JSON.stringify({ error: '只能为今天计时。' }); if (!allowedNow()) return JSON.stringify({ error: '现在为休息时段' }); const t = { active: true, subjectId: id, subjectName: name, date, running: true, elapsedMs: 0, startedAt: Date.now(), message: '' }; timerSave(t); return JSON.stringify(t); },
      timerAction: action => {
        let t = snapshot(); if (!t.active) return JSON.stringify({ error: '没有活动计时。' });
        if (action === 'pause' && t.running) { t = { ...t, running: false }; timerSave(t); }
        if (action === 'resume') { if (!allowedNow() || t.date !== iso()) return JSON.stringify({ error: '现在无法继续计时，请保存已有学习时间。' }); t.running = true; t.startedAt = Date.now(); t.message = ''; timerSave(t); }
        if (action === 'discard') { timerSave({ active: false }); return JSON.stringify({ active: false }); }
        if (action === 'finish') {
          const s = load(), r = M().record(s, t.date), seconds = t.elapsedMs / 1000, minutes = seconds / 60;
          const subject = r.subjects[t.subjectId]; subject.minutes = (subject.minutes || 0) + minutes;
          if (subject.minutes > 1440) return JSON.stringify({ error: '当天累计实际超过 1440 分钟，请检查手动记录。' });
          if (r.status == null) r.status = '正常参考';
          M().saveRecord(s, t.date, r); s.sessions = s.sessions || []; s.sessions.push({ id: 'preview-' + Date.now(), date: t.date, subjectId: t.subjectId, seconds, endedAt: new Date().toISOString() }); s._revision = (s._revision || 0) + 1; save(s); timerSave({ active: false });
          return JSON.stringify({ finished: true, date: t.date, subjectId: t.subjectId, seconds, minutes });
        }
        return JSON.stringify(snapshot());
      },
      exportBackup: () => { const blob = new Blob([JSON.stringify(load(), null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = '每日学习备份_' + iso() + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return JSON.stringify({ ok: true }); },
      importBackup: () => { document.getElementById('preview-import').click(); return JSON.stringify({ ok: true }); },
      pinWidget: () => JSON.stringify({ error: '浏览器预览不支持桌面小组件，请在 Android APP 中添加。' }),
      getPlatformInfo: () => JSON.stringify({ androidVersion: '浏览器预览', notificationsGranted: true, runtimePermissionGranted: true, notificationsEnabled: true, reminderChannelEnabled: true, remindersExact: false, supportsPinWidget: false }),
      getAppInfo: () => JSON.stringify({ versionName: '开发预览', versionCode: null }),
      getUpdateState: () => JSON.stringify({ phase: 'error', error: '请在安卓 APP 中检查更新' }),
      checkUpdate: () => JSON.stringify({ error: '请在安卓 APP 中检查更新' }),
      requestNotificationAccess: () => JSON.stringify({ ok: true }),
      openNotificationSettings: () => JSON.stringify({ error: '请在安卓APP中打开通知设置' })
    };
    document.getElementById('preview-import').addEventListener('change', async event => {
      try {
        const file = event.target.files[0]; if (!file) return;
        const imported = JSON.parse(await file.text()); const s = imported.state || imported; M().validateState(s);
        if (!window.confirm('确认用这个备份替换当前浏览器预览记录？建议先导出当前记录。')) return;
        s._revision = (load()._revision || 0) + 1; save(s); timerSave({ active: false }); window.onBackupRestored();
      } catch (error) { tell('备份没有恢复：' + error.message); } finally { event.target.value = ''; }
    });
    Object.assign(adapter, await window.createInspirationPreview());
    return adapter;
  }

  async function boot() {
    try {
      if (!window.StudyModel) throw new Error('记录模块未加载，请重新打开 APP。');
      bridge = window.Native || await createPreviewBridge();
      state = readState();
      window.StudyEvaluationUI.init({planId:()=>activePlanId});
      window.StudyWordLogUI.init({escape,field,selectField,openSheet,closeSheet,clearUndo:clearFormWordUndo,baseline:subject=>initialDaily?.subjects[subject]});
      window.StudyWeekUI.init(() => state.plan);
      activePlanId = call('getPlans').activeId;
      window.StudyDrafts.init(call, draftKey, (form, value = true) => { clearFormWordUndo(form); if (value) dirty.add(form.dataset.dirty); else dirty.delete(form.dataset.dirty); feedback.delete(form.dataset.dirty); syncFeedback(form); });
      selectedDate = iso(); planDate = clampPlanDate(selectedDate); reviewDate = planDate;
      lastTimer = call('getTimer'); booted = true; dirty.clear();
      render();
      window.InspirationUI.init(bridge, () => { if (booted && route === 'inspiration') render(); }, tell);
      launchRoute();
      checkStartupUpdate();
    } catch (error) {
      booted = false;
      bridge = bridge || window.Native;
      app.innerHTML = '<div class="error-state"><h1>读取失败</h1><p class="hint">' + escape(error.message) + '</p><button class="primary" data-action="retry-load">重新读取</button>' + (bridge ? '<button class="secondary-wide" data-action="import-backup">从备份恢复</button>' : '') + '</div>';
    }
  }
  // Read-only diagnostic hooks used by local UI checks; these do not seed fake records.
  window.StudyUI = { snapshot: () => ({ route, selectedDate, planDate, reviewDate, dirty: Array.from(dirty), timer: clone(lastTimer), preview }), reload: () => window.onNativeResume() };
  boot();
  setInterval(updateTimer, 1000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { window.onStartupUpdateBackground(); window.StudyDrafts.flush(); } else window.onNativeResume(); });
})();
