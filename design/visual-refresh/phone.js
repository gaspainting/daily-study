'use strict';

// This standalone preview never loads app.js or the Android bridge.
const M = window.StudyModel, R = window.StudyReference, S = window.StudySchedule;
const DAY = '2026-10-26', KEY = 'daily-study-visual-preview-20261026';
const theme = new URLSearchParams(location.search).get('theme') === 'linear' ? 'linear' : 'system';
const app = document.querySelector('#app'), dialog = document.querySelector('#sheet');
document.body.className = theme;
let seed, state, draft, selected = DAY, route = 'today', todayTab = 'record', planTab = 'week', reviewTab = 'week';
let planDate = DAY, reviewDate = '2026-10-19', dirty = false, sheet = null, toastId;
let storageReady = false;
const ui = { courseDone: [], tasks: [false, true, false], reminder: false, reminderTime: '19:00', favorite: false, note: '极限的基础概念还需要再梳理一次。' };
const clone = value => JSON.parse(JSON.stringify(value));
const e = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const fmt = number => number == null ? '未记录' : R.decimal(number);
const short = date => `${Number(date.slice(5, 7))}.${Number(date.slice(8))}`;
const add = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const arrangement = value => value === '正常参考' ? '照常' : value || '未选择';
const subjects = () => state.plan.subjects.filter(subject => M.subjectActive(subject, selected));
const symbol = subject => subject.kind === 'vocab' ? 'words' : subject.kind === 'math' ? 'math' : 'course';
const rangeText = subject => subject.kind === 'vocab' ? `${M.wordTarget(state, selected, subject.id)} 个新词` : `${R.text(M.reference(state, selected, subject.id))} 分钟`;
const subTabs = (kind, entries, active) => `<div class="sub-tabs" role="tablist">${entries.map(([id, label]) => `<button role="tab" aria-selected="${id === active}" data-action="${kind}" data-value="${id}">${label}</button>`).join('')}</div>`;
const row = (title, detail, action, value = '', trailing = '') => `<button class="list-row" data-action="${action}" data-value="${e(value)}"><span class="main"><strong>${title}</strong>${detail ? `<small>${detail}</small>` : ''}</span>${trailing ? `<span class="trailing">${trailing}</span>` : ''}${icon('next')}</button>`;

function makeSample(kind = 'saved') {
  // A complete sample history makes the review screens useful as visual examples.
  const sample = M.migrateState(clone(seed), '2026-10-12');
  const history = [[80, 30, 50], [95, 40, 55], [60, 20, 40], [0, 0, 0], null, [275, 90, 185], [200, 80, 120]];
  history.forEach((values, i) => {
    if (!values) return;
    const date = add('2026-10-19', i), record = M.record(sample, date);
    record.status = i === 3 ? '休息' : '正常参考';
    record.subjects['course-review'].minutes = values[1];
    record.subjects.math.minutes = values[2];
    record.subjects.vocab.newWords = [50, 55, 40, 0, 0, 60, 50][i];
    record.subjects.vocab.reviewWords = i === 3 ? 0 : 20 + i * 5;
    M.saveRecord(sample, date, record);
  });
  if (kind !== 'empty') {
    const record = M.record(sample, DAY);
    record.status = '正常参考';
    record.subjects['course-review'].minutes = kind === 'saved' ? 35 : 0;
    record.subjects.math.minutes = kind === 'partial' ? null : kind === 'zero' ? 0 : 50;
    record.subjects.vocab.newWords = kind === 'partial' ? null : kind === 'zero' ? 0 : 35;
    record.subjects.vocab.reviewWords = kind === 'partial' ? null : kind === 'zero' ? 0 : 20;
    record.subjects['course-review'].content = kind === 'saved' ? '光电子学：受激辐射与粒子数反转' : '';
    record.subjects.math.content = kind === 'saved' ? '极限与连续，基础题 12 道' : '';
    record.note = kind === 'saved' ? '今天把两个不熟的概念重新理了一遍。' : '';
    M.saveRecord(sample, DAY, record);
  }
  return sample;
}

function summary() {
  const temp = clone(state);
  if (dirty) temp.records[selected] = clone(draft);
  return M.recordSummary(temp, selected);
}

function savedState() {
  return dirty ? '有未保存修改' : state.records[selected] ? storageReady ? '已保存' : '示例记录' : '未记录';
}

function appbar() {
  return `<div class="appbar"><button class="workspace" data-action="plans"><span>课程复习与考研</span>${icon('down')}</button><button class="icon-button" data-action="more" aria-label="更多操作">${icon('more')}</button></div>`;
}

function title(name, caption = '', action = '') {
  return `<div class="page-title"><div><h1>${name}</h1>${caption ? `<p class="date-label">${caption}</p>` : ''}</div>${action}</div>`;
}

