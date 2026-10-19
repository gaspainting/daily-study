(function(root,factory){
  const api=factory(root.StudyCourseData||(typeof module==='object'&&module.exports?require('./course-schedule-data.js'):null));
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.StudyCourses=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(data){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x)), own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const id=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
  function fail(s){throw new Error(s);}
  function keys(o,required){if(!o||typeof o!=='object'||Array.isArray(o)||![Object.prototype,null].includes(Object.getPrototypeOf(o)))fail('课程数据格式无效');if(Object.keys(o).length!==required.length||required.some(k=>!own(o,k)))fail('课程字段无效');}
  function text(s,max){if(typeof s!=='string'||s.length>max)fail('课程文字超出长度限制');}
  function integer(n,min,max){if(!Number.isInteger(n)||n<min||n>max)fail('课程数字超出范围');}
  function identifier(s){if(typeof s!=='string'||!id.test(s)||['constructor','prototype','__proto__'].includes(s))fail('课程标识无效');}
  function date(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||s<'1900-01-01'||s>'2100-12-31'||new Date(s+'T12:00:00Z').toISOString().slice(0,10)!==s)fail('课程日期无效');return s;}
  const stamp=s=>Date.parse(s+'T12:00:00Z'), shift=(s,n)=>new Date(stamp(s)+n*86400000).toISOString().slice(0,10);
  const weekday=s=>(new Date(stamp(s)).getUTCDay()+6)%7;
  function validate(state){
    const schedule=state.plan.courseSchedule;
    if(schedule!==undefined){
      keys(schedule,['versions','changes']);if(!Array.isArray(schedule.versions)||!schedule.versions.length||schedule.versions.length>100||!Array.isArray(schedule.changes)||schedule.changes.length>2000)fail('课表数量超出限制');
      let previous='';
      schedule.versions.forEach(v=>{keys(v,['from','anchor','startWeek','courses']);date(v.from);date(v.anchor);if(v.from<=previous||weekday(v.anchor)!==0)fail('课表生效日期或周一日期无效');previous=v.from;integer(v.startWeek,1,999);if(!Array.isArray(v.courses)||v.courses.length>100)fail('每份课表最多 100 条课程');const seen=new Set();v.courses.forEach(c=>{keys(c,['id','name','day','firstWeek','lastWeek','parity','slot']);identifier(c.id);if(seen.has(c.id))fail('课程标识重复');seen.add(c.id);text(c.name,80);if(!c.name.trim())fail('请填写课程名称');integer(c.day,0,6);integer(c.firstWeek,1,999);integer(c.lastWeek,c.firstWeek,999);if(!['all','odd','even'].includes(c.parity))fail('单双周无效');text(c.slot,80);});});
      const seen=new Set();schedule.changes.forEach(c=>{keys(c,['id','courseId','fromDate','toDate','note']);identifier(c.id);identifier(c.courseId);if(seen.has(c.id))fail('调课标识重复');seen.add(c.id);date(c.fromDate);if(c.toDate!==null)date(c.toDate);if(c.toDate===c.fromDate)fail('调课日期相同');text(c.note,1000);});
      const origins=new Set();schedule.changes.forEach(c=>{const k=c.courseId+'@'+c.fromDate;if(origins.has(k))fail('同一课程不能重复调课');origins.add(k);if(!base(state,c.fromDate).some(row=>row.id===c.courseId))fail('调课缺少原课程');});
    }
    if(state.courseReviews!==undefined){
      const values=state.courseReviews;if(!values||typeof values!=='object'||Array.isArray(values))fail('课程复习格式无效');if(Object.keys(values).length>10000)fail('课程复习日期过多');
      Object.entries(values).forEach(([d,rows])=>{date(d);if(!Array.isArray(rows)||rows.length>200)fail('每日课程复习最多 200 项');const seen=new Set();rows.forEach(r=>{keys(r,['key','courseId','name','slot','originDate','done','note','task']);identifier(r.courseId);date(r.originDate);if(r.key!==r.courseId+'@'+r.originDate||seen.has(r.key))fail('复习课程标识无效');seen.add(r.key);text(r.name,80);if(!r.name.trim())fail('复习课程名称为空');text(r.slot,80);if(typeof r.done!=='boolean')fail('复习勾选无效');text(r.note,3000);if(r.task!==null){keys(r.task,['week','id','title']);date(r.task.week);identifier(r.task.id);text(r.task.title,500);if(!r.task.title.trim())fail('关联任务为空');}});});
    }
    return state;
  }
  function initial(plan){
    const original=plan.startDate===data.anchor&&plan.endDate===data.lastDate&&plan.startWeek===7;
    return {versions:[{from:'1900-01-01',anchor:original?data.anchor:shift(plan.startDate,-weekday(plan.startDate)),startWeek:original?7:plan.startWeek,courses:original?clone(data.courses):[]}],changes:[]};
  }
  function initialize(state){if(!state.plan.courseSchedule)state.plan.courseSchedule=initial(state.plan);return state;}
  function schedule(state){return state.plan.courseSchedule||initial(state.plan);}
  function version(state,d){return schedule(state).versions.filter(v=>v.from<=d).slice(-1)[0]||null;}
  function base(state,d){const v=version(state,d);if(!v)return [];const week=v.startWeek+Math.floor((stamp(d)-stamp(v.anchor))/604800000),day=weekday(d);return v.courses.filter(c=>c.day===day&&c.firstWeek<=week&&week<=c.lastWeek&&(c.parity==='all'||c.parity==='odd'&&week%2===1||c.parity==='even'&&week%2===0)).map(c=>({...clone(c),key:c.id+'@'+d,originDate:d,date:d,week}));}
  function occurrences(state,d){
    date(d);const changes=schedule(state).changes;
    const rows=base(state,d).filter(c=>!changes.some(x=>x.courseId===c.id&&x.fromDate===d));
    changes.filter(x=>x.toDate===d).forEach(x=>{const c=base(state,x.fromDate).find(c=>c.id===x.courseId);if(c)rows.push({...c,date:d,changeNote:x.note});});
    return rows;
  }
  function checklist(state,d){
    const saved=clone(state.courseReviews?.[d]||[]),seen=new Set(saved.map(r=>r.key));let rows=occurrences(state,d);
    if(weekday(d)>=5){const monday=shift(d,-weekday(d)),names=new Set();rows=[];for(let n=0;n<=weekday(d);n++)for(const c of occurrences(state,shift(monday,n)))if(!names.has(c.name)){names.add(c.name);rows.push({...c,slot:'本周回顾'});}}
    for(const c of rows)if(!seen.has(c.key)){seen.add(c.key);saved.push({key:c.key,courseId:c.id,name:c.name,slot:c.slot,originDate:c.originDate,done:false,note:'',task:null});}
    return saved;
  }
  function putVersion(state,v,today){
    date(today);if(v.from<today||v.from<state.plan.startDate||v.from>state.plan.endDate)fail('生效日期须在今天起的计划范围内');
    const out=clone(state);initialize(out);const s=out.plan.courseSchedule;if(s.versions.some(x=>x.from>v.from))fail('已有更晚生效的课表，请先编辑该课表');
    s.versions=s.versions.filter(x=>x.from<v.from);s.versions.push(clone(v));out.version=6;validate(out);
    // A future timetable must not silently invalidate a confirmed course move.
    for(const change of s.changes)if(change.fromDate>=v.from&&!base(out,change.fromDate).some(c=>c.id===change.courseId))fail('这份课表会取消已有调课的原课程，请先撤销对应调课');
    return out;
  }
  function putChange(state,change,today){
    date(today);if(change.fromDate<today||change.fromDate<state.plan.startDate||change.fromDate>state.plan.endDate||change.toDate!==null&&(change.toDate<today||change.toDate<state.plan.startDate||change.toDate>state.plan.endDate))fail('调课日期须在今天起的计划范围内');
    if(!base(state,change.fromDate).some(c=>c.id===change.courseId))fail('原日期没有这门课程');
    const out=clone(state);initialize(out);out.plan.courseSchedule.changes.push(clone(change));out.version=6;validate(out);return out;
  }
  function removeChange(state,id,today){const out=clone(state),s=schedule(out),c=s.changes.find(x=>x.id===id);if(!c)fail('未找到调课');if(c.fromDate<today||c.toDate!==null&&c.toDate<today)fail('已发生的调课保留在历史中');s.changes=s.changes.filter(x=>x.id!==id);out.plan.courseSchedule=s;validate(out);return out;}
  function saveReviews(state,d,rows,baseline){
    const out=clone(state),current=out.courseReviews?.[d]||[],prior=new Map((baseline||[]).map(r=>[r.key,r])),result=new Map(current.map(r=>[r.key,clone(r)]));
    for(const row of rows){const old=prior.get(row.key),now=result.get(row.key);if(!old)fail('复习清单已变化，请重新打开');const next=now?clone(now):clone(old);for(const f of ['done','note','task']){if(JSON.stringify(row[f])===JSON.stringify(old[f]))continue;if(now&&JSON.stringify(now[f])!==JSON.stringify(old[f])&&JSON.stringify(now[f])!==JSON.stringify(row[f]))fail('课程复习已更新，请重新打开后重试');next[f]=clone(row[f]);}if(next.task){const task=out.plan.weekTasks?.[next.task.week]?.find(t=>t.id===next.task.id);if(!task||task.title!==next.task.title){if(JSON.stringify(next.task)!==JSON.stringify(now?.task))fail('关联周任务已变化，请重新选择');}}result.set(row.key,next);}
    out.courseReviews=out.courseReviews||{};out.courseReviews[d]=[...result.values()];out.version=6;validate(out);return out;
  }
  function summary(state,d){const rows=state.courseReviews?.[d]||[];return rows.length?rows.filter(r=>r.done).length+'/'+rows.length+' 门已复习':'';}
  return {validate,initialize,initial,version,base,occurrences,checklist,putVersion,putChange,removeChange,saveReviews,summary,weekday,shift};
});
