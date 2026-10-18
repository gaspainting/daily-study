(function(root,factory){
  'use strict';
  var data=root.StudyCourseData||(typeof module==='object'&&module.exports?require('./course-schedule-data.js'):null);
  var schedule=factory(data);
  if(typeof module==='object'&&module.exports)module.exports=schedule;
  root.StudySchedule=schedule;
})(typeof globalThis!=='undefined'?globalThis:this,function(data){
  'use strict';
  var DAY=86400000,clone=function(value){return JSON.parse(JSON.stringify(value));};
  var R=typeof globalThis!=='undefined'&&globalThis.StudyReference||(typeof require==='function'?require('./reference.js'):null);
  function fallback(weekday,key){
    if(weekday<5)return clone(data.weekdayRanges.light[key]);
    var limits=data.weekendRanges[weekday===5?'saturday':'sunday'][key==='review'?'morning':'afternoon'];return {min:limits[0],max:limits[1]};
  }
  function budget(weekday){var a=fallback(weekday,'review'),b=fallback(weekday,'math');return {min:a.min+b.min,max:a.max+b.max};}
  function day(date){
    var stamp=Date.parse(date+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==date)throw new Error('日期无效');
    if(data.days[date])return clone(data.days[date]);
    var weekday=(new Date(stamp).getUTCDay()+6)%7;
    var review=weekday===5?data.saturdayReview:weekday===6?data.sundayReview:data.lightReview;
    var budget=weekday===5?data.saturdayBudget:weekday===6?data.sundayBudget:data.weekdayBudget;
    return {weekday:weekday,courses:null,review:review,math:budget-review,reviewRange:fallback(weekday,'review'),mathRange:fallback(weekday,'math')};
  }
  function active(item,date){return !item.activePeriods||item.activePeriods.some(function(p){return p.from<=date&&(p.to===null||date<p.to);});}
  function find(state,id){return state.plan.subjects.find(function(s){return s.id===id;});}
  function from(state,now){day(now);return [now,data.effectiveFrom,state.plan.startDate].sort().pop();}
  function canApply(state,now){
    var first=from(state,now),math=find(state,'math'),vocab=find(state,'vocab'),course=find(state,data.subjectId);
    return first<=state.plan.endDate&&!!math&&math.kind==='math'&&active(math,first)&&!!vocab&&vocab.kind==='vocab'&&(!course?state.plan.subjects.length<24:course.kind==='custom'&&active(course,first));
  }
  function original(state){return state.plan.startDate===data.anchor&&state.plan.endDate===data.lastDate&&state.plan.startWeek===7;}
  function preserveDefaults(state,items,before,weekendsOnly){
    for(var stamp=Date.parse(state.plan.startDate+'T00:00:00Z'),last=Date.parse(state.plan.endDate+'T00:00:00Z');stamp<=last;stamp+=DAY){
      var date=new Date(stamp).toISOString().slice(0,10),weekday=(new Date(stamp).getUTCDay()+6)%7;
      if(date>=before||weekendsOnly&&weekday<5)continue;
      items.forEach(function(s){if(!active(s,date))return;var stored=state.plan.targets[date]||(state.plan.targets[date]={});if(!Object.prototype.hasOwnProperty.call(stored,s.id))stored[s.id]=clone(s.defaults[weekday]);});
    }
  }
  function apply(state,now,force){
    if(!canApply(state,now))throw new Error('当前计划无法应用课程优先安排');
    var plan=state.plan,first=from(state,now),math=find(state,'math'),course=find(state,data.subjectId);
    var legacyDefaults=JSON.stringify(math.defaults)===JSON.stringify(data.legacyMathDefaults);
    if(legacyDefaults){
      for(var oldStamp=Date.parse(plan.startDate+'T00:00:00Z'),cutoff=Date.parse(first+'T00:00:00Z');oldStamp<cutoff;oldStamp+=DAY){
        var oldDate=new Date(oldStamp).toISOString().slice(0,10),oldTargets=plan.targets[oldDate]||(plan.targets[oldDate]={});
        if(!Object.prototype.hasOwnProperty.call(oldTargets,'math'))oldTargets.math=math.defaults[(new Date(oldStamp).getUTCDay()+6)%7];
      }
    }
    if(!course){course={id:data.subjectId,name:data.subjectName,kind:'custom',defaults:[0,1,2,3,4,5,6].map(function(d){return fallback(d,'review');}),activePeriods:[{from:first,to:null}]};}
    plan.subjects=[course].concat(plan.subjects.filter(function(s){return s.id!==course.id;}));
    for(var stamp=Date.parse(first+'T00:00:00Z'),last=Date.parse(plan.endDate+'T00:00:00Z');stamp<=last;stamp+=DAY){
      var date=new Date(stamp).toISOString().slice(0,10),row=day(date),stored=plan.targets[date]||(plan.targets[date]={});
      if(force||(data.days[date]&&(Object.prototype.hasOwnProperty.call(stored,'math')?stored.math===row.legacyMath:legacyDefaults)))stored.math=clone(row.mathRange);
      if(force||!Object.prototype.hasOwnProperty.call(stored,course.id))stored[course.id]=clone(row.reviewRange);
    }
    if(force){preserveDefaults(state,[course,math],first,false);course.defaults=[0,1,2,3,4,5,6].map(function(d){return fallback(d,'review');});}
    if(legacyDefaults||force)math.defaults=[0,1,2,3,4,5,6].map(function(d){return fallback(d,'math');});
    if(plan.title===data.legacyTitle)plan.title=data.title;
    state.version=Math.max(state.version,4);return state;
  }
  function upgrade(state,now){if(original(state)&&!find(state,data.subjectId)&&canApply(state,now))apply(state,now,false);return state;}
  function weekendDates(state,now){
    var first=from(state,now),course=find(state,data.subjectId),math=find(state,'math'),dates=[];
    if(!course||course.kind!=='custom'||!math||math.kind!=='math')return dates;
    for(var stamp=Date.parse(first+'T00:00:00Z'),last=Date.parse(state.plan.endDate+'T00:00:00Z');stamp<=last;stamp+=DAY){
      var date=new Date(stamp).toISOString().slice(0,10);
      if(day(date).weekday>=5&&active(course,date)&&active(math,date))dates.push(date);
    }
    return dates;
  }
  function applyWeekends(state,now){
    var dates=weekendDates(state,now);
    if(!dates.length)throw new Error('当前计划没有可调整的周末日期');
    var course=find(state,data.subjectId),math=find(state,'math');preserveDefaults(state,[course,math],from(state,now),true);
    dates.forEach(function(date){var row=day(date),stored=state.plan.targets[date]||(state.plan.targets[date]={});stored[data.subjectId]=clone(row.reviewRange);stored.math=clone(row.mathRange);});
    [5,6].forEach(function(d){course.defaults[d]=fallback(d,'review');math.defaults[d]=fallback(d,'math');});
    state.version=Math.max(state.version,4);
    return state;
  }
  function agenda(state,date){
    var course=find(state,data.subjectId),math=find(state,'math');
    if(!course||course.kind!=='custom'||date<state.plan.startDate||date>state.plan.endDate)return null;
    var scheduled=active(course,date);
    // The original timetable predates the added subject. Show its course order
    // without extending subject activity or rewriting historical references.
    var historical=original(state)&&data.days[date]&&course.activePeriods&&course.activePeriods.length&&course.activePeriods.every(function(p){return date<p.from;});
    if(!scheduled&&!historical)return null;
    var row=day(date),stored=state.plan.targets[date]||{},weekday=row.weekday;
    var courseRange=scheduled?(Object.prototype.hasOwnProperty.call(stored,course.id)?stored[course.id]:course.defaults[weekday]):null;
    var mathRange=math&&active(math,date)?Object.prototype.hasOwnProperty.call(stored,math.id)?stored[math.id]:math.defaults[weekday]:null;
    var courseMinutes=courseRange===null?null:R.midpoint(courseRange),mathMinutes=mathRange===null?null:R.midpoint(mathRange);
    var ranges=weekday>=5?data.weekendRanges[weekday===5?'saturday':'sunday']:null;
    var periods=ranges&&courseMinutes>=ranges.morning[0]&&courseMinutes<=ranges.morning[1]&&mathMinutes>=ranges.afternoon[0]&&mathMinutes<=ranges.afternoon[1]?clone(ranges):null;
    return {courseId:course.id,courseName:course.name,courseMinutes:courseMinutes,courseRange:clone(courseRange),mathName:math?math.name:'高数',mathMinutes:mathMinutes,mathRange:clone(mathRange),courses:row.courses,weekday:weekday,periods:periods};
  }
  return Object.freeze({day:day,from:from,canApply:canApply,apply:apply,upgrade:upgrade,agenda:agenda,weekendDates:weekendDates,applyWeekends:applyWeekends,weekendRanges:clone(data.weekendRanges),subjectId:data.subjectId,budgetRanges:{weekday:budget(0),saturday:budget(5),sunday:budget(6)},budgets:Object.freeze({weekday:data.weekdayBudget,saturday:data.saturdayBudget,sunday:data.sundayBudget})});
});
