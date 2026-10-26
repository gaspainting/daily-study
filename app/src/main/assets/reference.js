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
  function text(value){if(value==null)return '—';var r=range(value);var low=decimal(r.min),high=decimal(r.max);return low===high?low:low+'—'+high;}
  function active(subject,date){return !subject.activePeriods||subject.activePeriods.some(function(p){return p.from<=date&&(p.to===null||date<p.to);});}
  function value(state,date,subject){var row=state.plan.targets[date];return row&&has(row,subject.id)?row[subject.id]:subject.defaults[(new Date(date+'T00:00:00Z').getUTCDay()+6)%7];}
  function isQuantity(subject){return subject&&subject.measure==='quantity';}
  function quantityTarget(state,date,subject){var goals=state.plan.quantityTargets&&state.plan.quantityTargets[date];return goals&&has(goals,subject.id)?goals[subject.id]:subject.defaults[(new Date(date+'T00:00:00Z').getUTCDay()+6)%7];}
  function quantityUnit(state,date,subject){
    var p=state.plan.quantityUnits,row=p&&p[date];if(row&&has(row,subject.id))return row[subject.id];
    var b=state.assessmentBases&&state.assessmentBases[date],saved=b&&(b.quantities||[]).find(function(q){return q.id===subject.id;});if(saved)return saved.unit;
    var entry=state.records[date]&&state.records[date].subjects[subject.id];return entry&&entry.quantityUnit||subject.unit;
  }
  function total(state,date){
    var min=0,max=0,legacy=true;
    state.plan.subjects.filter(function(s){return s.kind!=='vocab'&&!isQuantity(s)&&active(s,date);}).forEach(function(s){var r=range(value(state,date,s));min+=r.min;max+=r.max;if(!r.legacy)legacy=false;});
    return legacy?min:{min:min,max:max};
  }
  function grade(actual,min,max){return actual<min-1e-9?'below':actual>max+1e-9?'above':'within';}
  var labels={empty:'未记录',arrangement:'未选择安排',partial:'待补全时长',range:'未安排时长',review:'未设置课程复习',outside:'计划范围外',rest:'休息日',below:'未完成（不合格）',within:'完成（合格）',above:'超额完成'};
  var clone=function(v){return JSON.parse(JSON.stringify(v));};
  function capture(state,date,source,at){
    var p=state.plan,time=[],words=[],quantities=[];
    p.subjects.filter(function(s){return active(s,date);}).forEach(function(s){
      if(s.kind==='vocab'){var goals=p.wordTargets&&p.wordTargets[date];words.push({id:s.id,name:s.name,goal:goals&&has(goals,s.id)?goals[s.id]:has(s,'wordGoal')?s.wordGoal:50});}
      else if(isQuantity(s)) quantities.push({id:s.id,name:s.name,unit:quantityUnit(state,date,s),goal:quantityTarget(state,date,s)});
      else time.push({id:s.id,name:s.name,kind:s.kind,reference:clone(value(state,date,s))});
    });
    return {rule:1,source:source||'record',capturedAt:at===undefined?new Date().toISOString():at,inside:date>=p.startDate&&date<=p.endDate,time:time,words:words,quantities:quantities};
  }
  function basis(state,date){return state.assessmentBases&&state.assessmentBases[date]||capture(state,date,'current',null);}
  function validateBasis(b,ids,vocabIds,quantityIds){
    function exact(o,fields){if(!o||Array.isArray(o)||typeof o!=='object'||Object.getPrototypeOf(o)!==Object.prototype||Object.keys(o).length!==fields.length||fields.some(function(k){return !has(o,k);}))throw new Error('评估依据字段无效');}
    var hasQuantities=has(b,'quantities'); exact(b,hasQuantities?['rule','source','capturedAt','inside','time','words','quantities']:['rule','source','capturedAt','inside','time','words']);
    if(b.rule!==1||!['record','existing','recalculated'].includes(b.source)||typeof b.inside!=='boolean'||typeof b.capturedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/.test(b.capturedAt)||!Number.isFinite(Date.parse(b.capturedAt))||new Date(b.capturedAt).toISOString()!==b.capturedAt||b.capturedAt.slice(0,4)<'1900'||b.capturedAt.slice(0,4)>'2100')throw new Error('评估依据版本或时间无效');
    if(!Array.isArray(b.time)||!Array.isArray(b.words)||hasQuantities&&!Array.isArray(b.quantities)||b.time.length+b.words.length+(hasQuantities?b.quantities.length:0)>24)throw new Error('评估依据科目无效');
    var seen=Object.create(null);
    function entry(e,word){exact(e,word?['id','name','goal']:['id','name','kind','reference']);if(typeof e.id!=='string'||!has(ids,e.id)||seen[e.id]||typeof e.name!=='string'||!e.name.trim()||e.name.length>128||word!==!!vocabIds[e.id])throw new Error('评估依据科目无效');seen[e.id]=true;}
    b.time.forEach(function(e){entry(e,false);if(!['math','custom'].includes(e.kind))throw new Error('评估依据科目类型无效');validate(e.reference,true);});
    b.words.forEach(function(e){entry(e,true);if(typeof e.goal!=='number'||!Number.isInteger(e.goal)||e.goal<0||e.goal>100000)throw new Error('评估依据新学目标无效');});
    if(hasQuantities)b.quantities.forEach(function(e){exact(e,['id','name','unit','goal']);if(typeof e.id!=='string'||!has(ids,e.id)||seen[e.id]||typeof e.name!=='string'||!e.name.trim()||e.name.length>128||vocabIds[e.id]||quantityIds&& !quantityIds[e.id])throw new Error('评估依据数量科目无效');if(typeof e.unit!=='string'||!e.unit.trim()||e.unit.length>32||typeof e.goal!=='number'||!Number.isInteger(e.goal)||e.goal<0||e.goal>100000)throw new Error('评估依据数量目标无效');seen[e.id]=true;});
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
    var min=0,max=0,actual=0,known=0,missing=0,targets=0;
    selected.forEach(function(s){var r=range(s.reference),entry=entries[s.id],written=entry&&entry.minutes!=null;if(written){actual+=entry.minutes;known++;}if(r.max<=0)return;targets++;min+=r.min;max+=r.max;if(!written)missing++;});
    if(status==='减量'){min*=.5;max*=.5;}
    var kind=!inside?'outside':!record?'empty':!status?'arrangement':status==='休息'?'rest':status==='仅回顾'&&!selected.length?'review':!targets?'range':missing?(known?'partial':'empty'):grade(actual,min,max);
    var time={kind:kind,label:labels[kind],actual:known?actual:null,min:min,max:max,missing:missing,count:targets,scope:status==='仅回顾'?'课程复习':'学习时长',status:status||null};
    if(kind==='above')time.excess=actual-max;
    if(kind==='below')time.shortfall=min-actual;
    var words=b.words.map(function(s){
      var row=entries[s.id],goal=s.goal;
      var learned=row&&row.newWords!=null?row.newWords:null,reviewed=row&&row.reviewWords!=null?row.reviewWords:null;
      var kind=!inside?'outside':status==='休息'?'rest':learned===null?'empty':goal===0?'range':grade(learned,goal,goal);
      return {id:s.id,name:s.name,goal:inside?goal:null,newWords:learned,reviewWords:reviewed,kind:kind,label:kind==='range'?'未设置新学目标':labels[kind]};
    });
    var quantities=(b.quantities||[]).map(function(s){
      var row=entries[s.id],goal=status==='减量'?s.goal*.5:s.goal,actual=row&&row.quantity!=null?row.quantity:null,unit=row&&row.quantityUnit||s.unit;
      var qkind=!inside?'outside':status==='休息'?'rest':status==='仅回顾'?'review':actual===null?'empty':unit!==s.unit?'unit':goal===0?'range':grade(actual,goal,goal);
      return {id:s.id,name:s.name,unit:s.unit,actualUnit:unit,goal:inside?goal:null,quantity:actual,kind:qkind,label:qkind==='range'?'未设置数量目标':qkind==='unit'?'单位不同':qkind==='review'?'仅回顾':labels[qkind]};
    });
    return {time:time,words:words,quantities:quantities,basis:{saved:b.source!=='current',source:b.source,capturedAt:b.capturedAt,rule:b.rule}};
  }
  // Only ungradable/legacy criteria for today and future records are repaired.
  // Existing interval-based history and independent word criteria stay intact.
  var upgradeAt=new Date().toISOString();
  function upgrade(state,now,at){
    Object.keys(state.assessmentBases||{}).forEach(function(date){
      if(date<now||date<state.plan.startDate||date>state.plan.endDate)return;
      var old=state.assessmentBases[date],positive=old.time.some(function(s){return range(s.reference).max>0;}),legacy=old.time.some(function(s){return typeof s.reference==='number'&&s.reference>0;});
      if(positive&&!legacy)return;
      var next=capture(state,date,'recalculated',at||upgradeAt);
      if(!next.time.some(function(s){return range(s.reference).max>0;}))return;
      old.time=next.time;old.source=next.source;old.capturedAt=next.capturedAt;
    });return state;
  }
  function distribute(entries,total){
    var n=entries.length;
    if(!n||!total||!Number.isFinite(total.min)||!Number.isFinite(total.max)||total.min<0||total.min>total.max||total.max>1440*n)throw new Error('总参考区间无效');
    entries.forEach(function(e){validate(e.reference,true);});
    function allocate(amount,weights,limits){
      var out=weights.map(function(){return 0;}),remaining=amount;
      for(var pass=0;pass<=n&&remaining>1e-9;pass++){
        var open=out.map(function(v,i){return limits[i]-v>1e-9?i:-1;}).filter(function(i){return i>=0;}),sum=open.reduce(function(a,i){return a+weights[i];},0),rest=remaining;
        open.forEach(function(i){var add=Math.min(limits[i]-out[i],rest*(sum?weights[i]/sum:1/open.length));out[i]+=add;remaining-=add;});
      }
      var scale=Number.isInteger(amount)&&limits.every(Number.isInteger)?1:1000000,units=Math.round(amount*scale),rounded=out.map(function(v){return Math.floor(v*scale+1e-8);}),left=units-rounded.reduce(function(a,v){return a+v;},0);
      var order=out.map(function(v,i){return i;}).sort(function(a,b){return (out[b]*scale-rounded[b])-(out[a]*scale-rounded[a])||a-b;});
      order.forEach(function(i){if(left>0&&rounded[i]<Math.round(limits[i]*scale)){rounded[i]++;left--;}});
      return rounded.map(function(v){return v/scale;});
    }
    var ranges=entries.map(function(e){return range(e.reference);}),mins=allocate(total.min,ranges.map(function(r){return r.min;}),ranges.map(function(){return 1440;}));
    var extra=allocate(total.max-total.min,ranges.map(function(r){return r.max-r.min;}),mins.map(function(v){return 1440-v;}));
    return entries.map(function(e,i){return {id:e.id,reference:{min:mins[i],max:mins[i]+extra[i]}};});
  }
  function counts(state,dates){var result={below:0,within:0,above:0,rest:0,pending:0};dates.forEach(function(d){var kind=assess(state,d).time.kind;if(has(result,kind))result[kind]++;else result.pending++;});return result;}
  function kind(result,dimension){
    if(dimension==='time')return result.time.kind;
    var words=dimension==='words'?result.words:result.quantities||[];if(!words.length)return 'range';
    if(words.every(function(w){return w.kind==='rest';}))return 'rest';
    if(words.every(function(w){return ['below','within','above'].includes(w.kind);})){return words.some(function(w){return w.kind==='below';})?'below':words.some(function(w){return w.kind==='above';})?'above':'within';}
    if(words.some(function(w){return w.kind==='empty';}))return words.every(function(w){return w.kind==='empty';})?'empty':'partial';
    return 'range';
  }
  function category(value){return ['below','within','above','rest','empty','partial'].includes(value)?value:'pending';}
  function summary(state,days,dimension){var c={below:0,within:0,above:0,rest:0,empty:0,partial:0,pending:0};days.forEach(function(d){c[category(kind(assess(state,d),dimension))]++;});c.graded=c.below+c.within+c.above;c.achieved=c.within+c.above;c.rate=c.graded?Math.round(c.achieved/c.graded*100):null;return c;}
  function matches(state,date,dimension,filter,subjectId){if(!filter||filter==='all')return true;var result=assess(state,date);if(subjectId&&subjectId!=='all'&&dimension!=='time'){var field=dimension==='words'?'words':'quantities';result[field]=(result[field]||[]).filter(function(s){return s.id===subjectId;});}return category(kind(result,dimension))===filter;}
  return Object.freeze({upgrade:upgrade,distribute:distribute,range:range,validate:validate,midpoint:midpoint,text:text,total:total,value:value,assess:assess,counts:counts,decimal:decimal,capture:capture,basis:basis,validateBasis:validateBasis,preserve:preserve,recalculate:recalculate,kind:kind,summary:summary,matches:matches,isQuantity:isQuantity,quantityTarget:quantityTarget,quantityUnit:quantityUnit});
});