function weekStrip() {
  const start = M.weekInfo(state.plan, selected).start;
  return `<div class="week" aria-label="选择日期">${Array.from({ length: 7 }, (_, i) => {
    const date = add(start, i);
    return `<button data-action="day" data-value="${date}" class="${date === selected ? 'selected' : ''}" aria-label="${short(date)}，星期${'一二三四五六日'[i]}" aria-pressed="${date === selected}"><span>${'一二三四五六日'[i]}</span><strong>${Number(date.slice(8))}</strong></button>`;
  }).join('')}</div>`;
}

function summaryView() {
  const result = summary();
  const detail = result.recordedSubjects && result.recordedSubjects < result.totalSubjects ? `${result.recordedSubjects}/${result.totalSubjects} 科目已记录` : '已记录时长';
  return `<div class="summary"><div><span class="summary-label" id="record-state">${detail}</span><div class="time-number ${result.total == null ? 'empty' : ''}" id="actual-total">${fmt(result.total)}${result.total == null ? '' : '<span>分钟</span>'}</div></div><div class="summary-aside"><button class="reference-summary" data-action="reference" data-value="all" aria-label="修改当天参考区间"><span>参考区间${icon('next')}</span><strong>${R.text(R.total(state, selected))}<small>分钟</small></strong></button></div></div>`;
}

function todayTabs() {
  return `<div class="section-tabs" role="tablist" aria-label="今日模块">${[['record', '记录'], ['courses', '课程'], ['week', '本周'], ['assessment', '评估']].map(([id, label]) => `<button role="tab" aria-selected="${todayTab === id}" data-action="today-tab" data-value="${id}">${label}</button>`).join('')}</div>`;
}

function subjectList() {
  return `<div class="subject-list">${subjects().map(subject => {
    const entry = draft.subjects[subject.id];
    const value = subject.kind === 'vocab' ? entry.newWords : entry.minutes;
    const desc = subject.kind === 'vocab' ? `新学目标 ${M.wordTarget(state, selected, subject.id)} 个${entry.reviewWords == null ? '' : ` · 复习 ${entry.reviewWords} 个`}` : `参考 ${rangeText(subject)}`;
    return `<button class="subject-row" data-action="subject" data-value="${e(subject.id)}"><span class="subject-icon ${symbol(subject)}">${icon(symbol(subject))}</span><span><strong class="subject-name">${e(subject.name)}</strong><small class="subject-desc">${desc}</small></span><span class="subject-actual">${fmt(value)}${value == null ? '' : `<span>${subject.kind === 'vocab' ? '个' : '分钟'}</span>`}</span>${icon('next')}</button>`;
  }).join('')}</div>`;
}

function toolTable() {
  return `<div class="tool-table"><div class="tool-table-head"><span>科目</span><span>实际</span><span>参考</span></div>${subjects().map(subject => {
    const entry = draft.subjects[subject.id];
    const word = subject.kind === 'vocab';
    const input = (field, label) => `<label class="inline-number">${word ? `<small>${field === 'newWords' ? '新学' : '复习'}</small>` : ''}<input type="number" min="0" step="${word ? '1' : 'any'}" max="${word ? 10000 : 1440}" placeholder="—" value="${entry[field] ?? ''}" data-record="${e(subject.id)}" data-field="${field}" aria-label="${e(subject.name)}${label}"><small>${word ? '个' : '分'}</small></label>`;
    return `<div class="tool-row"><button class="name" data-action="subject" data-value="${e(subject.id)}">${icon(symbol(subject))}<span>${e(subject.name)}</span></button>${word ? `<div class="word-inline">${input('newWords', '新学个数')}${input('reviewWords', '复习个数')}</div>` : input('minutes', '实际分钟')}<button class="tool-reference" data-action="reference" data-value="${e(subject.id)}">${word ? `${M.wordTarget(state, selected, subject.id)} 新词` : R.text(M.reference(state, selected, subject.id)) + ' 分'}</button></div>`;
  }).join('')}</div>`;
}

function recordView() {
  return `${theme === 'linear' ? toolTable() : subjectList()}<div class="arrangement"><button data-action="arrangement">今日安排 <span class="value">${arrangement(draft.status)}</span>${icon('down')}</button><span class="record-tools"><button class="text-action" data-action="timer">${icon('play')}计时</button><button class="text-action" data-action="note">随记${icon('next')}</button></span></div><p class="note-preview">${e(draft.note)}</p>`;
}

