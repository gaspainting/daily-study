'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const C=require('../app/src/main/assets/bridge-contract.js');
const R=require('../app/src/main/assets/reference.js');
const M=require('../app/src/main/assets/model.js');
const S=require('../app/src/main/assets/schedule.js');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/rule-contract-cases.json'),'utf8'));

function captureState(sample){
 const date=sample.date;
 return {version:9,records:{},plan:{startDate:date,endDate:date,subjects:sample.subjects,targets:{[date]:sample.targets},wordTargets:{[date]:sample.wordTargets},quantityTargets:{[date]:sample.quantityTargets}}};
}

test('bridge contract validates request types and canonical request identity',()=>{
 for(const item of fixture.bridgeCases){
  const request=C.request(item.operation,item.planId,item.expectedRevision,item.payload,item.name+'-request');
  assert.equal(request.contractVersion,1);
  assert.equal(C.parse(JSON.stringify(request)).requestId,request.requestId);
 }
 const ordered=C.request('state.save','main',3,{a:1,b:{x:2,y:3}},'same-id');
 const reordered=C.request('state.save','main',3,{b:{y:3,x:2},a:1},'same-id');
 assert.equal(C.fingerprint(ordered),C.fingerprint(reordered));
 for(const version of [1.5,'1',true])assert.throws(()=>C.parse(JSON.stringify({...ordered,contractVersion:version})),/桥接版本不兼容/);
 assert.throws(()=>C.parse(JSON.stringify({...ordered,requestId:7})),/请求标识无效/);
 assert.throws(()=>C.request('unknown','main',0,{}),/桥接操作无效/);
 assert.throws(()=>C.request('state.save','main',1.5,{}),/修订号无效/);
});

test('bridge contract accepts only a matching canonical save result',()=>{
 const bridge={dispatch(raw){const req=JSON.parse(raw),state={version:9,_revision:req.expectedRevision+1};return JSON.stringify({contractVersion:1,requestId:req.requestId,operation:req.operation,planId:req.planId,accepted:true,revision:state._revision,state});},getState(){return JSON.stringify({_revision:0});}};
 const result=C.invoke(bridge,'state.save','main',7,{_revision:7},'stable-request');
 assert.equal(result.revision,8);assert.equal(result.state.version,9);
 const mismatched={dispatch(raw){const req=JSON.parse(raw);return JSON.stringify({contractVersion:1,requestId:req.requestId+'-other',operation:req.operation,planId:req.planId,accepted:true,revision:req.expectedRevision+1,state:{_revision:req.expectedRevision+1}});}};
 assert.throws(()=>C.invoke(mismatched,'state.save','main',7,{_revision:7},'mismatch-request'),/桥接响应与请求不匹配/);
 const unconfirmed={dispatch(){throw new Error('bridge disconnected');},getState(){return JSON.stringify({_revision:8});}};
 assert.throws(()=>C.invoke(unconfirmed,'state.save','main',7,{_revision:7},'unconfirmed-request'),/保存结果待确认/);
 const invalid={dispatch(raw){const req=JSON.parse(raw);return JSON.stringify({contractVersion:1,requestId:req.requestId,operation:req.operation,planId:req.planId,accepted:true,revision:8});}};
 assert.throws(()=>C.invoke(invalid,'state.save','main',7,{_revision:7},'missing-state'),/桥接状态格式无效/);
});

test('shared reference and record cases match JavaScript rule outputs',()=>{
 for(const item of fixture.referenceCases){
  R.validate(item.value,true);const range=R.range(item.value);
  assert.deepEqual({min:range.min,max:range.max,midpoint:R.midpoint(item.value),text:R.text(item.value)},{min:item.min,max:item.max,midpoint:item.midpoint,text:item.text},item.name);
 }
 const sample=fixture.captureCase,state=captureState(sample),basis=R.capture(state,sample.date,'record','2026-10-27T12:00:00.000Z');
 const normalized={
  time:basis.time.map(entry=>{const range=R.range(entry.reference);return {id:entry.id,kind:entry.kind,min:range.min,max:range.max};}),
  words:basis.words.map(entry=>({id:entry.id,goal:entry.goal})),
  quantities:basis.quantities.map(entry=>({id:entry.id,goal:entry.goal,unit:entry.unit}))
 };
 assert.deepEqual(normalized,sample.expected);
 const record=M.record(state,sample.date);
 for(const item of fixture.unitCases){assert.ok(Object.hasOwn(record.subjects[item.id],item.field),item.field);if(item.measure==='quantity')assert.equal(record.subjects[item.id].quantityUnit,item.unit);}
 for(const item of fixture.recordCases){
  const sampleState=captureState(sample),record=M.record(sampleState,sample.date);record.status='正常参考';record.subjects.math.minutes=item.value;sampleState.records[sample.date]=record;
  const time=R.assess(sampleState,sample.date).time;
  assert.deepEqual({kind:time.kind,actual:time.actual,missing:time.missing},{kind:item.kind,actual:item.actual,missing:item.missing},item.name);
 }
});

test('shared course schedule samples return the same daily rules and migration stays non-destructive',()=>{
 for(const item of fixture.courseCases){
  const row=S.day(item.date),review=R.range(row.reviewRange),math=R.range(row.mathRange);
  assert.deepEqual({weekday:row.weekday,courses:row.courses,reviewMin:review.min,reviewMax:review.max,mathMin:math.min,mathMax:math.max},{weekday:item.weekday,courses:item.courses,reviewMin:item.reviewMin,reviewMax:item.reviewMax,mathMin:item.mathMin,mathMax:item.mathMax},item.date);
 }
 const migration=fixture.migrationCases[0],legacy=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures',migration.fixture),'utf8'));
 const before=structuredClone(legacy),migrated=M.migrateState(structuredClone(legacy),'2026-10-27');
 assert.equal(migrated.version,migration.expectedSchema);assert.deepEqual(migrated.records,before.records);assert.deepEqual(legacy,before);
 assert.equal(fixture.wordLogFixture,'word-log-cases.json');
});
