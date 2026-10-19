(function (root, factory) {
  'use strict';
  var tracking = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = tracking;
  root.StudyTracking = tracking;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  function escape(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]; }); }
  function model() { return root.StudyModel || (typeof require === 'function' ? require('./model.js') : null); }
  function refs(){return root.StudyReference||(typeof require==='function'?require('./reference.js'):null);}
  function minutes(value) { return value == null ? '未记录' : String(Math.round(value * 10) / 10) + ' 分钟'; }
  function option(value, text, selected) { return '<option value="' + escape(value) + '"' + (value === selected ? ' selected' : '') + '>' + escape(text) + '</option>'; }
  function field(label, id, type, value, attribute) { return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="' + type + '" value="' + escape(value || '') + '" ' + attribute + (type === 'date' ? ' min="1900-01-01" max="2100-12-31"' : '') + '></div>'; }
  function subjects(state, value) { return option('', '全部科目', value || '') + state.plan.subjects.map(function (item) { return option(item.id, item.name, value); }).join(''); }
  function selectedFilters(filters) { return { from: filters.from || filters.startDate || '', to: filters.to || filters.endDate || '', subjectId: filters.subjectId || filters.subject || '', keyword: filters.keyword || '', status: filters.status || '', kind: filters.recordKind || filters.kind || '', assessmentDimension: filters.assessmentDimension || 'time', assessmentKind: filters.assessmentKind || '' }; }
  function summaryText(summary) { var parts=[]; if(summary.total!==null)parts.push(minutes(summary.total));if(summary.newWords!=null)parts.push('新学 '+summary.newWords+' 个');if(summary.reviewWords!=null)parts.push('复习 '+summary.reviewWords+' 个');return (parts.join(' · ') || (summary.kind==='note'?'有随记':'未记录'))+(summary.recordedSubjects?' · '+summary.recordedSubjects+'/'+summary.totalSubjects+' 科目已记录':''); }
  function assessmentFilters(filters){
    var result='<div class="field-inline"><div class="field"><label for="tracking-assessment-dimension">评估项目</label><select id="tracking-assessment-dimension" data-tracking-filter="assessmentDimension">'+option('time','学习时长',filters.assessmentDimension)+option('words','单词新学',filters.assessmentDimension)+'</select></div><div class="field"><label for="tracking-assessment-kind">评估结果</label><select id="tracking-assessment-kind" data-tracking-filter="assessmentKind">'+option('','全部结果',filters.assessmentKind);
    [['within','完成'],['above','超额完成'],['below','未完成'],['rest','休息日'],['empty','未记录'],['partial','待补全'],['pending','待评估']].forEach(function(pair){result+=option(pair[0],pair[1],filters.assessmentKind);});return result+'</select></div></div>';
  }
  function renderAssessments(state,inputDays,helpers){
    var today=helpers&&helpers.today||model().today(),days=inputDays.filter(function(d){return (d>=state.plan.startDate&&d<=state.plan.endDate||state.records[d])&&(d<=today||state.records[d]);}),html='<section class="assessment-summary" aria-label="评估汇总">';
    var title={time:'时长评估',words:'单词新学评估'},names={within:'完成',above:'超额',below:'未完成',rest:'休息',empty:'未记录',partial:'待补全',pending:'待评估'};
    function link(label,dimension,from,to,kind){return '<button type="button" class="text-button" data-action="assessment-history" data-dimension="'+dimension+'" data-from="'+from+'" data-to="'+to+'" data-kind="'+(kind||'')+'">'+label+'</button>';}
    ['time','words'].forEach(function(dimension){var count=refs().summary(state,days,dimension);html+='<div class="assessment-metric"><h3>'+title[dimension]+'</h3><p class="assessment-rate">达标 '+count.achieved+' / 已评估 '+count.graded+' 天'+(count.rate===null?'':' · '+count.rate+'%')+'</p><div class="assessment-counts">';Object.keys(names).forEach(function(kind){html+=days.length?link(names[kind]+' '+count[kind]+' 天',dimension,days[0],days[days.length-1],kind):'<span>'+names[kind]+' 0 天</span>';});html+='</div></div>';});
    if(days.length){var groups=[];days.forEach(function(d){var stamp=Date.parse(d+'T00:00:00Z'),key=days.length<=7?d:new Date(stamp-((new Date(stamp).getUTCDay()+6)%7)*86400000).toISOString().slice(0,10),last=groups[groups.length-1];if(!last||last.key!==key)groups.push({key:key,days:[d]});else last.days.push(d);});
      html+='<details class="assessment-trends"><summary>'+(days.length<=7?'每日结果':'每周达标趋势')+'</summary><ol>';groups.forEach(function(g){var from=g.days[0],to=g.days[g.days.length-1];html+='<li><strong>'+from.slice(5).replace('-','.')+(from===to?'':'—'+to.slice(5).replace('-','.'))+'</strong><div>';['time','words'].forEach(function(dimension){var c=refs().summary(state,g.days,dimension);var label=dimension==='time'?'时长':'新学';html+=link(label+' '+c.achieved+'/'+c.graded+' 天'+(c.rate===null?' · 未评估':' · '+c.rate+'%'),dimension,from,to,'');});html+='</div></li>';});html+='</ol></details>';
    }return html+'</section>';
  }
  function renderHistory(state, filters, helpers) {
    filters = selectedFilters(filters || {}); helpers = helpers || {};
    var rows = model().historySearch(state, filters);
    var html = '<div class="page-intro"><div class="eyebrow">HISTORY</div><h1>历史记录</h1></div><div class="tracking-filters"><div class="field-inline">' + field('开始日期', 'tracking-from', 'date', filters.from, 'data-tracking-filter="from"') + field('结束日期', 'tracking-to', 'date', filters.to, 'data-tracking-filter="to"') + '</div><div class="field"><label for="tracking-subject">科目</label><select id="tracking-subject" data-tracking-filter="subjectId">' + subjects(state, filters.subjectId) + '</select></div>' + field('关键词', 'tracking-keyword', 'search', filters.keyword, 'data-tracking-filter="keyword" maxlength="128"') + '<div class="field-inline"><div class="field"><label for="tracking-status">今日安排</label><select id="tracking-status" data-tracking-filter="status">' + option('', '全部安排', filters.status) + ['正常参考', '减量', '仅回顾', '休息'].map(function (status) { return option(status, status === '正常参考' ? '照常' : status, filters.status); }).join('') + '</select></div><div class="field"><label for="tracking-kind">记录状态</label><select id="tracking-kind" data-tracking-filter="recordKind">' + option('', '全部记录', filters.kind) + option('zero', '已记录数值为 0', filters.kind) + option('partial', '部分科目已记录', filters.kind) + option('note', '只有随记', filters.kind) + option('complete', '科目已记齐', filters.kind) + '</select></div></div>'+assessmentFilters(filters)+'<div class="save-row"><button type="button" class="primary" data-action="tracking-search">筛选</button><button type="button" data-action="tracking-reset">重置</button></div></div><p class="chart-caption" role="status">' + rows.length + ' 条记录</p><div class="week-list tracking-list">';
    html += rows.length ? rows.map(function (row) {
      var snippet = row.note || Object.keys(row.record.subjects).map(function (id) { var item = row.record.subjects[id]; return item.content || item.problem || item.forgotWords || ''; }).filter(Boolean).join('；');
      const result=refs().assess(state,row.date),assessment=result.time;const wordResult=refs().kind(result,'words'),wordLabel=({below:'未完成',within:'完成',above:'超额完成',rest:'休息日',empty:'未记录',partial:'待补全'})[wordResult]||'待评估';
      return '<button type="button" class="plan-day tracking-record" data-action="tracking-open-day" data-date="' + row.date + '" aria-label="打开 ' + row.date + '，' + escape(summaryText(row)+'，'+assessment.label) + '"><span class="plan-day-meta"><strong class="plan-day-date">' + row.date.replaceAll('-', '.') + '</strong><span class="plan-day-subjects">' + escape(summaryText(row)) + '</span><span class="tracking-assessment">'+escape('时长：'+assessment.label+' · 新学：'+wordLabel)+'</span>' + (snippet ? '<span class="tracking-note">' + escape(snippet.slice(0, 100)) + '</span>' : '') + '</span>' + (row.status ? '<span class="saved-mark">' + escape(row.status === '正常参考' ? '照常' : row.status) + '</span>' : '') + (helpers.icon ? helpers.icon('next') : '') + '</button>';
    }).join('') : '<div class="empty">暂无匹配记录</div>';
    return html + '</div>';
  }
  function renderWordStats(state, days) {
    return model().wordStats(state, days).filter(function(s){return s.totalDays||s.newWords!==null||s.reviewWords!==null;}).map(function(s){
      var html='<div class="word-summary"><h3>'+escape(s.name)+'</h3><div class="word-summary-grid"><div><span>新学</span><strong>'+(s.newWords===null?'未记录':s.newWords+' 个')+'</strong></div><div><span>目标</span><strong>'+(s.target===null?'—':s.target+' 个')+'</strong></div><div><span>复习</span><strong>'+(s.reviewWords===null?'未记录':s.reviewWords+' 个')+'</strong></div></div><p class="chart-caption">新学 '+s.newRecordedDays+'/'+s.totalDays+' 天已记录 · 复习 '+s.reviewRecordedDays+'/'+s.totalDays+' 天已记录</p>';
      if(days.length<=7){
        const subject=state.plan.subjects.find(x=>x.id===s.id),goalFor=d=>d>=state.plan.startDate&&d<=state.plan.endDate&&model().subjectActive(subject,d)?model().wordTarget(state,d,s.id):null;
        const maximum=Math.max(1,...days.map(d=>Math.max(goalFor(d)||0,state.records[d]?.subjects?.[s.id]?.newWords||0)));
        const description=days.map(d=>d+' 新学 '+(state.records[d]?.subjects?.[s.id]?.newWords??'未记录')+'，目标 '+(goalFor(d)===null?'—':goalFor(d)+' 个')).join('；');
        html+='<div class="bar-chart" role="img" aria-label="'+escape(s.name+'：'+description)+'">'+days.map(d=>{const value=state.records[d]?.subjects?.[s.id]?.newWords??null,goal=goalFor(d)||0;return '<div class="chart-day"><i class="bar reference" data-height="'+goal/maximum*100+'"></i><i class="bar'+(value===null?' missing':value===0?' zero':'')+'" data-height="'+(value||0)/maximum*100+'"></i></div>';}).join('')+'</div><div class="chart-labels">'+days.map(d=>'<span>'+Number(d.slice(8))+'日</span>').join('')+'</div>';
      }
      return html+'</div>';
    }).join('');
  }
  function renderMonth(state, month, helpers) {
    helpers = helpers || {}; var stats = model().monthStats(state, month);
    var html = '<div class="page-intro"><div class="eyebrow">MONTH</div><h1>月历</h1></div><div class="week-navigation"><button type="button" class="icon-button" data-action="tracking-month-prev" aria-label="上个月">' + (helpers.icon ? helpers.icon('prev') : '‹') + '</button><div class="field"><label class="visually-hidden" for="tracking-month">月份</label><input id="tracking-month" type="month" min="1900-01" max="2100-12" value="' + month + '" data-tracking-filter="month"></div><button type="button" class="icon-button" data-action="tracking-month-next" aria-label="下个月">' + (helpers.icon ? helpers.icon('next') : '›') + '</button></div><div class="overview"><div><span class="metric-label">已记录时长</span><strong class="metric-value' + (stats.actual === null ? ' is-empty' : '') + '">' + (stats.actual === null ? '未记录' : Math.round(stats.actual * 10) / 10) + '</strong>' + (stats.actual === null ? '' : '<span class="metric-unit">分钟</span>') + '</div><div><span class="metric-label">时长记录天数</span><strong class="metric-value">' + stats.recordedDays + '<small class="metric-unit"> / ' + stats.totalDays + ' 天</small></strong><span class="metric-caption">随记 ' + stats.entryDays + ' 天</span></div></div><div class="month-calendar"><div class="month-weekdays" aria-hidden="true">' + ['一', '二', '三', '四', '五', '六', '日'].map(function (day) { return '<span>周' + day + '</span>'; }).join('') + '</div><div class="month-grid" aria-label="' + month + ' 学习记录">';
    var offset = (new Date(stats.start + 'T00:00:00Z').getUTCDay() + 6) % 7;
    for (var index = 0; index < offset; index++) html += '<span aria-hidden="true"></span>';
    html += stats.days.map(function (date) {
      var summary = model().recordSummary(state, date), parts=[];if(summary.total!==null)parts.push(minutes(summary.total));if(summary.newWords!=null)parts.push('新学 '+summary.newWords+' 个');if(summary.reviewWords!=null)parts.push('复习 '+summary.reviewWords+' 个');var caption=parts.join(' · ')||(summary.kind==='note'?'随记':'未记录');
      return '<button type="button" class="month-day' + (summary.entry ? ' has-record' : '') + '" data-action="tracking-open-day" data-date="' + date + '" aria-label="' + date + '，' + escape(summaryText(summary)) + '"><strong>' + Number(date.slice(8)) + '</strong><span>' + escape(caption) + '</span>' + (summary.kind === 'partial' ? '<small>' + summary.recordedSubjects + '/' + summary.totalSubjects + '</small>' : '') + '</button>';
    }).join('');
    html += '</div></div>'+renderAssessments(state,stats.days,helpers)+'<section class="section"><div class="section-heading"><h2>科目统计</h2></div>';
    var wordHtml = renderWordStats(state, stats.days); html += wordHtml;
    var subjectRows = stats.subjects.filter(function (item) { return item.kind !== 'vocab' ? item.totalDays || item.actual !== null : item.actual !== null; });
    html += subjectRows.length ? subjectRows.map(function (item) { return '<div class="settings-row"><div><h3>' + escape(item.name) + (item.kind==='vocab'?' · 历史时长':'') + '</h3><p class="chart-caption">' + item.recordedDays + '/' + item.totalDays + ' 天已记录 · 参考 ' + refs().text(item.referenceRange||item.reference) + ' 分钟</p></div><span class="chart-value">' + escape(minutes(item.actual)) + '</span></div>'; }).join('') : wordHtml ? '' : '<div class="empty">暂无科目记录</div>';
    return html + '</section>';
  }
  function duration(seconds) {
    if (seconds < 60) return Math.round(seconds * 10) / 10 + ' 秒';
    var whole = Math.floor(seconds), hours = Math.floor(whole / 3600), minute = Math.floor(whole % 3600 / 60), second = whole % 60;
    return (hours ? hours + ' 小时 ' : '') + (minute ? minute + ' 分钟 ' : '') + (second ? second + ' 秒' : '');
  }
  function renderSessions(state, filters, helpers) {
    filters = selectedFilters(filters || {}); helpers = helpers || {};
    var rows = model().sessionSearch(state, filters), seconds = rows.reduce(function (sum, item) { return sum + item.seconds; }, 0);
    var html = '<div class="page-intro"><div class="eyebrow">SESSIONS</div><h1>计时明细</h1></div><div class="field-inline">' + field('开始日期', 'sessions-from', 'date', filters.from, 'data-session-filter="from"') + field('结束日期', 'sessions-to', 'date', filters.to, 'data-session-filter="to"') + '</div><div class="field"><label for="sessions-subject">科目</label><select id="sessions-subject" data-session-filter="subjectId">' + subjects(state, filters.subjectId) + '</select></div><div class="save-row"><button type="button" class="primary" data-action="tracking-sessions-search">筛选</button><button type="button" data-action="tracking-sessions-reset">重置</button></div><p class="chart-caption" role="status">' + rows.length + ' 次 · ' + escape(duration(seconds)) + '</p><div class="week-list tracking-list">';
    html += rows.length ? rows.map(function (item) {
      var subject = state.plan.subjects.find(function (candidate) { return candidate.id === item.subjectId; });
      var ended = new Date(item.endedAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      return '<button type="button" class="plan-day tracking-record" data-action="tracking-open-day" data-date="' + item.date + '"><span class="plan-day-meta"><strong>' + escape(subject.name) + '</strong><span class="plan-day-subjects">' + escape(duration(item.seconds)) + '</span><span class="tracking-note">结束于 ' + escape(ended) + '</span></span>' + (helpers.icon ? helpers.icon('next') : '') + '</button>';
    }).join('') : '<div class="empty">暂无计时记录</div>';
    return html + '</div>';
  }
  return Object.freeze({ summaryText: summaryText, renderWordStats: renderWordStats, renderAssessments: renderAssessments, renderHistory: renderHistory, renderMonth: renderMonth, renderSessions: renderSessions, duration: duration });
});