function coursesView() {
  const agenda = S.agenda(state, selected);
  return `<div class="section-head"><h2>当天课程</h2><button class="text-action" data-action="route" data-value="plan">课表${icon('next')}</button></div>${(agenda?.courses || []).map((course, i) => `<button class="list-row ${ui.courseDone.includes(course) ? 'done' : ''}" data-action="course-done" data-value="${e(course)}" aria-pressed="${ui.courseDone.includes(course)}"><span class="round-check">${icon('check')}</span><span class="main"><strong>${e(course)}</strong><small>${i === 0 ? '3—4 节' : '6—7 节'}</small></span>${ui.courseDone.includes(course) ? '<span class="trailing">已回顾</span>' : ''}</button>`).join('') || '<p class="section-caption">今天没有课程</p>'}<p class="group-label">复习顺序</p><ol class="sequence"><li><span><strong>课程复习</strong><small>回顾当天课程</small></span><button class="text-action right" data-action="reference" data-value="course-review">${agenda ? R.text(agenda.courseRange) : '—'} 分钟</button></li><li><span><strong>考研高数</strong><small>课程复习之后</small></span><button class="text-action right" data-action="reference" data-value="math">${agenda ? R.text(agenda.mathRange) : '—'} 分钟</button></li><li><span><strong>单词</strong><small>新学与复习分别记录</small></span><span class="right">${M.wordTarget(state, selected, 'vocab')} 个新词</span></li></ol>`;
}

function weeklyView() {
  const items = ['回顾光电子学与物理光学课堂笔记', '整理本周高数错题', '完成极限与连续基础练习'];
  return `<div class="section-head"><h2>本周目标</h2><button class="text-action" data-action="week-edit">编辑</button></div><p class="weekly-goal">${e(ui.goal || '理解极限与连续的基本概念，回顾本周课程。')}</p><p class="group-label">任务 <span class="count-badge">${ui.tasks.filter(Boolean).length}/${items.length}</span></p>${items.map((item, i) => `<button class="list-row ${ui.tasks[i] ? 'done' : ''}" data-action="task" data-value="${i}" aria-pressed="${ui.tasks[i]}"><span class="round-check">${icon('check')}</span><span class="main"><strong>${item}</strong></span></button>`).join('')}`;
}

function assessmentView() {
  const result = R.assess(state, selected);
  const grade = { below: '未完成', within: '完成', above: '超额完成', rest: '休息日', empty: '未记录', partial: '待补全时长', arrangement: '待选安排', range: '未安排时长' };
  const time = result.time, word = result.words[0];
  return `<div class="section-head"><h2>今日评估</h2><button class="text-action" data-action="reference" data-value="all">参考区间</button></div>${dirty ? '<p class="section-caption">有未保存修改</p>' : ''}<div class="evaluation-row"><span><strong>${time.scope}</strong><small>${fmt(time.actual)}${time.actual == null ? '' : ' 分钟'} · ${time.status === '休息' ? '休息' : `参考 ${R.text({ min: time.min, max: time.max })} 分钟`}</small></span><span class="result">${grade[time.kind] || time.label}</span></div>${word ? `<div class="evaluation-row"><span><strong>单词新学</strong><small>${fmt(word.newWords)}${word.newWords == null ? '' : ' 个'} · 目标 ${word.goal} 个</small></span><span class="result">${grade[word.kind] || word.label}</span></div><div class="evaluation-row"><span><strong>单词复习</strong><small>已复习 ${fmt(word.reviewWords)}${word.reviewWords == null ? '' : ' 个'}</small></span></div>` : ''}${time.kind === 'partial' ? `<p class="section-caption">${time.missing} 科目尚未记录时长</p>` : ''}`;
}

