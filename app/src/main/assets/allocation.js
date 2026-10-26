(function(root,factory){
  'use strict';const api=factory(root.StudyModel||(typeof require==='function'?require('./model.js'):null),root.StudyReference||(typeof require==='function'?require('./reference.js'):null));
  if(typeof module==='object'&&module.exports)module.exports=api;root.StudyAllocation=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(M,R){
  'use strict';
  const copy=v=>JSON.parse(JSON.stringify(v)),has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const weekday=d=>(new Date(d+'T00:00:00Z').getUTCDay()+6)%7;
  const same=(a,b)=>{const x=R.range(a),y=R.range(b);return x.min===y.min&&x.max===y.max;};
  function template(state){return Object.fromEntries(state.plan.subjects.map(s=>[s.id,s.kind==='vocab'?{goal:s.wordGoal??50}:{defaults:copy(s.defaults)}]));}
  function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01'||value>'2100-12-31'||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw new Error('生效日期无效');}
  function amount(n){if(!Number.isInteger(n)||n<0||n>100000)throw new Error('数量目标须为0至100000的整数');}
  function apply(state,request,now=M.today(),at=new Date().toISOString()){
    M.validateState(state);validDate(now);validDate(request.from);
    if(request.from<now||request.from<state.plan.startDate||request.from>state.plan.endDate)throw new Error('生效日期须在今天起的计划范围内');
    if(typeof request.replaceDaily!=='boolean'||typeof request.reassess!=='boolean'||!request.values||Array.isArray(request.values)||typeof request.values!=='object')throw new Error('总体分配格式无效');
    const subjects=state.plan.subjects,known=new Set(subjects.map(s=>s.id));
    if(Object.keys(request.values).some(id=>!known.has(id)))throw new Error('总体分配含未知科目');
    const changes=[];
    subjects.forEach(s=>{
      if(!has(request.values,s.id))return;const v=request.values[s.id];
      if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('科目分配格式无效');
      if(s.kind==='vocab'){
        if(Object.keys(v).join()!=='goal')throw new Error('单词分配格式无效');amount(v.goal);
        if(v.goal!==(s.wordGoal??50))changes.push({id:s.id,name:s.name,kind:'words',before:s.wordGoal??50,after:v.goal});
      }else{
        if(Object.keys(v).join()!=='defaults'||!Array.isArray(v.defaults)||v.defaults.length!==7)throw new Error('请填写周一至周日的目标');
        const quantity=s.measure==='quantity';v.defaults.forEach(n=>quantity?amount(n):R.validate(n,true));
        const days=v.defaults.map((n,i)=>quantity?n!==s.defaults[i]:!same(n,s.defaults[i]));
        if(days.some(Boolean))changes.push({id:s.id,name:s.name,kind:quantity?'quantity':'time',unit:s.unit,days,before:copy(s.defaults),after:copy(v.defaults)});
      }
    });
    const next=copy(state),dates=Array.from(new Set([...M.dates(state.plan.startDate,state.plan.endDate),...Object.keys(state.records),...Object.keys(state.plan.targets),...Object.keys(state.plan.wordTargets||{}),...Object.keys(state.plan.quantityTargets||{})])).sort(),changedDates=new Set(),criteria=new Map();
    const report={from:request.from,to:state.plan.endDate,changes,targets:0,days:0,keptDaily:0,keptUnits:0,reassessed:0};
    if(!changes.length)return {state:next,report};
    R.preserve(state,next);
    function put(date,s,value){
      const key=s.kind==='vocab'?'wordTargets':s.measure==='quantity'?'quantityTargets':'targets';
      next.plan[key]=next.plan[key]||{};next.plan[key][date]=next.plan[key][date]||{};next.plan[key][date][s.id]=copy(value);
    }
    changes.forEach(change=>{
      const s=subjects.find(s=>s.id===change.id),dest=next.plan.subjects.find(s=>s.id===change.id);
      dates.forEach(date=>{
        const w=weekday(date),value=s.kind==='vocab'?M.wordTarget(state,date,s.id):s.measure==='quantity'?M.quantityTarget(state,date,s.id):M.reference(state,date,s.id);
        // Freeze fallbacks before changing defaults, including unrecorded history.
        put(date,s,value);
        if(date<request.from||date>state.plan.endDate||!M.subjectActive(s,date)||change.days&&!change.days[w])return;
        const marked=(state.plan.manualReferences?.[date]||[]).includes(s.id);
        const custom=s.kind==='vocab'?value!==(s.wordGoal??50):s.measure==='quantity'?value!==s.defaults[w]:marked;
        if(custom&&!request.replaceDaily){report.keptDaily++;return;}
        if(s.measure==='quantity'&&M.quantityUnit(state,date,s.id)!==s.unit){report.keptUnits++;return;}
        const target=s.kind==='vocab'?change.after:change.after[w];
        const differs=s.kind==='vocab'||s.measure==='quantity'?value!==target:!same(value,target);
        if(differs){put(date,s,target);report.targets++;changedDates.add(date);}
        if(change.kind==='time'&&request.replaceDaily&&next.plan.manualReferences?.[date]){
          next.plan.manualReferences[date]=next.plan.manualReferences[date].filter(id=>id!==s.id);if(!next.plan.manualReferences[date].length)delete next.plan.manualReferences[date];
        }
        if(request.reassess&&has(state.records,date)){if(!criteria.has(date))criteria.set(date,[]);criteria.get(date).push(s.id);}
      });
      if(s.kind==='vocab')dest.wordGoal=change.after;
      else{
        dest.defaults=copy(change.after);
        if(change.kind==='time'){next.version=Math.max(next.version,8);next.plan.manualReferenceDefaults=Array.from(new Set([...(next.plan.manualReferenceDefaults||[]),s.id]));}
      }
    });
    criteria.forEach((ids,date)=>{
      const basis=next.assessmentBases[date],fresh=R.capture(next,date);let changed=false;
      ['time','words','quantities'].forEach(key=>{
        (fresh[key]||[]).filter(item=>ids.includes(item.id)).forEach(item=>{
          const entries=basis[key]||(basis[key]=[]),index=entries.findIndex(old=>old.id===item.id);
          if(index<0){entries.push(item);changed=true;}else if(JSON.stringify(entries[index])!==JSON.stringify(item)){entries[index]=item;changed=true;}
        });
      });
      if(changed){basis.inside=true;basis.source='recalculated';basis.capturedAt=at;report.reassessed++;}
    });
    report.days=changedDates.size;M.validateState(next);return {state:next,report};
  }
  return Object.freeze({template,apply});
});
