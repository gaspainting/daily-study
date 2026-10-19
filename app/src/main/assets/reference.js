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
  var clone=function(v){return JSON.parse(JSON.stringify(v));};
  function capture(state,date,source,at){
    var p=state.plan,time=[],words=[];
    p.subjects.filter(function(s){return active(s,date);}).forEach(function(s){
      if(s.kind==='vocab'){var goals=p.wordTargets&&p.wordTargets[date];words.push({id:s.id,name:s.name,goal:goals&&has(goals,s.id)?goals[s.id]:has(s,'wordGoal')?s.wordGoal:50});}
      else time.push({id:s.id,name:s.name,kind:s.kind,reference:clone(value(state,date,s))});
    });
    return {rule:1,source:source||'record',capturedAt:at===undefined?new Date().toISOString():at,inside:date>=p.startDate&&date<=p.endDate,time:time,words:words};
  }
  function basis(state,date){return state.assessmentBases&&state.assessmentBases[date]||capture(state,date,'current',null);}
  function validateBasis(b,ids,vocabIds){
    function exact(o,fields){if(!o||Array.isArray(o)||typeof o!=='object'||Object.getPrototypeOf(o)!==Object.prototype||Object.keys(o).length!==fields.length||fields.some(function(k){return !has(o,k);}))throw new Error('评估依据字段无效');}
    exact(b,['rule','source','capturedAt','inside','time','words']);
    if(b.rule!==1||!['record','existing','recalculated'].includes(b.source)||typeof b.inside!=='boolean'||typeof b.capturedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/.test(b.capturedAt)||!Number.isFinite(Date.parse(b.capturedAt))||new Date(b.capturedAt).toISOString()!==b.capturedAt||b.capturedAt.slice(0,4)<'1900'||b.capturedAt.slice(0,4)>'2100')throw new Error('评估依据版本或时间无效');
    if(!Array.isArray(b.time)||!Array.isArray(b.words)||b.time.length+b.words.length>24)throw new Error('评估依据科目无效');
    var seen=Object.create(null);
    function entry(e,word){exact(e,word?['id','name','goal']:['id','name','kind','reference']);if(typeof e.id!=='string'||!has(ids,e.id)||seen[e.id]||typeof e.name!=='string'||!e.name.trim()||e.name.length>128||word!==!!vocabIds[e.id])throw new Error('评估依据科目无效');seen[e.id]=true;}
    b.time.forEach(function(e){entry(e,false);if(!['math','custom'].includes(e.kind))throw new Error('评估依据科目类型无效');validate(e.reference,true);});
    b.words.forEach(function(e){entry(e,true);if(typeof e.goal!=='number'||!Number.isInteger(e.goal)||e.goal<0||e.goal>100000)throw new Error('评估依据新学目标无效');});
  }
  function preserve(previous,next,at){
    next.version=Math.max(next.version,5);var saved=next.assessmentBases||(next.assessmentBases={});
    Object.keys(next.records).forEach(function(date){if(has(saved,date))return;if(previous.assessmentBases&&has(previous.assessmentBases,date))saved[date]=clone(previous.assessmentBases[date]);else saved[date]=capture(has(previous.records,date)?previous:next,date,has(previous.records,date)?'existing':'record',at);});return next;
  }
  function recalculate(state,date,at){if(!has(state.records,date))throw new Error('当天尚未保存记录');state.version=Math.max(state.version,5);state.assessmentBases=state.assessmentBases||{};state.assessmentBases[date]=capture(state,date,'recalculated',at);return state;}
  function assess(state,date){
    var record=state.records[date],entries=record&&record.subjects||{},status=record&&record.status,b=basis(state,date),inside=b.inside;
    var eligible=b.time;
    var selected=status==='仅回顾'?eligible.filter(function(s){return s.id==='course-review'&&s.kind==='custom';}):eligible;
    var min=0,max=0,legacy=false,actual=0,known=0,missing=0,targets=0;
    selected.forEach(function(s){var r=range(s.reference),entry=entries[s.id];if(r.max<=0)return;targets++;min+=r.min;max+=r.max;legacy=legacy||r.legacy;if(entry&&entry.minutes!==null&&entry.minutes!==undefined){actual+=entry.minutes;known++;}else missing++;});
    if(status==='减量'){min*=.5;max*=.5;}
    var kind=!inside?'outside':!record?'empty':!status?'arrangement':status==='休息'?'rest':status==='仅回顾'&&!selected.length?'review':!targets||legacy?'range':missing?(known?'partial':'empty'):grade(actual,min,max);
    var time={kind:kind,label:labels[kind],actual:known?actual:null,min:min,max:max,missing:missing,count:targets,scope:status==='仅回顾'?'课程复习':'学习时长',status:status||null};
    if(kind==='above')time.excess=actual-max;
    if(kind==='below')time.shortfall=min-actual;
    var words=b.words.map(function(s){
      var row=entries[s.id],goal=s.goal;
      var learned=row&&row.newWords!=null?row.newWords:null,reviewed=row&&row.reviewWords!=null?row.reviewWords:null;
      var kind=!inside?'outside':status==='休息'?'rest':learned===null?'empty':goal===0?'range':grade(learned,goal,goal);
      return {id:s.id,name:s.name,goal:inside?goal:null,newWords:learned,reviewWords:reviewed,kind:kind,label:kind==='range'?'未设置新学目标':labels[kind]};
    });
    return {time:time,words:words,basis:{saved:b.source!=='current',source:b.source,capturedAt:b.capturedAt,rule:b.rule}};
  }
  function counts(state,dates){var result={below:0,within:0,above:0,rest:0,pending:0};dates.forEach(function(d){var kind=assess(state,d).time.kind;if(has(result,kind))result[kind]++;else result.pending++;});return result;}
  function kind(result,dimension){
    if(dimension!=='words')return result.time.kind;
    var words=result.words;if(!words.length)return 'range';
    if(words.every(function(w){return w.kind==='rest';}))return 'rest';
    if(words.every(function(w){return ['below','within','above'].includes(w.kind);})){return words.some(function(w){return w.kind==='below';})?'below':words.some(function(w){return w.kind==='above';})?'above':'within';}
    if(words.some(function(w){return w.kind==='empty';}))return words.every(function(w){return w.kind==='empty';})?'empty':'partial';
    return 'range';
  }
  function category(value){return ['below','within','above','rest','empty','partial'].includes(value)?value:'pending';}
  function summary(state,days,dimension){var c={below:0,within:0,above:0,rest:0,empty:0,partial:0,pending:0};days.forEach(function(d){c[category(kind(assess(state,d),dimension))]++;});c.graded=c.below+c.within+c.above;c.achieved=c.within+c.above;c.rate=c.graded?Math.round(c.achieved/c.graded*100):null;return c;}
  function matches(state,date,dimension,filter){return !filter||filter==='all'||category(kind(assess(state,date),dimension))===filter;}
  return Object.freeze({range:range,validate:validate,midpoint:midpoint,text:text,total:total,value:value,assess:assess,counts:counts,decimal:decimal,capture:capture,basis:basis,validateBasis:validateBasis,preserve:preserve,recalculate:recalculate,kind:kind,summary:summary,matches:matches});
});