function todayView() {
  const date = new Date(`${selected}T00:00:00Z`), name = selected === DAY ? '今天' : `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
  return `${title(name, `${date.getUTCMonth() + 1}月${date.getUTCDate()}日 · 周${'日一二三四五六'[date.getUTCDay()]}`, `<button class="icon-button calendar-short" data-action="calendar" aria-label="选择日期">${icon('calendar')}</button>`).replace('class="page-title"', 'class="page-title day-title"')}${weekStrip()}${summaryView()}${todayTabs()}<section class="tab-content" role="tabpanel">${({ record: recordView, courses: coursesView, week: weeklyView, assessment: assessmentView })[todayTab]()}</section><div class="save-dock"><span class="save-state" id="save-state">${savedState()}</span><button class="primary" data-action="save">保存记录</button></div>`;
}

function weekNavigation(date, action) {
  const week = M.weekInfo(state.plan, date);
  return `<div class="week-navigation"><button class="icon-button" data-action="${action}" data-value="-7" aria-label="上一周"><svg style="transform:rotate(180deg)" aria-hidden="true"><use href="#i-next"></use></svg></button><span><strong>第 ${week.number} 周</strong><small>${short(week.start)} — ${short(week.end)}</small></span><button class="icon-button" data-action="${action}" data-value="7" aria-label="下一周">${icon('next')}</button></div>`;
}

function planView() {
  let body = '';
  if (planTab === 'week') {
    const week = M.weekInfo(state.plan, planDate);
    body = weekNavigation(planDate, 'plan-week') + M.dates(week.start, week.end).map((date, i) => {
      const agenda = S.agenda(state, date), sum = M.recordSummary(state, date);
      return `<button class="plan-row ${date === DAY ? 'today' : ''}" data-action="day" data-value="${date}"><span class="date">${Number(date.slice(8))}</span><span class="main"><strong>周${'一二三四五六日'[i]} · ${R.text(R.total(state, date))} 分钟</strong><small>${agenda?.courses.length ? e(agenda.courses.join('、')) : i >= 5 ? `上午 ${i === 5 ? '60—120' : '60—120'} · 下午 ${i === 5 ? '180—240' : '120—180'} 分钟` : '课程复习与考研高数'}</small></span><span class="state">${sum.recordedSubjects ? `${sum.recordedSubjects}/${sum.totalSubjects}` : '未记录'}</span></button>`;
    }).join('');
  } else if (planTab === 'subjects') {
    body = `<p class="group-label">当前科目</p>${subjects().map(subject => `<button class="list-row" data-action="reference" data-value="${e(subject.id)}"><span class="subject-icon ${symbol(subject)}">${icon(symbol(subject))}</span><span class="main"><strong>${e(subject.name)}</strong><small>${subject.kind === 'vocab' ? '数量记录' : '时长记录'} · ${rangeText(subject)}</small></span>${icon('next')}</button>`).join('')}<button class="secondary sheet-link" data-action="subject-settings">科目设置</button>`;
  } else {
    body = `<p class="group-label">星期一</p>${row('光电子学', '3—4 节 · 第 1—10 周', 'course-detail', '光电子学')}${row('物理光学', '6—7 节 · 第 1—18 周', 'course-detail', '物理光学')}<p class="group-label">星期二</p>${row('激光原理', '3—4 节 · 第 1—18 周', 'course-detail', '激光原理')}${row('微型计算机原理与接口技术', '6—7 节 · 第 1—18 周', 'course-detail', '微型计算机原理与接口技术')}${row('毛概', '8—9 节 · 第 1—10 周', 'course-detail', '毛概')}`;
  }
  return `${title('计划', '课程复习与考研 · 10.12—12.20')}${subTabs('plan-tab', [['week', '本周安排'], ['subjects', '科目'], ['timetable', '课表']], planTab)}${body}`;
}

function chart(days) {
  const max = Math.max(360, ...days.map(date => M.recordSummary(state, date).total || 0));
  return `<div class="chart" role="img" aria-label="每日学习时长柱状图，详细数据见下方列表">${days.map(date => {
    const sum = M.recordSummary(state, date), ref = R.range(R.total(state, date));
    return `<div class="chart-day"><div class="reference-bar" style="height:${ref.max / max * 100}%"></div><div class="actual-bar ${sum.total == null ? 'missing' : ''}" style="height:${(sum.total || 0) / max * 100}%"></div></div>`;
  }).join('')}</div><div class="chart-labels">${days.map(date => `<span>${Number(date.slice(8))}</span>`).join('')}</div><div class="chart-legend"><span>实际时长</span><span>参考上限</span></div>`;
}

function reviewView() {
  const stats = M.weekStats(state, reviewDate), days = stats.days;
  const total = days.reduce((sum, date) => sum + (M.recordSummary(state, date).total || 0), 0);
  let body;
  if (reviewTab === 'week') {
    body = `${weekNavigation(reviewDate, 'review-week')}<div class="review-metrics"><div><small>学习时长</small><strong>${total}<span>分钟</span></strong></div><div><small>有时长记录</small><strong>${stats.recordedDays}<span>/ ${days.length} 天</span></strong></div></div>${chart(days)}${days.map(date => { const sum = M.recordSummary(state, date); return row(`${short(date)} · 周${'日一二三四五六'[new Date(date + 'T00:00:00Z').getUTCDay()]}`, sum.status === '休息' ? '休息日' : sum.total == null ? '未记录' : `${sum.total} 分钟 · 新学 ${fmt(sum.newWords)} 个`, 'day', date); }).join('')}<button class="secondary sheet-link" data-action="review-note">本周复盘</button>`;
  } else if (reviewTab === 'calendar') {
    body = `<div class="week-navigation"><strong>2026 年 10 月</strong><span class="count-badge">${Object.keys(state.records).filter(date => date.startsWith('2026-10')).length} 天有记录</span></div><div class="month-week">${'一二三四五六日'.split('').map(day => `<span>${day}</span>`).join('')}</div><div class="month-grid">${'<span></span>'.repeat(3)}${Array.from({ length: 31 }, (_, i) => { const date = `2026-10-${String(i + 1).padStart(2, '0')}`, sum = M.recordSummary(state, date); return `<button data-action="day" data-value="${date}" class="${date === DAY ? 'current' : ''}" aria-label="10月${i + 1}日，${sum.total == null ? '未记录' : sum.total + '分钟'}"><strong>${i + 1}</strong><small>${sum.total == null ? '—' : sum.total}</small></button>`; }).join('')}</div><p class="section-caption">日期下方为已记录分钟</p>`;
  } else {
    body = `<p class="group-label">最近记录</p>${Object.keys(state.records).sort().reverse().map(date => { const sum = M.recordSummary(state, date); return row(short(date), `${fmt(sum.total)}${sum.total == null ? '' : ' 分钟'} · ${sum.recordedSubjects}/${sum.totalSubjects} 科目`, 'day', date); }).join('')}`;
  }
  return `${title('复盘', '记录与变化')}${subTabs('review-tab', [['week', '周统计'], ['calendar', '月历'], ['history', '历史']], reviewTab)}${body}`;
}

function inspirationView() {
  return `${title('日签', '2026 年 10 月 26 日')}<div class="inspiration-copy"><span class="inspiration-no">26 / OCT</span><p>行到水穷处，<br>坐看云起时。</p><small>王维 ·《终南别业》</small></div><div class="inline-actions"><button data-action="favorite">${ui.favorite ? '已收藏' : '收藏'}</button><button data-action="quote-save">保存排版</button><button data-action="quote-share">分享文字</button></div><p class="group-label">日签集</p>${row('收藏', '', 'favorites', '', ui.favorite ? '1' : '0')}${row('历史', '', 'quote-history', '', '10月26日')}<p class="sample-caption">文字排版样例</p>`;
}

function settingsView() {
  return `${title('设置')}<p class="group-label">学习</p><div class="settings-group">${row('学习提醒', '', 'reminder', '', ui.reminder ? ui.reminderTime : '关闭')}${row('休息时段', '', 'rest')}${row('计划与科目', '', 'route', 'plan')}</div><p class="group-label">数据</p><div class="settings-group">${row('备份与导出', '', 'backup')}${row('小组件', '', 'widget')}</div><p class="group-label">应用</p><div class="settings-group">${row('使用手册', '', 'manual')}${row('关于', '', 'about')}</div>`;
}

function render(keepScroll = false) {
  const scroll = app.scrollTop;
  document.body.classList.toggle('has-dock', route === 'today');
  app.innerHTML = appbar() + ({ today: todayView, plan: planView, review: reviewView, inspiration: inspirationView, settings: settingsView })[route]();
  document.querySelector('.bottom-nav').innerHTML = [['today', '今日'], ['plan', '计划'], ['review', '复盘'], ['inspiration', '日签'], ['settings', '设置']].map(([id, label]) => `<button data-action="route" data-value="${id}" ${route === id ? 'aria-current="page"' : ''}>${icon(id)}<span>${label}</span></button>`).join('');
  app.scrollTop = keepScroll ? scroll : 0;
}

function toast(message) {
  const target = document.querySelector('#feedback');
  target.textContent = message; target.hidden = false;
  clearTimeout(toastId); toastId = setTimeout(() => { target.hidden = true; }, 2800);
}

function openSheet(name, html, apply = null) {
  document.querySelector('#sheet-title').textContent = name;
  document.querySelector('#sheet-body').innerHTML = html + '<p class="form-error" role="alert"></p>';
  document.querySelector('[data-action="apply-sheet"]').hidden = !apply;
  sheet = { apply };
  if (!dialog.open) dialog.showModal();
}

function closeSheet() { dialog.close(); sheet = null; }

function nullableInput(id, max, integer = true) {
  const element = document.getElementById(id), text = element.value.trim();
  if (element.validity.badInput) throw new Error('填写有效数字');
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > max || integer && !Number.isInteger(value)) throw new Error(`请输入 0—${max} ${integer ? '之间的整数' : '之间的数值'}`);
  return value;
}

function numericField(id, label, value, max, unit = '') {
  return `<label class="edit-field"><span>${label}${unit ? `（${unit}）` : ''}</span><input id="${id}" type="number" inputmode="decimal" min="0" max="${max}" value="${value ?? ''}" placeholder="未记录"></label>`;
}

function editSubject(id) {
  const subject = state.plan.subjects.find(item => item.id === id), entry = draft.subjects[id];
  const word = subject.kind === 'vocab';
  const form = word ? `<div class="word-editor">${numericField('edit-new', '新学', entry.newWords, 10000, '个')}${numericField('edit-review', '复习', entry.reviewWords, 10000, '个')}</div><div class="quick-add">${[10, 20, 50].map(n => `<button data-action="quick-word" data-value="${n}">新学 +${n}</button>`).join('')}</div>` : `<label class="editor-number"><input id="edit-minutes" type="number" inputmode="decimal" min="0" max="1440" value="${entry.minutes ?? ''}" placeholder="—" aria-label="实际学习分钟"><span>分钟</span></label><button class="editor-reference text-action" data-action="reference" data-value="${e(id)}">参考 ${rangeText(subject)} · 修改</button>`;
  const capture = () => {
    if (word) { entry.newWords = nullableInput('edit-new', 10000); entry.reviewWords = nullableInput('edit-review', 10000); entry.forgotWords = document.getElementById('edit-problem').value; }
    else { entry.minutes = nullableInput('edit-minutes', 1440, false); entry.problem = document.getElementById('edit-problem').value; }
    entry.content = document.getElementById('edit-content').value;
    dirty = true;
  };
  openSheet(subject.name, `${form}<label class="edit-field"><span>学习内容</span><textarea id="edit-content" rows="3" placeholder="选填">${e(entry.content)}</textarea></label><label class="edit-field"><span>${word ? '遗忘词' : '问题与随记'}（选填）</span><textarea id="edit-problem" rows="2">${e(word ? entry.forgotWords : entry.problem)}</textarea></label>`, () => { capture(); closeSheet(); render(true); });
  sheet.capture = capture;
}

function editReference(id) {
  if (dialog.open && sheet?.capture) sheet.capture();
  const active = subjects(), word = active.find(subject => subject.id === id)?.kind === 'vocab';
  const value = word ? M.wordTarget(state, selected, id) : id === 'all' ? R.total(state, selected) : M.reference(state, selected, id);
  const range = word ? null : R.range(value);
  openSheet(word ? '单词新学目标' : id === 'all' ? '当天参考区间' : `${active.find(subject => subject.id === id)?.name} · 参考区间`, word ? numericField('goal', '每日新学', value, 10000, '个') : `<div class="range-editor">${numericField('range-min', '下限', range.min, 1440, '分钟')}${numericField('range-max', '上限', range.max, 1440, '分钟')}</div>`, () => {
    const next = clone(state);
    if (word) {
      const goal = nullableInput('goal', 10000);
      if (goal == null) throw new Error('填写新学目标');
      next.plan.wordTargets = next.plan.wordTargets || {};
      next.plan.wordTargets[selected] = { ...next.plan.wordTargets[selected], [id]: goal };
    } else {
      const min = nullableInput('range-min', 1440, false), max = nullableInput('range-max', 1440, false);
      if (min == null || max == null) throw new Error('填写下限和上限');
      R.validate({ min, max }, true);
      next.plan.targets[selected] = next.plan.targets[selected] || {};
      if (id === 'all') {
        const entries = active.filter(s => s.kind !== 'vocab').map(s => ({ id: s.id, reference: M.reference(next, selected, s.id) }));
        R.distribute(entries, { min, max }).forEach(item => { next.plan.targets[selected][item.id] = item.reference; });
        S.markManual(next, selected, entries.map(item => item.id));
      } else { next.plan.targets[selected][id] = { min, max }; S.markManual(next, selected, [id]); }
    }
    if (next.records[selected]) R.recalculate(next, selected);
    M.validateState(next);
    persist(next); state = next; closeSheet(); render(true); toast('参考已保存');
  });
}

function persist(next) {
  // A successful browser storage write is required before any saved feedback.
  localStorage.setItem(`${KEY}:${theme}`, JSON.stringify({ state: next, ui }));
  storageReady = true;
}

function save() {
  for (const input of app.querySelectorAll('[data-record]')) {
    if (!input.checkValidity()) { input.reportValidity(); throw new Error('检查标出的学习记录'); }
  }
  const next = clone(state);
  M.saveRecord(next, selected, clone(draft)); M.validateState(next);
  persist(next); state = next; dirty = false; render(true); toast('已保存');
}

function simpleText(title, paragraphs) {
  openSheet(title, `<div class="sheet-text">${paragraphs.map(text => `<p>${text}</p>`).join('')}</div>`);
}

function chooseDay(date) {
  if (date < state.plan.startDate || date > state.plan.endDate) { toast('日期在当前计划范围外'); return; }
  if (dirty) {
    openSheet('有未保存记录', `<p class="sheet-text">切换日期前保存 ${short(selected)} 的修改？</p><button class="primary sheet-link" data-action="save-day" data-value="${date}">保存并切换</button><button class="secondary sheet-link" data-action="discard-day" data-value="${date}">放弃修改并切换</button>`);
    return;
  }
  selected = date; draft = M.record(state, selected); route = 'today'; todayTab = 'record'; render();
}

async function act(action, value, target) {
  switch (action) {
    case 'close': closeSheet(); break;
    case 'apply-sheet': if (sheet?.apply) sheet.apply(); break;
    case 'route': if (dialog.open) closeSheet(); route = value; render(); break;
    case 'today-tab': todayTab = value; render(true); break;
    case 'plan-tab': planTab = value; render(); break;
    case 'review-tab': reviewTab = value; render(); break;
    case 'plan-week': planDate = add(planDate, Number(value)); render(); break;
    case 'review-week': reviewDate = add(reviewDate, Number(value)); render(); break;
    case 'day': chooseDay(value); break;
    case 'save-day': save(); closeSheet(); chooseDay(value); break;
    case 'discard-day': dirty = false; closeSheet(); chooseDay(value); break;
    case 'save': save(); break;
    case 'subject': editSubject(value); break;
    case 'reference': editReference(value); break;
    case 'quick-word': {
      const input = document.getElementById('edit-new');
      input.value = Math.min(10000, Number(input.value || 0) + Number(value)); break;
    }
    case 'arrangement': {
      let choice = draft.status;
      openSheet('今日安排', `<div class="arrangement-options">${['正常参考', '减量', '仅回顾', '休息'].map(status => `<button data-action="choose-arrangement" data-value="${status}" aria-pressed="${draft.status === status}">${arrangement(status)}${draft.status === status ? icon('check') : ''}</button>`).join('')}</div>`, () => { draft.status = choice; dirty = true; closeSheet(); render(true); });
      sheet.choose = status => { choice = status; };
      break;
    }
    case 'choose-arrangement':
      sheet.choose(value); dialog.querySelectorAll('[data-action="choose-arrangement"]').forEach(button => { button.setAttribute('aria-pressed', String(button === target)); button.innerHTML = e(arrangement(button.dataset.value)) + (button === target ? icon('check') : ''); }); break;
    case 'note':
      openSheet('随记', `<label class="edit-field"><span>今天的随记（选填）</span><textarea id="day-note" rows="6">${e(draft.note)}</textarea></label>`, () => { draft.note = document.getElementById('day-note').value; dirty = true; closeSheet(); render(true); }); break;
    case 'calendar':
      openSheet('选择日期', `<label class="edit-field"><span>记录日期</span><input id="selected-date" type="date" min="${state.plan.startDate}" max="${state.plan.endDate}" value="${selected}"></label>`, () => { const date = document.getElementById('selected-date').value; if (!date) throw new Error('选择记录日期'); closeSheet(); chooseDay(date); }); break;
    case 'task': ui.tasks[Number(value)] = !ui.tasks[Number(value)]; render(true); break;
    case 'course-done': ui.courseDone = ui.courseDone.includes(value) ? ui.courseDone.filter(name => name !== value) : ui.courseDone.concat(value); render(true); break;
    case 'week-edit':
      openSheet('本周目标', `<label class="edit-field"><span>目标（选填）</span><textarea id="week-goal" rows="5">${e(ui.goal || '理解极限与连续的基本概念，回顾本周课程。')}</textarea></label>`, () => { ui.goal = document.getElementById('week-goal').value; closeSheet(); render(true); }); break;
    case 'review-note':
      openSheet('本周复盘', `<label class="edit-field"><span>复盘随记</span><textarea id="review-note" rows="6">${e(ui.note)}</textarea></label>`, () => { ui.note = document.getElementById('review-note').value; persist(state); closeSheet(); toast('复盘已保存'); }); break;
    case 'timer':
      openSheet('学习计时', `<div class="timer-display">00:00</div><label class="edit-field"><span>科目</span><select id="timer-subject">${subjects().filter(s => s.kind !== 'vocab').map(s => `<option value="${e(s.id)}">${e(s.name)}</option>`).join('')}</select></label><p class="sample-caption">计时器界面样例</p><button class="primary sheet-link" data-action="subject" data-value="math">手动补记</button>`); break;
    case 'plans': simpleText('计划', ['<strong>课程复习与考研</strong>', '2026.10.12 — 2026.12.20', '<button class="text-action" data-action="open-plan">查看计划</button>']); break;
    case 'open-plan': closeSheet(); route = 'plan'; render(); break;
    case 'more': openSheet('更多', row('当天参考区间', '', 'reference', 'all') + row('休息时段', '', 'rest') + row('使用手册', '', 'manual')); break;
    case 'reminder':
      openSheet('学习提醒', `<label class="switch-row"><span>提醒</span><input type="checkbox" role="switch" id="reminder-enabled" ${ui.reminder ? 'checked' : ''}></label><label class="edit-field"><span>提醒时间</span><input type="time" id="reminder-time" value="${ui.reminderTime}"></label>`, () => { const reminder = document.getElementById('reminder-enabled').checked, time = document.getElementById('reminder-time').value; if (reminder && !time) throw new Error('选择提醒时间'); ui.reminder = reminder; ui.reminderTime = time || '19:00'; persist(state); closeSheet(); render(true); }); break;
    case 'rest': simpleText('休息时段', ['工作日：20:30 起。', '周末：09:30 前、19:00 起。', '进入休息时段会暂停计时。']); break;
    case 'manual': simpleText('使用手册', ['<strong>记录</strong><br>点击科目填写时长，单词分别填写新学和复习数量。完成后点“保存记录”。', '<strong>计划</strong><br>查看每周安排，修改当天参考区间和单词目标。', '<strong>复盘</strong><br>查看周统计、月历和历史记录。']); break;
    case 'backup': openSheet('备份与导出', '<button class="primary sheet-link" data-action="export">导出示例 JSON</button><p class="sample-caption">导出此样稿中的示例记录</p>'); break;
    case 'export': download(JSON.stringify(state, null, 2), '每日学习-界面样稿.json', 'application/json'); break;
    case 'widget': simpleText('小组件', ['<strong>今日记录</strong>', `${fmt(summary().total)} 分钟 · ${summary().recordedSubjects}/${summary().totalSubjects} 科目`, '小组件界面样例']); break;
    case 'about': simpleText('每日学习', ['界面样稿 · 2026.10.26', '<a href="references.html" target="_blank">查看视觉参考 ↗</a>']); break;
    case 'subject-settings': simpleText('科目设置', subjects().map(s => `<button class="list-row" data-action="reference" data-value="${e(s.id)}"><span class="main"><strong>${e(s.name)}</strong><small>${rangeText(s)}</small></span>${icon('next')}</button>`)); break;
    case 'course-detail': simpleText(value, ['回顾课堂笔记与例题。', '<button class="text-action" data-action="subject" data-value="course-review">记录课程复习</button>']); break;
    case 'favorite': ui.favorite = !ui.favorite; render(true); break;
    case 'favorites': simpleText('收藏', [ui.favorite ? '行到水穷处，坐看云起时。<br><small>王维 ·《终南别业》</small>' : '暂无收藏']); break;
    case 'quote-history': simpleText('日签历史', ['2026.10.26', '行到水穷处，坐看云起时。<br><small>王维 ·《终南别业》</small>']); break;
    case 'quote-save': download(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440"><rect width="1080" height="1440" fill="${theme === 'linear' ? '#111216' : '#fff'}"/><g fill="${theme === 'linear' ? '#eee' : '#17181b'}" font-family="serif"><text x="90" y="180" font-size="30">2026.10.26</text><text x="90" y="610" font-size="72">行到水穷处，</text><text x="90" y="740" font-size="72">坐看云起时。</text><text x="90" y="1020" font-size="32">王维 ·《终南别业》</text></g></svg>`, '日签排版样例.svg', 'image/svg+xml'); break;
    case 'quote-share':
      if (navigator.share) await navigator.share({ text: '行到水穷处，坐看云起时。——王维《终南别业》' });
      else simpleText('分享文字', ['<textarea class="share-text" readonly aria-label="可复制的日签文字">行到水穷处，坐看云起时。——王维《终南别业》</textarea>']);
      break;
  }
}

