(function(root,factory){
  'use strict';var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.StudyReference=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var has=function(o,k){return Object.prototype.hasOwnProperty.call(o,k);};
  function range(value){return typeof value==='number'?{min:value,max:value,legacy:true}:{min:value.min,max:value.max,legacy:false};}
  function validate(value,allowRange){
    if(typeof value==='number'){if(!Number.isFinite(value)||value<0||value>1440)throw new Error('参考分钟须在0—1440之间');return;}
    if(!allowRange||!value||Array.isArray(value)||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==2||!has(value,'min')||!has(value,'max'))throw new Error('参考区间须含下限和上限');
    [value.min,value.max].forEach(function(n){if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1440)throw new Error('参考区间须在0—1440分钟之间');});
    if(value.min>value.max)throw new Error('参考下限不能超过上限');
  }
  function midpoint(value){var r=range(value);return (r.min+r.max)/2;}
  function decimal(value){return String(Math.round(value*1000000)/1000000);}
  function text(value){if(value==null)return '—';var r=range(value);return r.legacy?decimal(r.min):decimal(r.min)+'—'+decimal(r.max);}
  function active(subject,date){return !subject.activePeriods||subject.activePeriods.some(function(p){return p.from<=date&&(p.to===null||date<p.to);});}
  function value(state,date,subject){var row=state.plan.targets[date];return row&&has(row,subject.id)?row[subject.id]:subject.defaults[(new Date(date+'T00:00:00Z').getUTCDay()+6)%7];}
  function total(state,date){
    var min=0,max=0,legacy=true;
    state.plan.subjects.filter(function(s){return s.kind!=='vocab'&&active(s,date);}).forEach(function(s){var r=range(value(state,date,s));min+=r.min;max+=r.max;if(!r.legacy)legacy=false;});
    return legacy?min:{min:min,max:max};
  }
  function grade(actual,min,max){return actual<min-1e-9?'below':actual>max+1e-9?'above':'within';}
  var labels={empty:'未记录',arrangement:'未选择安排',partial:'待补全时长',range:'未设置参考区间',review:'未设置课程复习',outside:'计划范围外',rest:'休息日',below:'未完成（不合格）',within:'完成（合格）',above:'超额完成'};
  function assess(state,date){
    var plan=state.plan,record=state.records[date],entries=record&&record.subjects||{},status=record&&record.status,inside=date>=plan.startDate&&date<=plan.endDate;
    var eligible=plan.subjects.filter(function(s){return s.kind!=='vocab'&&active(s,date);});
    var selected=status==='仅回顾'?eligible.filter(function(s){return s.id==='course-review'&&s.kind==='custom';}):eligible;
    var min=0,max=0,legacy=false,actual=0,known=0,missing=0,targets=0;
    selected.forEach(function(s){var r=range(value(state,date,s)),entry=entries[s.id];if(r.max<=0)return;targets++;min+=r.min;max+=r.max;legacy=legacy||r.legacy;if(entry&&entry.minutes!==null&&entry.minutes!==undefined){actual+=entry.minutes;known++;}else missing++;});
    if(status==='减量'){min*=.5;max*=.5;}
    var kind=!inside?'outside':!record?'empty':!status?'arrangement':status==='休息'?'rest':status==='仅回顾'&&!selected.length?'review':!targets||legacy?'range':missing?(known?'partial':'empty'):grade(actual,min,max);
    var time={kind:kind,label:labels[kind],actual:known?actual:null,min:min,max:max,missing:missing,count:targets,scope:status==='仅回顾'?'课程复习':'学习时长',status:status||null};
    if(kind==='above')time.excess=actual-max;
    if(kind==='below')time.shortfall=min-actual;
    var words=plan.subjects.filter(function(s){return s.kind==='vocab'&&active(s,date);}).map(function(s){
      var row=entries[s.id],targets=plan.wordTargets&&plan.wordTargets[date],goal=targets&&has(targets,s.id)?targets[s.id]:has(s,'wordGoal')?s.wordGoal:50;
      var learned=row&&row.newWords!=null?row.newWords:null,reviewed=row&&row.reviewWords!=null?row.reviewWords:null;
      var kind=!inside?'outside':status==='休息'?'rest':learned===null?'empty':goal===0?'range':grade(learned,goal,goal);
      return {id:s.id,name:s.name,goal:inside?goal:null,newWords:learned,reviewWords:reviewed,kind:kind,label:kind==='range'?'未设置新学目标':labels[kind]};
    });
    return {time:time,words:words};
  }
  function counts(state,dates){var result={below:0,within:0,above:0,rest:0,pending:0};dates.forEach(function(d){var kind=assess(state,d).time.kind;if(has(result,kind))result[kind]++;else result.pending++;});return result;}
  return Object.freeze({range:range,validate:validate,midpoint:midpoint,text:text,total:total,value:value,assess:assess,counts:counts,decimal:decimal});
});
