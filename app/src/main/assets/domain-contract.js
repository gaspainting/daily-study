(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.StudyDomain=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const VERSION=1;
 function model(){if(!globalThis.StudyModel)throw new Error('记录规则模块未加载');return globalThis.StudyModel;}
 function reference(){if(!globalThis.StudyReference)throw new Error('参考规则模块未加载');return globalThis.StudyReference;}
 function evaluation(){return globalThis.StudyEvaluation||null;}
 function migrate(state){return model().migrateState(state);}
 function validate(state){return model().validateState(state);}
 function record(state,date){return model().record(state,date);}
 function saveRecord(state,date,value){return model().saveRecord(state,date,value);}
 function assess(state,date){const e=evaluation();if(e&&state.evaluation&&e.covers(state,date))return e.assess(state,date);return reference().assess(state,date);}
 function planSnapshot(state,date,planId){const m=model(),r=reference();if(typeof planId!=='string'||!planId.trim())throw new Error('计划标识缺失');return {version:VERSION,date,planId,record:m.record(state,date),reference:r.total(state,date),subjects:m.subjectsForDate(state,date).map(s=>{const words=s.kind==='vocab',quantity=m.isQuantity(s),measure=words?'words':quantity?'quantity':'time';return {id:s.id,name:s.name,kind:s.kind,measure,unit:words?'个':quantity?m.quantityUnit(state,date,s.id):'分钟',goal:words?m.wordTarget(state,date,s.id):quantity?m.quantityTarget(state,date,s.id):null,reference:!words&&!quantity?m.reference(state,date,s.id):null};})};}
 return Object.freeze({version:VERSION,migrate,validate,record,saveRecord,assess,planSnapshot});
});
