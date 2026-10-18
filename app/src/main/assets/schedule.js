(function(root,factory){
  'use strict';
  var data=root.StudyCourseData||(typeof module==='object'&&module.exports?require('./course-schedule-data.js'):null);
  var schedule=factory(data);
  if(typeof module==='object'&&module.exports)module.exports=schedule;
  root.StudySchedule=schedule;
})(typeof globalThis!=='undefined'?globalThis:this,function(data){
  'use strict';
  var DAY=86400000,clone=function(value){return JSON.parse(JSON.stringify(value));};
  function day(date){
    var stamp=Date.parse(date+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==date)throw new Error('日期无效');
    if(data.days[date])return clone(data.days[date]);
    var weekday=(new Date(stamp).getUTCDay()+6)%7;
    var review=weekday===5?data.saturdayReview:weekday===6?data.sundayReview:data.lightReview;
    var budget=weekday===5?data.saturdayBudget:weekday===6?data.sundayBudget:data.weekdayBudget;
    return {weekday:weekday,courses:null,review:review,math:budget-review};
  }
  function active(item,date){return !item.activePeriods||item.activePeriods.some(function(p){return p.from<=date&&(p.to===null||date<p.to);});}
  function find(state,id){return state.plan.subjects.find(function(s){return s.id===id;});}
  function from(state,now){day(now);return [now,data.effectiveFrom,state.plan.startDate].sort().pop();}
  function canApply(state,now){
    var first=from(state,now),math=find(state,'math'),vocab=find(state,'vocab'),course=find(state,data.subjectId);
    return first<=state.plan.endDate&&!!math&&math.kind==='math'&&active(math,first)&&!!vocab&&vocab.kind==='vocab'&&(!course?state.plan.subjects.length<24:course.kind==='custom'&&active(course,first));
  }
  function original(state){return state.plan.startDate===data.anchor&&state.plan.endDate===data.lastDate&&state.plan.startWeek===7;}
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
    if(!course){course={id:data.subjectId,name:data.subjectName,kind:'custom',defaults:[data.lightReview,data.lightReview,data.lightReview,data.lightReview,data.lightReview,data.saturdayReview,data.sundayReview],activePeriods:[{from:first,to:null}]};}
    plan.subjects=[course].concat(plan.subjects.filter(function(s){return s.id!==course.id;}));
    for(var stamp=Date.parse(first+'T00:00:00Z'),last=Date.parse(plan.endDate+'T00:00:00Z');stamp<=last;stamp+=DAY){
      var date=new Date(stamp).toISOString().slice(0,10),row=day(date),stored=plan.targets[date]||(plan.targets[date]={});
      if(force||(data.days[date]&&(Object.prototype.hasOwnProperty.call(stored,'math')?stored.math===row.legacyMath:legacyDefaults)))stored.math=row.math;
      if(force||!Object.prototype.hasOwnProperty.call(stored,course.id))stored[course.id]=row.review;
    }
    if(legacyDefaults)math.defaults=[data.weekdayBudget-data.lightReview,data.weekdayBudget-data.lightReview,data.weekdayBudget-data.lightReview,data.weekdayBudget-data.lightReview,data.weekdayBudget-data.lightReview,data.saturdayBudget-data.saturdayReview,data.sundayBudget-data.sundayReview];
    if(plan.title===data.legacyTitle)plan.title=data.title;
    state.version=Math.max(state.version,2);return state;
  }
  function upgrade(state,now){if(original(state)&&!find(state,data.subjectId)&&canApply(state,now))apply(state,now,false);return state;}
  function agenda(state,date){
    var course=find(state,data.subjectId),math=find(state,'math');
    if(!course||course.kind!=='custom'||!active(course,date)||date<state.plan.startDate||date>state.plan.endDate)return null;
    var row=day(date),stored=state.plan.targets[date]||{},weekday=row.weekday;
    var courseMinutes=Object.prototype.hasOwnProperty.call(stored,course.id)?stored[course.id]:course.defaults[weekday];
    var mathMinutes=math&&active(math,date)?Object.prototype.hasOwnProperty.call(stored,math.id)?stored[math.id]:math.defaults[weekday]:null;
    return {courseId:course.id,courseName:course.name,courseMinutes:courseMinutes,mathName:math?math.name:'高数',mathMinutes:mathMinutes,courses:row.courses,weekday:weekday};
  }
  return Object.freeze({day:day,from:from,canApply:canApply,apply:apply,upgrade:upgrade,agenda:agenda,subjectId:data.subjectId,budgets:Object.freeze({weekday:data.weekdayBudget,saturday:data.saturdayBudget,sunday:data.sundayBudget})});
});
