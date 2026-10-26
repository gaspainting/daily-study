(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.StudyEvaluation=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const copy=x=>JSON.parse(JSON.stringify(x)),has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k),DAY=86400000;
 const fields=['minutes','newWords','reviewWords','quantity'],roles=['study','review','unknown'],types=['study','review','rest'];
 function fail(s){throw new Error(s);}
 function object(o){if(!o||typeof o!=='object'||Array.isArray(o)||![Object.prototype,null].includes(Object.getPrototypeOf(o)))fail('评估数据格式无效');}
 function exact(o,keys){object(o);if(Object.keys(o).length!==keys.length||keys.some(k=>!has(o,k)))fail('评估字段无效');}
 function day(d){if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||d<'1900-01-01'||d>'2100-12-31'||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)fail('评估日期无效');return d;}
 const shift=(d,n)=>new Date(Date.parse(day(d)+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
 const weekday=d=>(new Date(day(d)+'T00:00:00Z').getUTCDay()+6)%7;
 function dates(a,b){const result=[];for(let d=a;d<=b;d=shift(d,1)){if(result.length>100000)fail('评估日期过多');result.push(d);}return result;}
 function finite(n,max=100000){if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>max)fail('评估数值无效');}
 function range(v){return typeof v==='number'?{min:v,max:v}:{min:v.min,max:v.max};}
 function validRange(r,max=34560){exact(r,['min','max']);finite(r.min,max);finite(r.max,max);if(r.min>r.max)fail('评估区间无效');}
 function at(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString()!==s)fail('评估修订时间无效');}
 const formatters=new Map();
 function offset(z){const m=/^(?:GMT|UTC)?([+-])(\d{2}):(\d{2})$/.exec(z);if(!m)return null;const n=Number(m[2])*60+Number(m[3]);if(Number(m[3])>59||n>1080)fail('计划时区无效');return (m[1]==='-'?-1:1)*n;}
 function timezone(z){if(typeof z!=='string'||z.length>80)fail('计划时区无效');if(offset(z)!==null)return;try{if(!formatters.has(z))formatters.set(z,new Intl.DateTimeFormat('en-CA',{timeZone:z,year:'numeric',month:'2-digit',day:'2-digit'}));}catch(_){fail('计划时区无效');}}
 function context(timeZone,instant){timeZone=timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone;timezone(timeZone);const now=instant===undefined?new Date():new Date(instant),minutes=offset(timeZone);if(minutes!==null)return {today:new Date(now.getTime()+minutes*60000).toISOString().slice(0,10),at:now.toISOString(),timezone:timeZone};const parts=formatters.get(timeZone).formatToParts(now),get=k=>parts.find(p=>p.type===k).value;return {today:get('year')+'-'+get('month')+'-'+get('day'),at:now.toISOString(),timezone:timeZone};}
 const canonical=x=>JSON.stringify(x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])):Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):x);
 const same=(a,b)=>canonical(a)===canonical(b);
 function active(s,d){return !s.activePeriods||s.activePeriods.some(p=>p.from<=d&&(p.to===null||d<p.to));}
 function defaultConfig(type='study'){return {type,requiredTime:type!=='rest',requiredCourse:false,requiredWords:type==='study',requiredQuantities:type==='study',reviewMin:null,reviewMax:null,reviewWords:0,roles:{}};}
 function validateConfig(c,ids){exact(c,['type','requiredTime','requiredCourse','requiredWords','requiredQuantities','reviewMin','reviewMax','reviewWords','roles']);if(!types.includes(c.type))fail('日程类型无效');for(const k of ['requiredTime','requiredCourse','requiredWords','requiredQuantities'])if(typeof c[k]!=='boolean')fail('必达目标设置无效');if((c.reviewMin===null)!==(c.reviewMax===null))fail('请填写完整回顾区间');if(c.reviewMin!==null)validRange({min:c.reviewMin,max:c.reviewMax},1440);finite(c.reviewWords);if(!Number.isInteger(c.reviewWords))fail('复习词数须为整数');object(c.roles);Object.entries(c.roles).forEach(([id,r])=>{if(!ids.has(id)||!roles.includes(r))fail('活动角色无效');});if(c.type==='rest'&&(c.requiredTime||c.requiredCourse||c.requiredWords||c.requiredQuantities||c.reviewWords>0))fail('休息安排不能同时设置必达学习目标');}
 function resolve(e,d){const revision=e.schedule.filter(v=>v.from<=d).slice(-1)[0]||e.schedule[0],key=String(weekday(d));return {config:revision.dates[d]||revision.weekly[key]||revision.default,source:revision.dates[d]?'date:'+d:revision.weekly[key]?'weekly:'+key:'default',revision:revision.revision};}
 function role(s,c){return c.roles[s.id]||(s.id==='course-review'&&s.kind==='custom'?'review':s.kind==='math'?'study':'unknown');}
 function snapshot(state,d,c,source,revision,capturedAt,timeZone){
  const p=state.plan,items=[],time=[],words=[],quantities=[],activity=[];let total={min:0,max:0},course=null;
  const sourceFor=(s,field,r,requiredInput,unit=null)=>({subjectId:s.id,field,role:r,requiredInput,unit});
  function item(id,name,measure,unit,min,max,required,r,sources){items.push({id,name,measure,unit,min,max,required:required&&min>0,role:r,sources});}
  p.subjects.filter(s=>active(s,d)).forEach(s=>{
   if(s.kind==='vocab'){
    const goals=p.wordTargets&&p.wordTargets[d],goal=goals&&has(goals,s.id)?goals[s.id]:(s.wordGoal===undefined?50:s.wordGoal),n=sourceFor(s,'newWords','study',true),r=sourceFor(s,'reviewWords','review',true);
    words.push({id:s.id,name:s.name,goal,reviewGoal:c.reviewWords});activity.push(n,r);
    item('new:'+s.id,s.name+'新学','quantity','个',goal,goal,c.type==='study'&&c.requiredWords,'study',[n]);
    item('review:'+s.id,s.name+'复习','quantity','个',c.reviewWords,c.reviewWords,c.type!=='rest'&&c.reviewWords>0,'review',[r]);
   }else if(s.measure==='quantity'){
    const row=p.quantityTargets&&p.quantityTargets[d],goal=row&&has(row,s.id)?row[s.id]:s.defaults[weekday(d)],old=state.assessmentBases&&state.assessmentBases[d],saved=old&&(old.quantities||[]).find(q=>q.id===s.id),entry=state.records[d]&&state.records[d].subjects[s.id],u=p.quantityUnits&&p.quantityUnits[d]&&p.quantityUnits[d][s.id]||saved&&saved.unit||entry&&entry.quantityUnit||s.unit,r=role(s,c),src=sourceFor(s,'quantity',r,true,u);
    quantities.push({id:s.id,name:s.name,goal,unit:u});activity.push(src);item('quantity:'+s.id,s.name,'quantity',u,goal,goal,c.type!=='rest'&&c.requiredQuantities&&(c.type==='study'||r==='review'),r,[src]);
   }else{
    const row=p.targets[d],ref=range(row&&has(row,s.id)?row[s.id]:s.defaults[weekday(d)]),r=role(s,c),src=sourceFor(s,'minutes',r,ref.max>0);
    time.push({id:s.id,name:s.name,kind:s.kind,reference:ref,role:r});activity.push(src);total.min+=ref.min;total.max+=ref.max;if(s.id==='course-review'&&s.kind==='custom')course={subject:s,ref,src};
    item('time:'+s.id,s.name,'time','分钟',ref.min,ref.max,c.type==='study'&&c.requiredCourse&&s.id==='course-review',r,[src]);
   }
  });
  const reviewRange=c.reviewMin===null?(course?course.ref:{min:0,max:0}):{min:c.reviewMin,max:c.reviewMax},r=c.type==='review'?reviewRange:total,sources=c.type==='review'?(course?[{...course.src,requiredInput:true}]:[]):activity.filter(s=>s.field==='minutes');
  const inferredReview=c.type==='review'||c.requiredTime&&r.min>0&&sources.some(s=>s.requiredInput)&&sources.filter(s=>s.requiredInput).every(s=>s.role==='review')&&items.filter(i=>i.required).every(i=>i.role==='review');if(inferredReview){for(let i=sources.length-1;i>=0;i--)if(sources[i].role!=='review')sources.splice(i,1);}
  items.unshift({id:'total-time',name:inferredReview?'回顾时间':'总时长',measure:'time',unit:'分钟',min:r.min,max:r.max,required:c.type!=='rest'&&c.requiredTime&&r.min>0,role:c.type==='review'||sources.some(s=>s.requiredInput)&&sources.filter(s=>s.requiredInput).every(s=>s.role==='review')?'review':'unknown',sources});
  const required=items.filter(i=>i.required),dayType=c.type==='rest'?'rest':!required.length?'unplanned':required.every(i=>i.role==='review')?'review':'study';
  return {rule:2,date:d,timezone:timeZone,capturedAt,revision,source,dayType,items,time,words,quantities,activity};
 }
 function initialize(state,ctx){
  if(state.evaluation)return state;ctx=ctx||context();day(ctx.today);at(ctx.at);timezone(ctx.timezone);
  const legacy=state.records[ctx.today]?{record:copy(state.records[ctx.today]),basis:copy(state.assessmentBases&&state.assessmentBases[ctx.today]||null)}:null;
  const first=shift(ctx.today,1),e={version:1,timezone:ctx.timezone,activatedAt:ctx.at,startDate:first,transitionDate:ctx.today,highWaterDate:ctx.today,revision:1,schedule:[{revision:1,from:first,at:ctx.at,default:defaultConfig(),weekly:{},dates:{}}],bases:{},changes:[],recordRoles:{},transitionLegacy:legacy};
  state.evaluation=e;
  if(ctx.today>=state.plan.startDate&&ctx.today<=state.plan.endDate)e.bases[ctx.today]=snapshot(state,ctx.today,defaultConfig(),'upgrade',1,ctx.at,e.timezone);
  dates([first,state.plan.startDate].sort().pop(),state.plan.endDate).forEach(d=>{e.bases[d]=snapshot(state,d,defaultConfig(),'default',1,ctx.at,e.timezone);});return state;
 }
 function differences(a,b,path=''){
  if(a!==undefined&&b!==undefined&&same(a,b))return [];
  if(a&&b&&!Array.isArray(a)&&!Array.isArray(b)&&typeof a==='object'&&typeof b==='object')return [...new Set(Object.keys(a).concat(Object.keys(b)))].sort().flatMap(k=>differences(a[k],b[k],path?path+'.'+k:k));
  return [{path,before:a===undefined?null:copy(a),after:b===undefined?null:copy(b)}];
 }
 function planShape(s){const p=s.plan;return Object.fromEntries(['startDate','endDate','subjects','targets','wordTargets','quantityTargets','quantityUnits'].filter(k=>has(p,k)).map(k=>[k,p[k]]));}
 function refreshFuture(state,ctx,from){const e=state.evaluation,cut=[ctx.today,e.highWaterDate].sort().pop();Object.keys(e.bases).forEach(d=>{if(d>cut&&(d<state.plan.startDate||d>state.plan.endDate))delete e.bases[d];});dates([shift(cut,1),state.plan.startDate,from||e.startDate].sort().pop(),state.plan.endDate).forEach(d=>{const r=resolve(e,d);e.bases[d]=snapshot(state,d,r.config,r.source,e.revision,ctx.at,e.timezone);});}
 function reconcile(previous,next,ctx){
  if(!previous.evaluation){initialize(next,ctx);return next;}const e=copy(previous.evaluation);next.evaluation=e;ctx=ctx||context(e.timezone);e.highWaterDate=[e.highWaterDate,ctx.today].sort().pop();
  const edit=differences(planShape(previous),planShape(next));if(edit.length){e.revision++;e.changes.push({revision:e.revision,at:ctx.at,type:'plan',date:ctx.today,edits:edit});refreshFuture(next,ctx);}
  [...new Set(Object.keys(previous.records).concat(Object.keys(next.records)))].sort().forEach(d=>{
   const edits=differences(previous.records[d],next.records[d]);if(!edits.length)return;e.revision++;e.changes.push({revision:e.revision,at:ctx.at,type:'actual',date:d,edits});
   const saved=e.recordRoles[d]||(e.recordRoles[d]={}),b=e.bases[d];if(b)for(const src of b.activity)if(!has(saved,src.subjectId+':'+src.field))saved[src.subjectId+':'+src.field]=src.role;
  });return next;
 }
 function scheduleChange(state,command,ctx){
  const out=copy(state),e=out.evaluation;if(!e)fail('评估尚未初始化');ctx=ctx||context(e.timezone);const cut=[ctx.today,e.highWaterDate].sort().pop();day(command.from);if(command.from<=cut||command.from<out.plan.startDate||command.from>out.plan.endDate)fail('日程请从明天起设置');
  const ids=new Set(out.plan.subjects.map(s=>s.id));validateConfig(command.config,ids);if(!['default','weekly','date'].includes(command.scope))fail('日程范围无效');
  if(command.scope==='weekly'&&(!Number.isInteger(command.weekday)||command.weekday<0||command.weekday>6))fail('星期无效');
  if(command.scope==='date'){day(command.date);if(command.date<command.from||command.date>out.plan.endDate)fail('指定日期不在生效范围内');}
  const before=copy(e.schedule),selected=before.filter(v=>v.from<=command.from).slice(-1)[0]||before[0],prev=copy(selected),key=command.scope==='weekly'?String(command.weekday):command.date;
  const get=v=>command.scope==='default'?v.default:v[command.scope==='weekly'?'weekly':'dates'][key];
  const put=v=>{if(command.scope==='default')v.default=copy(command.config);else v[command.scope==='weekly'?'weekly':'dates'][key]=copy(command.config);v.revision=e.revision;v.at=ctx.at;};
  e.revision++;prev.from=command.from;put(prev);let last=selected,propagate=true;
  const later=before.filter(v=>v.from>command.from).map(v=>{const n=copy(v);if(propagate&&canonical(get(v)??null)===canonical(get(last)??null))put(n);else propagate=false;last=v;return n;});
  e.schedule=before.filter(v=>v.from<command.from).concat(prev,later);e.highWaterDate=cut;e.changes.push({revision:e.revision,at:ctx.at,type:'schedule',date:command.from,edits:differences(before,e.schedule,'schedule')});refreshFuture(out,ctx,command.from);return out;
 }
 function measureResult(item,record){
  let actual=0,known=0,missing=0,badUnit=false;for(const s of item.sources){const entry=record&&record.subjects&&record.subjects[s.subjectId],value=entry&&entry[s.field];if(value===null||value===undefined){if(s.requiredInput)missing++;continue;}actual+=value;known++;if(s.unit&&entry.quantityUnit!==s.unit)badUnit=true;}
  const r={...copy(item),actual:known?actual:null,known,missing,kind:'range',level:'reference',label:'仅作参考',achieved:null};
  if(!Number.isFinite(item.min)||!Number.isFinite(item.max)||item.min<0||item.max<item.min||item.required&&!item.sources.length){r.kind='pending';r.level='invalid';r.label='依据需核对';return r;}
  if(badUnit){r.kind='pending';r.level='unit';r.label='单位不同';return r;}
  if(missing||!known){r.kind=known?'partial':'empty';r.level=r.kind;r.label=known?'待补全':'未记录';return r;}
  if(item.min===0){r.label=actual>0?'额外投入':'已记录 0';return r;}
  const t=Math.round(actual*1000000),l=Math.round(item.min*1000000),u=Math.round(item.max*1000000);r.achieved=t>=l;
  if(t===0){r.achieved=false;r.kind='below';r.level='zero';r.label='未投入';}
  else if(t<l){r.kind='below';r.level='partialGoal';r.label='部分完成';}
  else if(t>u){r.kind='above';r.level='excess';r.label=item.measure==='time'?'时长超额':'数量超额';}
  else if(l===u||item.measure!=='time'){r.kind='within';r.level='exact';r.label='达标';}
  else{r.kind='within';r.level=3*(t-l)<u-l?'basic':3*(t-l)<2*(u-l)?'standard':'full';r.label={basic:'基础达标',standard:'标准达标',full:'充分达标'}[r.level];}return r;
 }
 function evaluateDay(basis,record,recordRevision,phase,activityContext){
  const items=basis.items.map(i=>{const r=measureResult(i,record);if(activityContext&&activityContext.timeConflicts&&i.sources.some(s=>s.field==='minutes'&&activityContext.timeConflicts.some(c=>c.subjectId===s.subjectId)))Object.assign(r,{kind:'pending',level:'sources',label:'时长与计时明细需核对',achieved:null});if(basis.dayType==='rest')Object.assign(r,{required:false,achieved:null,kind:'range',level:'reference',label:r.actual===null?'未记录':r.actual>0?'自主学习':'已记录 0'});return r;}),required=items.filter(i=>i.required),invalid=required.some(i=>i.kind==='pending'),complete=required.length>0&&required.every(i=>!['empty','partial','pending'].includes(i.kind)),achieved=complete&&required.every(i=>i.achieved===true),any=items.some(i=>i.actual!==null);
  const kind=basis.dayType==='conflict'||invalid?'pending':basis.dayType==='rest'?'rest':!required.length?'range':required.every(i=>i.kind==='empty')&&!any?'empty':!complete?'partial':achieved?'within':'below';
  const label=kind==='pending'?'需核对':kind==='rest'?'计划休息':kind==='range'?'未安排必达目标':kind==='empty'?'未记录':kind==='partial'?'待补全':achieved?(basis.dayType==='review'?'回顾日达标':'全部必达目标已完成'):required.some(i=>i.actual>0)?'部分目标完成':'必达目标未完成';
  const stateLabel=invalid?'需核对':!required.length?(any?'已记录':'未记录'):complete?'记录完整':any?'待补全':'未记录';let review=false,other=false,unknown=false;
  const savedRoles=activityContext&&activityContext.roles||{};
  for(const src of basis.activity){const entry=record&&record.subjects&&record.subjects[src.subjectId],value=entry&&entry[src.field];if(value==null||value<=0)continue;const r=savedRoles[src.subjectId+':'+src.field]||src.role;if(r==='review')review=true;else if(r==='study')other=true;else unknown=true;}
  const explained=new Set(basis.activity.map(s=>s.subjectId+':'+s.field));for(const [id,entry]of Object.entries(record&&record.subjects||{}))for(const field of fields)if(entry[field]>0&&!explained.has(id+':'+field))unknown=true;
  if(activityContext&&activityContext.reviewEvents>0)review=true;
  const activity=review?(other?'回顾与其他学习':unknown||!complete?'已记录回顾':'仅回顾'):other?(unknown?'活动类型待补全':'已记录学习'):unknown?'活动类型待补全':'类型未明确';
  return {rule:2,date:basis.date,phase,dayType:basis.dayType,kind,label,recordState:stateLabel,complete,achieved,required:required.length,recorded:required.filter(i=>!['empty','partial','pending'].includes(i.kind)).length,achievedItems:required.filter(i=>i.achieved===true).length,activity,recordRevision,items};
 }
 function sessionIndex(state){const seen=new Set(),totals={};for(const session of (state.sessions||[]).concat(...Object.values(state.records).map(r=>r.sessions||[]))){if(seen.has(session.id))continue;seen.add(session.id);const day=totals[session.date]||(totals[session.date]={});day[session.subjectId]=(day[session.subjectId]||0)+session.seconds;}return totals;}
 function timerTotals(state,d,index){return (index||sessionIndex(state))[d]||{};}
 function timeConflicts(state,d,index){const record=state.records[d];if(!record)return [];const totals=timerTotals(state,d,index),out=[];for(const [id,seconds]of Object.entries(totals)){const entry=record.subjects[id],actual=entry&&entry.minutes,correction=record.timeCorrections&&record.timeCorrections[id];if(correction&&correction.timerSeconds<=seconds+0.001){if(actual==null&&correction.minutes===null&&Math.abs(seconds-correction.timerSeconds)<0.001)continue;const expected=(correction.minutes||0)+(seconds-correction.timerSeconds)/60;if(actual!=null&&actual+1/60>=expected)continue;}else if(actual!=null&&actual+1/60>=seconds/60)continue;out.push({subjectId:id,minutes:actual??null,timerSeconds:seconds});}return out;}
 function covers(state,d){return !!(state.evaluation&&(d>=state.evaluation.startDate||d===state.evaluation.transitionDate));}
 function assess(state,d,today,index){const e=state.evaluation,b=e&&e.bases[d];if(!b){if(covers(state,d)&&d>=state.plan.startDate&&d<=state.plan.endDate)return {rule:2,date:d,phase:'unknown',dayType:'conflict',kind:'pending',label:'评估依据缺失',recordState:'需核对',complete:false,achieved:false,required:0,recorded:0,achievedItems:0,activity:'类型未明确',recordRevision:state._revision||0,items:[]};return null;}today=[today||context(e.timezone).today,e.highWaterDate].sort().pop();const phase=d===e.transitionDate?'transition':d<today?'closed':d===today?'current':'future',events=(state.courseReviews&&state.courseReviews[d]||[]).filter(r=>r.done).length;return evaluateDay(b,state.records[d],state._revision||0,phase,{roles:e.recordRoles[d]||{},reviewEvents:events,timeConflicts:timeConflicts(state,d,index)});}
 function statistics(state,from,to,today){
  const e=state.evaluation;if(!e)return null;day(from);day(to);day(today);today=[today,e.highWaterDate].sort().pop();const result={D:0,C:0,P:0,rest:0,unplanned:0,unrecorded:0,partial:0,pending:0,basisMissing:0,study:{D:0,C:0,P:0},review:{D:0,C:0,P:0}};
  const index=sessionIndex(state),all=new Set(Object.keys(e.bases));dates([e.startDate,state.plan.startDate,from].sort().pop(),[state.plan.endDate,to,shift(today,-1)].sort()[0]).forEach(d=>all.add(d));
  [...all].sort().forEach(d=>{if(d<e.startDate||d<from||d>to||d>=today)return;const b=e.bases[d];if(!b){result.basisMissing++;return;}if(b.dayType==='rest'){result.rest++;return;}if(b.dayType==='unplanned'){result.unplanned++;return;}const r=assess(state,d,today,index);result.D++;const group=result[b.dayType];if(group)group.D++;if(r.complete){result.C++;if(group)group.C++;}if(r.achieved){result.P++;if(group)group.P++;}if(r.kind==='empty')result.unrecorded++;else if(r.kind==='partial')result.partial++;else if(r.kind==='pending')result.pending++;});
  result.rate=result.D?Math.round(result.P*1000/result.D)/10:null;result.coverage=result.D?Math.round(result.C*1000/result.D)/10:null;result.conditional=result.C?Math.round(result.P*1000/result.C)/10:null;return result;
 }
 function validate(state){
  const e=state.evaluation;if(!e)return;exact(e,['version','timezone','activatedAt','startDate','transitionDate','highWaterDate','revision','schedule','bases','changes','recordRoles','transitionLegacy']);if(e.version!==1)fail('自动评估版本无效');timezone(e.timezone);at(e.activatedAt);day(e.startDate);day(e.transitionDate);day(e.highWaterDate);if(e.startDate!==shift(e.transitionDate,1)||e.highWaterDate<e.transitionDate)fail('自动评估生效日期无效');finite(e.revision,Number.MAX_SAFE_INTEGER);if(!Number.isInteger(e.revision)||e.revision<1)fail('评估修订号无效');if(e.transitionLegacy!==null){exact(e.transitionLegacy,['record','basis']);object(e.transitionLegacy.record);if(e.transitionLegacy.basis!==null)object(e.transitionLegacy.basis);}
  const ids=new Set(state.plan.subjects.map(s=>s.id));if(!Array.isArray(e.schedule)||!e.schedule.length||e.schedule.length>500)fail('日程修订数量无效');let last='';e.schedule.forEach(v=>{exact(v,['revision','from','at','default','weekly','dates']);day(v.from);at(v.at);if(v.from<=last||context(e.timezone,v.at).today>=v.from)fail('日程版本顺序无效');last=v.from;finite(v.revision,e.revision);validateConfig(v.default,ids);object(v.weekly);Object.entries(v.weekly).forEach(([k,c])=>{if(!/^[0-6]$/.test(k))fail('日程星期无效');validateConfig(c,ids);});object(v.dates);Object.entries(v.dates).forEach(([d,c])=>{day(d);validateConfig(c,ids);});});
  object(e.bases);if(Object.keys(e.bases).length>100000)fail('评估依据日期过多');Object.entries(e.bases).forEach(([d,b])=>{day(d);exact(b,['rule','date','timezone','capturedAt','revision','source','dayType','items','time','words','quantities','activity']);if(b.rule!==2||b.date!==d||b.timezone!==e.timezone||!['study','review','rest','unplanned','conflict'].includes(b.dayType))fail('自动评估依据无效');at(b.capturedAt);if(d!==e.transitionDate&&context(e.timezone,b.capturedAt).today>=d)fail('依据必须在当天开始前确定');finite(b.revision,e.revision);if(typeof b.source!=='string'||b.source.length>100)fail('评估来源无效');if(!Array.isArray(b.items)||b.items.length>100)fail('评估项目无效');const seen=new Set();
   function source(s){exact(s,['subjectId','field','role','requiredInput','unit']);if(!ids.has(s.subjectId)||!fields.includes(s.field)||!roles.includes(s.role)||typeof s.requiredInput!=='boolean'||s.unit!==null&&(typeof s.unit!=='string'||!s.unit.trim()||s.unit.length>32))fail('评估来源字段无效');}
   b.items.forEach(i=>{exact(i,['id','name','measure','unit','min','max','required','role','sources']);if(typeof i.id!=='string'||i.id.length>100||seen.has(i.id)||typeof i.name!=='string'||!i.name.trim()||i.name.length>140||!['time','quantity'].includes(i.measure)||typeof i.unit!=='string'||!i.unit.trim()||i.unit.length>32||!['study','review','unknown'].includes(i.role)||typeof i.required!=='boolean')fail('评估项目字段无效');seen.add(i.id);validRange({min:i.min,max:i.max},i.measure==='time'?34560:100000);if(i.measure==='quantity'&&(!Number.isInteger(i.min)||i.min!==i.max))fail('数量评估目标无效');if(!Array.isArray(i.sources)||i.sources.length>24)fail('评估来源过多');const sourceKeys=new Set();i.sources.forEach(v=>{source(v);const key=v.subjectId+':'+v.field;if(sourceKeys.has(key))fail('评估来源重复');sourceKeys.add(key);if(i.measure==='time'&&v.field!=='minutes'||i.measure==='quantity'&&v.field==='minutes')fail('评估计量方式不同');});});
   const required=b.items.filter(i=>i.required);if(required.some(i=>i.min<=0)||['rest','unplanned'].includes(b.dayType)&&required.length||b.dayType==='review'&&(!required.length||required.some(i=>i.role!=='review'))||b.dayType==='study'&&(!required.length||required.every(i=>i.role==='review')))fail('计划日类型与必达目标冲突');
   for(const key of ['time','words','quantities','activity'])if(!Array.isArray(b[key])||b[key].length>48)fail('依据科目无效');const activities=new Set();b.activity.forEach(v=>{source(v);const key=v.subjectId+':'+v.field;if(activities.has(key))fail('活动来源重复');activities.add(key);});if(!b.items.some(i=>i.id==='total-time'))fail('总时长依据缺失');
   b.time.forEach(s=>{exact(s,['id','name','kind','reference','role']);if(!ids.has(s.id)||!['math','custom'].includes(s.kind)||!roles.includes(s.role)||typeof s.name!=='string'||!s.name.trim()||s.name.length>128)fail('时长依据无效');validRange(s.reference,1440);});
   b.words.forEach(s=>{exact(s,['id','name','goal','reviewGoal']);if(!ids.has(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>128)fail('单词依据无效');finite(s.goal);finite(s.reviewGoal);if(!Number.isInteger(s.goal)||!Number.isInteger(s.reviewGoal))fail('单词目标须为整数');});
   b.quantities.forEach(s=>{exact(s,['id','name','goal','unit']);if(!ids.has(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>128||typeof s.unit!=='string'||!s.unit.trim()||s.unit.length>32)fail('数量依据无效');finite(s.goal);if(!Number.isInteger(s.goal))fail('数量目标须为整数');});
  });
  if(!Array.isArray(e.changes)||e.changes.length>10000)fail('评估修订过多');e.changes.forEach(c=>{exact(c,['revision','at','type','date','edits']);at(c.at);day(c.date);finite(c.revision,e.revision);if(!['plan','actual','schedule'].includes(c.type)||!Array.isArray(c.edits)||c.edits.length>100000)fail('评估修订无效');c.edits.forEach(v=>{exact(v,['path','before','after']);if(typeof v.path!=='string'||v.path.length>1000||v.path.split('.').some(k=>['__proto__','constructor','prototype'].includes(k)))fail('修订字段无效');});});object(e.recordRoles);Object.entries(e.recordRoles).forEach(([d,m])=>{day(d);object(m);for(const [k,r]of Object.entries(m)){const at=k.lastIndexOf(':');if(!ids.has(k.slice(0,at))||!fields.includes(k.slice(at+1))||!roles.includes(r))fail('记录活动角色无效');}});
 }
 function fixedBasis(state,d){const b=state.evaluation&&state.evaluation.bases[d];if(!b)return null;return {rule:2,source:'fixed',capturedAt:b.capturedAt,inside:true,time:b.time.map(({id,name,kind,reference})=>({id,name,kind,reference:copy(reference)})),words:b.words.map(({id,name,goal})=>({id,name,goal})),quantities:copy(b.quantities)};}
 function adapter(state,d,today){
  const r=assess(state,d,today);if(!r)return null;const b=state.evaluation.bases[d];if(!b)return {time:{kind:'pending',label:'评估依据缺失',actual:null,min:0,max:0,missing:0,count:0,scope:'总时长',status:null},words:[],quantities:[],basis:{saved:false,source:'fixed',capturedAt:null,rule:2},automatic:r};const row=r.items.find(i=>i.id==='total-time'),kind=r.dayType==='rest'?'rest':row.kind;
  const time={kind,label:kind==='rest'?'计划休息':row.label,actual:row.actual,min:row.min,max:row.max,missing:row.missing,count:b.time.filter(s=>s.reference.max>0).length,scope:row.name,status:null,level:row.level};if(kind==='above')time.excess=row.actual-row.max;if(kind==='below')time.shortfall=row.min-row.actual;
  const entries=state.records[d]&&state.records[d].subjects||{},words=b.words.map(s=>{const item=r.items.find(i=>i.id==='new:'+s.id),review=r.items.find(i=>i.id==='review:'+s.id),e=entries[s.id];return {id:s.id,name:s.name,goal:s.goal,newWords:e&&e.newWords!=null?e.newWords:null,reviewWords:e&&e.reviewWords!=null?e.reviewWords:null,kind:r.dayType==='rest'?'rest':item.kind,label:r.dayType==='rest'?'计划休息':item.label,reviewAssessment:review};});
  const quantities=b.quantities.map(s=>{const item=r.items.find(i=>i.id==='quantity:'+s.id),e=entries[s.id];return {id:s.id,name:s.name,unit:s.unit,actualUnit:e&&e.quantityUnit||s.unit,goal:s.goal,quantity:e&&e.quantity!=null?e.quantity:null,kind:r.dayType==='rest'?'rest':item.kind==='pending'&&item.level==='unit'?'unit':item.kind,label:r.dayType==='rest'?'计划休息':item.label};});
  return {time,words,quantities,basis:{saved:true,source:'fixed',capturedAt:b.capturedAt,rule:2},automatic:r};
 }
 return Object.freeze({sessionIndex,timerTotals,timeConflicts,context,shift,dates,defaultConfig,validateConfig,initialize,reconcile,scheduleChange,snapshot,resolve,evaluateDay,measureResult,assess,statistics,covers,validate,canonical,fixedBasis,adapter});
});
