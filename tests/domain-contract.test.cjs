'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app/src/main/assets/domain-contract.js'),'utf8');
const realModel=require('../app/src/main/assets/model.js'),realEvaluation=require('../app/src/main/assets/evaluation.js'),realReference=require('../app/src/main/assets/reference.js'),realDomain=require('../app/src/main/assets/domain-contract.js');
test('domain contract exposes stable record and assessment entry points',()=>{
 const subjects=[{id:'math',name:'高数',kind:'math'},{id:'vocab',name:'单词',kind:'vocab'},{id:'question-review',name:'错题',kind:'custom',measure:'quantity',unit:'题'}];
 const model={migrateState:s=>s,validateState:s=>s,record:(s,d)=>({date:d}),saveRecord:(s,d,v)=>{s.saved=v;return v;},subjectsForDate:()=>subjects,subjectActive:()=>true,isQuantity:s=>s.measure==='quantity',quantityUnit:(s,d,id)=>id==='question-review'?'道':'',quantityTarget:()=>8,wordTarget:()=>40,reference:(s,d,id)=>id==='math'?{min:30,max:60}:25};
 const ref={assess:()=>({time:{kind:'empty'}}),total:()=>({min:0,max:0})};
 const context={StudyModel:model,StudyReference:ref};vm.runInNewContext(source,context);const D=context.StudyDomain,state={plan:{title:'测试'},records:{}};
 assert.equal(D.version,1);assert.equal(D.record(state,'2026-10-27').date,'2026-10-27');D.validate(state);assert.equal(D.assess(state,'2026-10-27').time.kind,'empty');
 const snapshot=D.planSnapshot(state,'2026-10-27','plan_main');assert.equal(snapshot.planId,'plan_main');assert.deepEqual(JSON.parse(JSON.stringify(snapshot.subjects)),[
  {id:'math',name:'高数',kind:'math',measure:'time',unit:'分钟',goal:null,reference:{min:30,max:60}},
  {id:'vocab',name:'单词',kind:'vocab',measure:'words',unit:'个',goal:40,reference:null},
  {id:'question-review',name:'错题',kind:'custom',measure:'quantity',unit:'道',goal:8,reference:null}
 ]);assert.throws(()=>D.planSnapshot(state,'2026-10-27'),/计划标识缺失/);
});

test('domain assessment entry preserves automatic and legacy rule outputs',()=>{
 const seed=JSON.parse(fs.readFileSync(path.join(__dirname,'../app/src/main/assets/seed.json'),'utf8'));
 const state=realModel.migrateState(seed,'2026-10-27'),date=realEvaluation.context(state.evaluation.timezone).today;
 assert.ok(realEvaluation.covers(state,date));
 assert.deepEqual(realDomain.assess(state,date),realEvaluation.assess(state,date));
 const legacy=structuredClone(state);delete legacy.evaluation;
 assert.deepEqual(realDomain.assess(legacy,date),realReference.assess(legacy,date));
});