function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}

document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  try { await act(target.dataset.action, target.dataset.value, target); }
  catch (error) { if (error.name === 'AbortError') return; if (dialog.open) dialog.querySelector('.form-error').textContent = error.message; else toast(error.message || '操作未完成'); }
});

document.addEventListener('input', event => {
  const target = event.target;
  if (!target.matches('[data-record]')) return;
  const value = target.value.trim() === '' ? null : Number(target.value);
  if (target.validity.badInput || value !== null && (!Number.isFinite(value) || value < 0 || value > Number(target.max) || ['newWords','reviewWords'].includes(target.dataset.field) && !Number.isInteger(value))) { target.setCustomValidity(`填写 0—${target.max} ${target.dataset.field === 'minutes' ? '之间的数值' : '之间的整数'}`); return; }
  target.setCustomValidity('');
  draft.subjects[target.dataset.record][target.dataset.field] = value; dirty = true;
  const result = summary();
  document.querySelector('#actual-total').classList.toggle('empty', result.total == null);
  document.querySelector('#actual-total').innerHTML = `${fmt(result.total)}${result.total == null ? '' : '<span>分钟</span>'}`;
  document.querySelector('#record-state').textContent = result.recordedSubjects < result.totalSubjects ? `${result.recordedSubjects}/${result.totalSubjects} 科目已记录` : '已记录时长';
  document.querySelector('#save-state').textContent = savedState();
});

