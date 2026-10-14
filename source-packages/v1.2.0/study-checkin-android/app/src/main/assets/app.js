/* Offline UI. Native is the only production persistence/timing authority. */
(function () {
  'use strict';
  const app = document.getElementById('app');
  const dialog = document.getElementById('sheet');
  const dirty = new Set();
  const saving = new Set(), feedback = new Map();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const monDays = ['一', '二', '三', '四', '五', '六', '日'];
  const statuses = ['正常参考', '减量', '仅回顾', '休息'];
  let bridge, state, route = 'today', selectedDate, planDate, reviewDate;
  let initialDaily = null, lastTimer = { active: false }, timerSignature = '';
  let nativeRefreshPending = false, toastTimeout, booted = false;
  let preview = !window.Native;
  const clone = value => JSON.parse(JSON.stringify(value));
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  const M = () => window.StudyModel;
  const iso = date => M().today(date || new Date());
  const localDate = date => new Date(date + 'T12:00:00');
  const shift = (date, count) => { const d = localDate(date); d.setDate(d.getDate() + count); return iso(d); };
  const within = date => date >= state.plan.startDate && date <= state.plan.endDate;
  const minuteLabel = value => value === null || value === undefined ? '未记录' : value > 0 && value < 1 ? '不足1' : String(Math.round(value * 10) / 10);
  const briefDate = date => date.slice(5).replace('-', '.');
  const fullDate = date => date.replaceAll('-', '.');
  const statusLabel = status => status === '正常参考' ? '照常' : status;
  const restReason = () => { const d = new Date(); return d.getDay() === 0 || d.getDay() === 6 ? (d.getHours() * 60 + d.getMinutes() < 570 ? '09:30 前为休息时段' : '19:00 起为休息时段') : '20:30 起为休息时段'; };
  const recordCount = record => state.plan.subjects.filter(s => record && record.subjects[s.id]?.minutes != null).length;
  const weekOf = date => M().weekInfo(state.plan, date);
  const meaningful = record => !!record && (record.status != null || record.restKept != null || !!record.note || Object.values(record.subjects || {}).some(s => s.minutes != null || s.content || s.problem || s.newWords != null || s.reviewWords != null || s.forgotWords));
  const actualTotal = record => { const values = Object.values(record && record.subjects || {}).filter(s => s.minutes != null).map(s => s.minutes); return values.length ? values.reduce((a, b) => a + b, 0) : null; };
  const refTotal = date => state.plan.subjects.reduce((sum, s) => sum + (within(date) ? M().target(state, date, s.id) : 0), 0);
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
  function readState() { const latest = call('getState'); M().validateState(latest); return latest; }
  function persist(latest) {
    M().validateState(latest);
    if (JSON.stringify(latest) === JSON.stringify(state)) return latest;
    const result = call('saveState', JSON.stringify(latest));
    if (!result || !result.ok) throw new Error('保存没有完成，请重试。');
    if (result.revision !== undefined) latest._revision = result.revision;
    state = latest;
    nativeRefreshPending = false;
    return latest;
  }
  function attempt(action) { try { return action(); } catch (error) { tell(error.message || '操作未完成，请重试。'); return false; } }
  function syncFeedback(form) {
    if (!form) return;
    let element = form.querySelector('.save-feedback');
    if (!element) { element = document.createElement('div'); element.className = 'save-feedback'; const row = form.querySelector('.save-row') || form.querySelector('[type="submit"]'); if (row) row.after(element); else form.append(element); }
    const item = feedback.get(form.dataset.dirty);
    element.hidden = !item;
    element.setAttribute('role', item?.kind === 'error' ? 'alert' : 'status');
    element.innerHTML = item ? '<span>' + escape(item.message) + '</span>' + (item.kind === 'error' ? '<button class="text-button" type="button" data-action="retry-save" data-form="' + escape(form.id) + '">重试</button>' : '') : '';
  }
  async function submitForm(form) {
    if (!form || saving.has(form.dataset.dirty) || !form.reportValidity()) return false;
    const key = form.dataset.dirty, buttons = Array.from(form.querySelectorAll('[type="submit"]')), labels = buttons.map(b => b.innerHTML);
    saving.add(key); buttons.forEach(b => { b.disabled = true; b.textContent = '保存中…'; });
    feedback.set(key, { kind: 'saving', message: '保存中…' }); syncFeedback(form);
    await new Promise(resolve => setTimeout(resolve, 20));
    try {
      let saved = false;
      if (form.id === 'daily-form') saved = saveDaily();
      else if (form.id === 'review-form') saved = saveReview(form);
      else if (form.id === 'range-form') saved = saveRange(form);
      else if (form.dataset.subjectEdit) saved = saveSubject(form);
      else if (form.id === 'reminder-form') saved = saveReminder(form);
      else if (['week-form', 'reference-form', 'new-subject-form'].includes(form.id)) saved = saveSheet(form);
      if (saved) { feedback.set(key, { kind: 'saved', message: '已保存' }); syncFeedback(document.getElementById(form.id)); }
      return !!saved;
    } catch (error) {
      feedback.set(key, { kind: 'error', message: '保存失败：' + (error.message || '请重试') });
      dirty.add(key); syncFeedback(document.getElementById(form.id));
      return false;
    } finally {
      saving.delete(key); buttons.forEach((b, i) => { if (b.isConnected) { b.disabled = false; b.innerHTML = labels[i]; } });
    }
  }
  function refreshStoredSummary() {
    const value = document.getElementById('daily-total'); if (!value || !state) return;
    const record = M().record(state, selectedDate), total = actualTotal(record);
    value.textContent = minuteLabel(total); value.classList.toggle('is-empty', total == null);
    document.getElementById('daily-unit').hidden = total == null;
    document.getElementById('daily-count').textContent = recordCount(record) + '/' + state.plan.subjects.length + ' 科目已记录';
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
  function showAbout() { const info = call('getAppInfo'); openSheet('关于', '<h3>每日学习</h3><p class="about-version" data-build-version="' + escape(info.versionName) + '">版本 ' + escape(info.versionName) + '</p>', true); }
  function leaveEdits() {
    if (saving.size) return false;
    if (!dirty.size) { feedback.clear(); return true; }
    if (!window.confirm('修改尚未保存。放弃修改并离开？')) return false;
    feedback.clear();
    dirty.clear();
    if (nativeRefreshPending) state = readState();
    nativeRefreshPending = false;
    return true;
  }
  function navigate(destination, date) {
    if (destination === route && !date) return;
    if (!attempt(leaveEdits)) return;
    if (dialog.open) dialog.close();
    route = destination;
    if (date) selectedDate = date;
    if (route === 'plan') planDate = clampPlanDate(planDate || selectedDate);
    if (route === 'review') reviewDate = clampPlanDate(reviewDate || selectedDate);
    render();
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
  }
  function field(label, name, value, options = {}) {
    const type = options.type || 'text';
    const attrs = (options.min !== undefined ? ' min="' + options.min + '"' : '') + (options.max !== undefined ? ' max="' + options.max + '"' : '') + (options.step ? ' step="' + options.step + '"' : '') + (options.required ? ' required' : '') + (options.maxLength ? ' maxlength="' + options.maxLength + '"' : '') + (options.help ? ' aria-describedby="' + escape(name) + '-help"' : '');
    return '<div class="field"><label for="' + escape(name) + '">' + escape(label) + '</label>' + (options.textarea ? '<textarea id="' + escape(name) + '" name="' + escape(name) + '" rows="' + (options.rows || 2) + '"' + attrs + ' placeholder="' + escape(options.placeholder || '') + '">' + escape(value) + '</textarea>' : '<input id="' + escape(name) + '" name="' + escape(name) + '" type="' + type + '" value="' + escape(value) + '"' + attrs + (type === 'number' ? ' inputmode="' + (options.step === '1' ? 'numeric' : 'decimal') + '"' : '') + ' placeholder="' + escape(options.placeholder || '') + '">') + (options.help ? '<small id="' + escape(name) + '-help">' + escape(options.help) + '</small>' : '') + '</div>';
  }
  function selectField(label, name, value, values) {
    return '<div class="field"><label for="' + escape(name) + '">' + escape(label) + '</label><select id="' + escape(name) + '" name="' + escape(name) + '">' + values.map(item => '<option value="' + escape(item[0]) + '"' + (String(value) === String(item[0]) ? ' selected' : '') + '>' + escape(item[1]) + '</option>').join('') + '</select></div>';
  }
  function weekNavigation(date, scope) {
    const w = weekOf(date);
    const previous = shift(w.key, -1), next = shift(w.key, 7);
    return '<div class="week-navigation"><button class="icon-button" data-action="week-prev" data-scope="' + scope + '" aria-label="上一周"' + (previous < state.plan.startDate ? ' disabled' : '') + '>' + icon('prev') + '</button><div class="week-label"><strong>第 ' + w.number + ' 教学周 <span class="saved-mark">' + w.parity + '</span></strong><small>' + fullDate(w.start || w.key) + ' — ' + briefDate(w.end) + '</small></div><button class="icon-button" data-action="week-next" data-scope="' + scope + '" aria-label="下一周"' + (next > state.plan.endDate ? ' disabled' : '') + '>' + icon('next') + '</button></div>';
  }
  function todayView() {
    const w = weekOf(selectedDate), date = localDate(selectedDate), today = iso();
    const record = M().record(state, selectedDate);
    initialDaily = clone(record);
    const total = actualTotal(record), reference = refTotal(selectedDate);
    const weekDays = Array.from({ length: 7 }, (_, i) => shift(w.key, i));
    const goal = state.plan.weekGoals[w.key] || '', weekHint = state.plan.weekHints[w.key] || '';
    let html = '<div class="eyebrow">' + (selectedDate === today ? 'TODAY / 每日手记' : 'DAILY / 每日手记') + '</div><div class="date-line"><div><h1 class="date-title">' + briefDate(selectedDate) + '<small>周' + weekdays[date.getDay()] + '</small></h1><p class="date-caption">' + date.getFullYear() + ' 年' + (within(selectedDate) ? ' · 第 ' + w.number + ' 教学周 / ' + w.parity : ' · 计划范围外') + '</p></div><div class="date-tools"><button type="button" class="icon-button" data-action="day-prev" aria-label="前一天">' + icon('prev') + '</button><label class="calendar-control icon-button" aria-label="选择打卡日期">' + icon('today') + '<input id="day-picker" type="date" min="1900-01-01" max="2100-12-31" value="' + selectedDate + '" aria-label="选择打卡日期"></label><button class="icon-button" data-action="day-next" aria-label="后一天">' + icon('next') + '</button></div></div>';
    if (selectedDate !== today) html += '<button class="text-button" data-action="go-today">回到今天 · ' + briefDate(today) + '</button>';
    html += '<div class="week-strip" aria-label="本周日期">' + weekDays.map(d => '<button type="button" class="day-cell' + (d === selectedDate ? ' current' : '') + (d === today ? ' today' : '') + '" data-action="choose-day" data-date="' + d + '"' + (d === selectedDate ? ' aria-current="date"' : '') + '><span>周' + weekdays[localDate(d).getDay()] + '</span><strong>' + Number(d.slice(8)) + '</strong>' + (meaningful(state.records[d]) ? '<i class="record-dot" aria-label="已留记录"></i>' : '') + '</button>').join('') + '</div>';
    if (!within(selectedDate)) html += '<div class="outside-notice">' + (selectedDate > state.plan.endDate ? '计划已结束' : '计划尚未开始') + '<br><button data-nav="plan">查看 / 修改计划</button></div>';
    html += '<div class="overview"><div><span class="metric-label">参考时长</span><strong class="metric-value">' + reference + '</strong><span class="metric-unit">分钟</span></div><div><span class="metric-label">已记录</span><strong class="metric-value' + (total == null ? ' is-empty' : '') + '" id="daily-total">' + minuteLabel(total) + '</strong><span class="metric-unit" id="daily-unit"' + (total == null ? ' hidden' : '') + '>分钟</span><span class="metric-caption" id="daily-count">' + recordCount(record) + '/' + state.plan.subjects.length + ' 科目已记录</span></div></div>';

    if (selectedDate === today && within(selectedDate)) html += '<div class="quick-timers" aria-label="开始今日学习计时">' + state.plan.subjects.map(subject => '<button type="button" data-action="start-timer" data-subject="' + escape(subject.id) + '"' + (!M().allowed() ? ' disabled' : '') + '>' + icon('play') + escape(subject.name) + '计时</button>').join('') + '</div>' + (!M().allowed() ? '<p class="inline-form-note">' + escape(restReason()) + '</p>' : '');
    html += '<div id="timer-panel" class="timer-panel" hidden></div>';
    if (goal || weekHint) html += '<div class="section"><div class="section-heading"><h2>本周的小目标</h2><span class="section-number">01 / PLAN</span></div>' + (goal ? '<p class="goal-copy">' + escape(goal) + '</p>' : '') + (weekHint ? '<p class="hint">' + escape(weekHint) + '</p>' : '') + '</div>';
    html += '<form id="daily-form" data-dirty="daily"><div class="section"><div class="section-heading"><h2>今日记录</h2><span class="section-number">02 / RECORD</span></div>';
    html += state.plan.subjects.map((subject, index) => {
      const r = record.subjects[subject.id] || {}, id = subject.id;
      const ref = within(selectedDate) ? M().target(state, selectedDate, id) : 0;
      const editable = selectedDate === today && within(selectedDate) && M().allowed();
      return '<div class="subject-entry"><div class="subject-heading"><h3><span class="subject-index">' + String(index + 1).padStart(2, '0') + '</span>' + escape(subject.name) + '</h3><span class="reference-pill">参考 ' + ref + ' 分钟</span></div><label class="visually-hidden" for="minutes-' + id + '">' + escape(subject.name) + '实际净学习分钟</label><div class="actual-row"><div class="actual-input"><input type="number" id="minutes-' + id + '" name="minutes-' + id + '" min="0" max="1440" step="any" inputmode="decimal" value="' + escape(r.minutes) + '" placeholder="未记录" aria-label="' + escape(subject.name) + '实际分钟"><span>实际分钟</span></div><button type="button" class="start-button" data-action="start-timer" data-subject="' + id + '"' + (!editable ? ' disabled' : '') + '>' + icon('play') + '计时</button></div><details class="details-toggle"' + (r.content || r.problem || r.newWords != null || r.reviewWords != null || r.forgotWords ? ' open' : '') + '><summary>内容与' + (subject.kind === 'vocab' ? '词量' : '问题') + ' <span class="visually-hidden">展开记录</span></summary>' + field(subject.kind === 'vocab' ? '学习内容（可选）' : '内容 / 题号', 'content-' + id, r.content, { placeholder: subject.kind === 'math' ? '例如：左右极限；教材第 12 页' : '这次主要学习了什么', maxLength: 3000 }) + (subject.kind === 'vocab' ? '<div class="field-inline">' + field('新词接触数', 'newWords-' + id, r.newWords, { type: 'number', min: 0, max: 100000, step: '1', placeholder: '可留空' }) + field('复习词数', 'reviewWords-' + id, r.reviewWords, { type: 'number', min: 0, max: 100000, step: '1', placeholder: '可留空' }) + '</div>' + field('易忘词', 'forgotWords-' + id, r.forgotWords, { textarea: true, placeholder: '留下最需要再回顾的几个词', maxLength: 3000 }) : field('需要回顾的一个问题', 'problem-' + id, r.problem, { textarea: true, placeholder: '例如：链式求导漏乘内层导数', maxLength: 3000 })) + '</details></div>';
    }).join('');
    html += (selectedDate !== today ? '<p class="hint">历史日期 · 手动记录</p>' : '') + '</div><div class="section"><div class="section-heading"><h2>今日安排</h2><span class="section-number">03 / REST</span></div><fieldset class="status-fieldset"><legend class="field-label">今日安排（选填）</legend><div class="status-options">' + statuses.map(status => '<label class="status-option"><input type="radio" name="status" value="' + status + '"' + (record.status === status ? ' checked' : '') + '><span>' + statusLabel(status) + '</span></label>').join('') + '</div></fieldset><div class="rest-control"><label for="rest-kept">休息记录（选填）</label><select id="rest-kept" name="restKept"><option value=""' + (record.restKept == null ? ' selected' : '') + '>未记录</option><option value="true"' + (record.restKept === true ? ' selected' : '') + '>已保留</option><option value="false"' + (record.restKept === false ? ' selected' : '') + '>需要调整</option></select></div>' + field('随记', 'daily-note', record.note, { textarea: true, placeholder: '', maxLength: 5000 }) + '<div class="save-row"><button type="submit" class="primary">' + icon('check') + '保存这一天</button></div></div></form>';
    return html;
  }

  function defaultsFields(prefix, values) {
    return '<div class="default-grid">' + monDays.map((name, i) => '<div class="field"><label for="' + prefix + '-' + i + '">周' + name + '</label><input id="' + prefix + '-' + i + '" name="default-' + i + '" type="number" min="0" max="1440" step="1" inputmode="numeric" value="' + (values && values[i] || 0) + '" required aria-label="周' + name + '默认参考分钟"></div>').join('') + '</div>';
  }
  function planView() {
    const w = weekOf(planDate), dates = M().dates(w.start || w.key, w.end).filter(within);
    const allDays = M().dates(state.plan.startDate, state.plan.endDate);
    let html = '<div class="page-intro"><div class="eyebrow">PLAN / 低强度参考</div><h1>学习计划</h1><p>' + fullDate(state.plan.startDate) + ' — ' + fullDate(state.plan.endDate) + ' · ' + allDays.length + ' 天</p></div>' + weekNavigation(planDate, 'plan');
    const goal = state.plan.weekGoals[w.key];
    if (goal) html += '<p class="goal-copy">' + escape(goal) + '</p>';
    if (state.plan.weekHints[w.key]) html += '<p class="hint">' + escape(state.plan.weekHints[w.key]) + '</p>';
    html += '<div class="week-list">' + dates.map(date => {
      const r = state.records[date], sum = actualTotal(r), today = date === iso();
      const caption = meaningful(r) ? (r.status ? statusLabel(r.status) : sum != null ? '已记录' : '有随记') : '未记录';
      return '<button class="plan-day' + (today ? ' today' : '') + '" data-action="open-history" data-date="' + date + '" aria-label="打开' + fullDate(date) + '记录"><strong class="day-number">' + Number(date.slice(8)) + '</strong><span class="plan-day-meta"><span class="plan-day-date">' + briefDate(date) + ' · 周' + weekdays[localDate(date).getDay()] + (today ? ' · 今天' : '') + '</span><span class="plan-day-subjects">' + state.plan.subjects.map(s => escape(s.name) + ' ' + M().target(state, date, s.id)).join(' / ') + ' <span class="saved-mark">参考分钟</span></span></span><span class="plan-day-state">' + caption + (sum != null ? '<br>' + minuteLabel(sum) + ' 分钟<br><small>' + recordCount(r) + '/' + state.plan.subjects.length + ' 科目已记录</small>' : '') + '</span>' + icon('next') + '</button>';
    }).join('') + '</div><button class="secondary-wide" data-action="edit-week">修改本周目标与提示</button><button class="secondary-wide" data-action="edit-reference">修改某一天参考分钟</button><div class="section"><div class="section-heading"><h2>调整计划</h2><span class="section-number">EDIT / PLAN</span></div><details class="plain-details plan-editor"><summary>日期与教学周</summary><form id="range-form" data-dirty="range">' + field('计划名称', 'plan-title', state.plan.title, { required: true, maxLength: 120 }) + '<div class="field-inline">' + field('开始日期', 'range-start', state.plan.startDate, { type: 'date', min: '1900-01-01', max: '2100-12-31', required: true }) + field('结束日期', 'range-end', state.plan.endDate, { type: 'date', min: '1900-01-01', max: '2100-12-31', required: true }) + '</div>' + field('起始教学周', 'start-week', state.plan.startWeek, { type: 'number', min: 1, max: 999, step: '1', required: true }) + '<p class="inline-form-note">最多 730 天</p><button class="small-submit primary" type="submit">保存日期范围</button></form></details><details class="plain-details"><summary>科目与默认参考</summary>';
    html += state.plan.subjects.map(subject => '<form id="subject-' + subject.id + '" class="subject-editor-item" data-dirty="subject-' + subject.id + '" data-subject-edit="' + subject.id + '">' + field('科目名称', 'name-' + subject.id, subject.name, { required: true, maxLength: 40 }) + '<p class="line-label">新增日期的默认参考分钟</p>' + defaultsFields('defaults-' + subject.id, subject.defaults) + '<button class="compact-button" type="submit">保存 ' + escape(subject.name) + '</button></form>').join('');
    html += '<button class="secondary-wide" data-action="add-subject">' + icon('plus') + '添加新科目</button></details></div>';
    return html;
  }

  function reviewView() {
    const stats = M().weekStats(state, reviewDate), w = weekOf(reviewDate);
    const review = state.reviews[w.key] || {};
    const total = stats.subjects.reduce((sum, s) => sum + (s.actual || 0), 0);
    const actualExists = stats.subjects.some(s => s.actual != null);
    let html = '<div class="page-intro"><div class="eyebrow">REFLECTION / 一周回看</div><h1>每周复盘</h1></div>' + weekNavigation(reviewDate, 'review');
    html += '<div class="overview"><div><span class="metric-label">已记录</span><strong class="metric-value' + (actualExists ? '' : ' is-empty') + '">' + (actualExists ? minuteLabel(total) : '未记录') + '</strong>' + (actualExists ? '<span class="metric-unit">分钟</span>' : '') + '</div><div><span class="metric-label">时长记录天数</span><strong class="metric-value">' + stats.recordedDays + '<small class="metric-unit"> / ' + stats.totalDays + ' 天</small></strong><span class="metric-caption">随记 ' + (stats.entryDays ?? stats.recordedDays) + ' 天</span></div></div><div class="legend"><span><i></i>已记录</span><span><i class="ref-line"></i>参考</span><span>虚线：未记录</span></div>';
    html += stats.subjects.map(subject => {
      const days = stats.days, maximum = Math.max(1, ...days.flatMap(d => [M().target(state, d, subject.id), state.records[d]?.subjects?.[subject.id]?.minutes || 0]));
      const description = days.map(d => fullDate(d) + '，' + minuteLabel(state.records[d]?.subjects?.[subject.id]?.minutes ?? null) + (state.records[d]?.subjects?.[subject.id]?.minutes != null ? '分钟' : '') + '，参考' + M().target(state, d, subject.id) + '分钟').join('；');
      return '<div class="chart-subject"><div class="chart-subject-head"><h3>' + escape(subject.name) + '</h3><span class="chart-value">' + minuteLabel(subject.actual) + (subject.actual != null ? ' 分钟' : '') + ' <small>/ 参考 ' + subject.reference + ' 分钟</small></span></div><div class="bar-chart" role="img" aria-label="' + escape(subject.name + '：' + description) + '">' + days.map(date => {
        const actual = state.records[date]?.subjects?.[subject.id]?.minutes ?? null, ref = M().target(state, date, subject.id);
        return '<div class="chart-day" title="' + date + ' 已记录：' + minuteLabel(actual) + '；参考：' + ref + '"><i class="bar reference" data-height="' + ref / maximum * 100 + '"></i><i class="bar' + (actual == null ? ' missing' : actual === 0 ? ' zero' : '') + '" data-height="' + (actual || 0) / maximum * 100 + '"></i></div>';
      }).join('') + '</div><div class="chart-labels">' + days.map(date => '<span>周' + weekdays[localDate(date).getDay()] + '</span>').join('') + '</div><p class="chart-caption">' + subject.recordedDays + '/' + stats.totalDays + ' 天已记录</p></div>';
    }).join('');
    html += '<form id="review-form" data-dirty="review"><div class="section"><div class="section-heading"><h2>本周随记</h2><span class="section-number">WEEK / NOTE</span></div>' + field('学习强度', 'review-load', review.load, { textarea: true, maxLength: 5000 }) + field('高数回顾', 'review-mathProblem', review.mathProblem, { textarea: true, maxLength: 5000 }) + field('单词复习', 'review-vocabReview', review.vocabReview, { textarea: true, maxLength: 5000 }) + selectField('下周安排（选填）', 'review-adjustment', review.adjustment || '', [['', '暂不决定'], ['维持', '维持'], ['减量', '减量'], ['仅回顾', '仅回顾'], ['休息', '休息'], ['其他', '其他']]) + field('随记', 'review-reason', review.reason, { textarea: true, maxLength: 5000 }) + selectField('半天休息记录（选填）', 'review-halfDayRest', review.halfDayRest == null ? '' : String(review.halfDayRest), [['', '未记录'], ['true', '已保留'], ['false', '需要调整']]) + '<div class="save-row"><button class="primary" type="submit">' + icon('check') + '保存本周复盘</button></div></div></form>';
    return html;
  }

  function settingsView() {
    const reminders = state.settings.reminders;
    return '<div class="page-intro"><div class="eyebrow">SETTINGS / 设置</div><h1>设置</h1></div><form id="reminder-form" data-dirty="reminders"><div class="section-heading"><h2>学习提醒</h2><span class="section-number">01 / REMIND</span></div><div class="settings-row"><h3>开启提醒</h3><label class="switch" aria-label="开启学习提醒"><input id="reminders-enabled" name="enabled" type="checkbox"' + (reminders.enabled ? ' checked' : '') + '><span></span></label></div><div class="field-inline">' + field('工作日', 'weekday-time', reminders.weekdayTime, { type: 'time', required: true, help: '20:30 前' }) + field('周末', 'weekend-time', reminders.weekendTime, { type: 'time', required: true, help: '09:30 — 18:59' }) + '</div><div id="notification-status" class="permission-status" role="status" aria-live="polite" hidden></div><button class="small-submit primary" type="submit">保存提醒设置</button><button class="text-button" type="button" data-action="reminder-help">未收到提醒？</button></form><div class="section"><div class="section-heading"><h2>备份与恢复</h2><span class="section-number">02 / DATA</span></div><button class="setting-action" data-action="export-backup"><span>' + icon('download') + '导出备份</span>' + icon('next') + '</button><button class="setting-action" data-action="import-backup"><span>' + icon('upload') + '从备份恢复</span>' + icon('next') + '</button></div><div class="section"><div class="section-heading"><h2>桌面小组件</h2><span class="section-number">03 / WIDGET</span></div><button class="secondary-wide" data-action="pin-widget">' + icon('widget') + '添加到桌面</button><button class="text-button" data-action="widget-help">添加帮助</button></div><div class="section settings-links"><button class="setting-action" data-action="rest-hours"><span>休息时段</span>' + icon('next') + '</button><button class="setting-action" data-action="about"><span>关于</span>' + icon('next') + '</button></div>';
  }

  function render() {
    if (!state) return;
    // A plan page contains several independent forms. Saving one must retain
    // edits in the others, including their expanded detail sections.
    const drafts = Array.from(app.querySelectorAll('form[data-dirty]')).filter(form => dirty.has(form.dataset.dirty)).map(form => ({ id: form.id, controls: Array.from(form.elements).filter(control => control.name).map(control => ({ name: control.name, type: control.type, value: control.value, checked: control.checked })) }));
    const openDetails = Array.from(app.querySelectorAll('details')).map(detail => detail.open);
    document.querySelectorAll('[data-nav]').forEach(button => {
      if (button.closest('.bottom-nav')) { if (button.dataset.nav === route) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }
    });
    const headerTag = document.getElementById('header-tag');
    headerTag.hidden = !preview; headerTag.textContent = preview ? '开发预览' : '';
    try { document.documentElement.classList.toggle('large-text', call('getPlatformInfo').fontScale >= 1.5); } catch (_) {}
    app.innerHTML = (preview ? '<p class="preview-banner">开发预览：仅此浏览器的本地数据；APK 使用手机本地存储与原生计时。</p>' : '') + ({ today: todayView, plan: planView, review: reviewView, inspiration: () => window.InspirationUI.view(), settings: settingsView }[route])();
    drafts.forEach(draft => { const form = document.getElementById(draft.id); if (!form) return; draft.controls.forEach(saved => { const controls = Array.from(form.elements).filter(control => control.name === saved.name); const control = saved.type === 'radio' ? controls.find(item => item.value === saved.value) : controls[0]; if (!control) return; if (saved.type === 'checkbox' || saved.type === 'radio') control.checked = saved.checked; else control.value = saved.value; }); });
    if (drafts.length) Array.from(app.querySelectorAll('details')).forEach((detail, index) => { if (openDetails[index]) detail.open = true; });
    document.querySelectorAll('[data-height]').forEach(bar => { bar.style.height = Math.max(0, Number(bar.dataset.height)) + '%'; });
    app.querySelectorAll('form[data-dirty]').forEach(syncFeedback);
    updatePermissionStatus();
    timerSignature = '';
    updateTimer();
  }

  function optionalNumber(form, name, integer = false) {
    const input = form.elements.namedItem(name);
    if (!input || input.value.trim() === '') return null;
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 0 || value > (integer ? 100000 : 1440) || (integer && !Number.isInteger(value))) throw new Error(integer ? '词数请填写 0 至 100000 的整数，或留空。' : '实际分钟请填写 0 至 1440 的数字，或留空。');
    return value;
  }
  function saveDaily() {
    const form = document.getElementById('daily-form');
    if (!form || !form.reportValidity()) return false;
    const latest = readState();
    const record = M().record(latest, selectedDate);
    state.plan.subjects.forEach(subject => {
      const id = subject.id, baseline = initialDaily.subjects[id] || {};
      const r = record.subjects[id] || (record.subjects[id] = { minutes: null, content: '', problem: '', newWords: null, reviewWords: null, forgotWords: '' });
      const minutes = optionalNumber(form, 'minutes-' + id);
      if (minutes !== (baseline.minutes ?? null)) r.minutes = minutes;
      const content = form.elements.namedItem('content-' + id).value;
      if (content !== (baseline.content || '')) r.content = content;
      if (subject.kind === 'vocab') {
        const newWords = optionalNumber(form, 'newWords-' + id, true), reviewWords = optionalNumber(form, 'reviewWords-' + id, true), forgotWords = form.elements.namedItem('forgotWords-' + id).value;
        if (newWords !== (baseline.newWords ?? null)) r.newWords = newWords;
        if (reviewWords !== (baseline.reviewWords ?? null)) r.reviewWords = reviewWords;
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
    const review = {};
    ['load', 'mathProblem', 'vocabReview', 'adjustment', 'reason'].forEach(name => { review[name] = form.elements.namedItem('review-' + name).value; });
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
  function readDefaults(form) { return monDays.map((_, i) => Number(form.elements.namedItem('default-' + i).value)); }
  function saveSubject(form) {
    if (!form.reportValidity()) return false;
    const latest = readState(), id = form.dataset.subjectEdit;
    M().updateSubject(latest, id, form.elements.namedItem('name-' + id).value.trim(), readDefaults(form));
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
    dialog.innerHTML = '<div class="sheet-heading"><h2 id="sheet-title">' + title + '</h2><button class="icon-button" type="button" data-action="close-sheet" aria-label="关闭">×</button></div>' + content;
    dialog.showModal();
    dialog.querySelectorAll('form[data-dirty]').forEach(syncFeedback);
  }
  function closeSheet(force = false) {
    if (!force && dirty.has('sheet') && !window.confirm('放弃这次未保存的修改？')) return false;
    dirty.delete('sheet');
    feedback.delete('sheet');
    dialog.close();
    return true;
  }
  function editWeek() {
    const w = weekOf(planDate);
    openSheet('第 ' + w.number + ' 周目标', '<form id="week-form" data-dirty="sheet" data-key="' + w.key + '">' + field('本周目标', 'week-goal', state.plan.weekGoals[w.key], { textarea: true, rows: 3, maxLength: 5000 }) + field('课表 / 任务提示', 'week-hint', state.plan.weekHints[w.key], { textarea: true, rows: 3, maxLength: 5000 }) + '<div class="save-row"><button class="cancel-button" type="button" data-action="close-sheet">取消</button><button class="primary" type="submit">保存目标</button></div></form>');
  }
  function referenceFields(date) {
    return state.plan.subjects.map(s => field(s.name + ' · 参考分钟', 'target-' + s.id, M().target(state, date, s.id), { type: 'number', min: 0, max: 1440, step: 'any', required: true })).join('');
  }
  function editReference() {
    const date = clampPlanDate(selectedDate);
    openSheet('一天的参考量', '<form id="reference-form" data-dirty="sheet">' + field('选择计划内日期', 'reference-date', date, { type: 'date', min: state.plan.startDate, max: state.plan.endDate, required: true }) + '<div id="reference-fields">' + referenceFields(date) + '</div><div class="save-row"><button class="cancel-button" type="button" data-action="close-sheet">取消</button><button class="primary" type="submit">保存参考量</button></div></form>');
  }
  function addSubject() {
    if (state.plan.subjects.length >= 24) { tell('最多支持 24 个科目。'); return; }
    openSheet('添加一个新科目', '<form id="new-subject-form" data-dirty="sheet">' + field('科目名称', 'new-subject-name', '', { required: true, maxLength: 40, placeholder: '例如：专业课' }) + '<p class="line-label">周一至周日的默认参考分钟</p>' + defaultsFields('new-default', [0, 0, 0, 0, 0, 0, 0]) + '<div class="save-row"><button class="cancel-button" type="button" data-action="close-sheet">取消</button><button class="primary" type="submit">添加科目</button></div></form>');
  }
  function saveSheet(form) {
    if (!form.reportValidity()) return false;
    const latest = readState();
    if (form.id === 'week-form') { latest.plan.weekGoals[form.dataset.key] = form.elements.namedItem('week-goal').value; latest.plan.weekHints[form.dataset.key] = form.elements.namedItem('week-hint').value; }
    if (form.id === 'reference-form') {
      const date = form.elements.namedItem('reference-date').value;
      if (date < latest.plan.startDate || date > latest.plan.endDate) throw new Error('请选择计划日期范围内的一天。');
      latest.plan.targets[date] = latest.plan.targets[date] || {};
      latest.plan.subjects.forEach(s => { latest.plan.targets[date][s.id] = Number(form.elements.namedItem('target-' + s.id).value); });
      planDate = date;
    }
    if (form.id === 'new-subject-form') M().addSubject(latest, form.elements.namedItem('new-subject-name').value.trim(), readDefaults(form));
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
  }
  function timerAction(action) {
    if (action === 'discard' && !window.confirm('丢弃这次计时？已经保存的学习记录不会改变。')) return;
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
      if (action === 'start-timer') { startTimer(button.dataset.subject); return; }
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
      if (action === 'edit-week') editWeek();
      if (action === 'edit-reference') editReference();
      if (action === 'add-subject') addSubject();
      if (action === 'export-backup') backupAction('exportBackup');
      if (action === 'import-backup') backupAction('importBackup');
      if (action === 'pin-widget') { const result = call('pinWidget'); if (result.requested) tell('已发起添加请求'); else widgetHelp(true); }
      if (action === 'widget-help') widgetHelp(false);
      if (action === 'rest-hours') restHours();
      if (action === 'reminder-help') reminderHelp();
      if (action === 'notification-settings') call('openNotificationSettings');
      if (action === 'about') showAbout();
      if (action === 'retry-save') { submitForm(document.getElementById(button.dataset.form)); return; }
      if (action === 'finish-for-restore') { const result = call('timerAction', 'finish'); if (!result.finished) throw new Error('当前计时未能保存'); state = readState(); closeSheet(true); backupAction('importBackup'); }
      if (action === 'discard-for-restore') { if (!window.confirm('丢弃本次未保存计时？')) return; const result = call('timerAction', 'discard'); if (result.active) throw new Error('当前计时未能丢弃'); closeSheet(true); backupAction('importBackup'); }
      if (action === 'retry-load') boot();
    });
  });
  document.addEventListener('input', event => {
    const form = event.target.closest('form[data-dirty]');
    if (!form || event.target.id === 'reference-date') return;
    dirty.add(form.dataset.dirty);
    feedback.set(form.dataset.dirty, { kind: 'editing', message: '未保存' });
    syncFeedback(form);
  });
  document.addEventListener('change', event => {
    if (event.target.id === 'day-picker') {
      const date = event.target.value;
      if (!date) return;
      attempt(() => { if (leaveEdits()) { selectedDate = date; render(); } else event.target.value = selectedDate; });
    }
    if (event.target.id === 'reference-date') {
      const date = event.target.value;
      if (!date || !within(date)) return;
      document.getElementById('reference-fields').innerHTML = referenceFields(date);
      dirty.add('sheet');
    }
    const form = event.target.closest('form[data-dirty]');
    if (form) { dirty.add(form.dataset.dirty); feedback.set(form.dataset.dirty, { kind: 'editing', message: '未保存' }); syncFeedback(form); }
    if (event.target.id === 'reminders-enabled') { if (event.target.checked) attempt(() => call('requestNotificationAccess')); updatePermissionStatus(); }
  });
  document.addEventListener('submit', event => {
    event.preventDefault();
    if (event.target.matches('form[data-dirty]')) submitForm(event.target);
  });

  dialog.addEventListener('cancel', event => { event.preventDefault(); closeSheet(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientY < box.top || event.clientY > box.bottom) closeSheet(); } });

  window.onNativeResume = function () {
    if (!booted || !bridge) return;
    attempt(() => {
      updatePermissionStatus();
      if (dirty.size) { nativeRefreshPending = true; state = readState(); refreshStoredSummary(); updateTimer(); return; }
      state = readState();
      planDate = clampPlanDate(planDate); reviewDate = clampPlanDate(reviewDate);
      render();
    });
  };
  window.onBackupRestored = function () {
    dirty.clear(); feedback.clear(); nativeRefreshPending = false;
    window.InspirationUI.restored();
    window.InspirationUI.init(bridge, () => { if (booted && route === 'inspiration') render(); }, tell, false);
    if (dialog.open) dialog.close();
    attempt(() => { state = readState(); booted = true; selectedDate = iso(); planDate = clampPlanDate(selectedDate); reviewDate = planDate; lastTimer = call('getTimer'); render(); tell('备份已恢复'); });
  };
  // Native may display this message after its asynchronous document picker completes.
  window.onNativeMessage = message => tell(message);
  window.handleNativeBack = function () {
    try {
      if (window.InspirationUI.back()) return true;
      if (dialog.open) { closeSheet(); return true; }
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
      getState: () => JSON.stringify(load()),
      saveState: json => { const s = JSON.parse(json); M().validateState(s); const current = load(); if ((s._revision || 0) !== (current._revision || 0)) return JSON.stringify({ error: '记录已经更新，请刷新后保存。' }); s._revision = (current._revision || 0) + 1; save(s); return JSON.stringify({ ok: true, revision: s._revision }); },
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
      selectedDate = iso(); planDate = clampPlanDate(selectedDate); reviewDate = planDate;
      lastTimer = call('getTimer'); booted = true; dirty.clear();
      render();
      window.InspirationUI.init(bridge, () => { if (booted && route === 'inspiration') render(); }, tell);
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
  document.addEventListener('visibilitychange', () => { if (!document.hidden) window.onNativeResume(); });
})();