window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent) return;
  if (event.data?.type === 'sample' && ['saved', 'empty', 'partial', 'zero'].includes(event.data.value)) {
    if (dialog.open) closeSheet(); state = makeSample(event.data.value); selected = DAY; draft = M.record(state, selected); dirty = false;
    try { persist(state); } catch (error) { storageReady = false; toast('示例未保存'); }
    render();
  }
  if (event.data?.type === 'large') document.documentElement.classList.toggle('large', !!event.data.value);
  if (event.data?.type === 'screen' && ['today','plan','review','settings'].includes(event.data.value)) { if (dialog.open) closeSheet(); route = event.data.value; render(); }
});

fetch('/assets/seed.json').then(response => {
  if (!response.ok) throw new Error('示例数据读取失败');
  return response.json();
}).then(value => {
  seed = value; state = makeSample();
  try {
    const saved = JSON.parse(localStorage.getItem(`${KEY}:${theme}`));
    if (saved?.state) { M.validateState(saved.state); state = saved.state; Object.assign(ui, saved.ui || {}); storageReady = true; }
  } catch (_) { /* A broken sample does not affect Android app data. */ }
  if (!storageReady) { try { persist(state); } catch (_) { /* The preview stays explicitly marked as sample data. */ } }
  draft = M.record(state, selected); render();
}).catch(error => { app.innerHTML = `<p class="form-error">${e(error.message)}</p>`; });
