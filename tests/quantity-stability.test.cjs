'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../app/src/main/assets/model.js'),R=require('../app/src/main/assets/reference.js'),T=require('../app/src/main/assets/tracking.js');
const seed=require('../app/src/main/assets/seed.json'),day='2026-10-21';
function fixture(){const s=M.migrateState(structuredClone(seed),'2026-10-15'),q=M.addSubject(s,'练习',[10,10,10,10,10,10,10],s.plan.startDate,'quantity','题');return {s,q};}
function write(s,q,date,count,unit='题'){const r=M.record(s,date);r.status='正常参考';r.subjects[q.id].quantity=count;r.subjects[q.id].quantityUnit=unit;M.saveRecord(s,date,r);}
test('quantity-only positive records are complete, explicit zero is zero, and blank is unknown',()=>{
 const {s,q}=fixture();for(const item of s.plan.subjects.filter(x=>x.id!==q.id))M.archiveSubject(s,item.id,day);
 write(s,q,day,12);assert.equal(M.recordSummary(s,day).kind,'complete');write(s,q,'2026-10-22',0);assert.equal(M.recordSummary(s,'2026-10-22').kind,'zero');assert.equal(M.recordSummary(s,'2026-10-23').kind,'empty');
});
test('history subject filtering uses that subject zero and complete state instead of unrelated missing or positive subjects',()=>{
 const {s,q}=fixture();write(s,q,day,0);write(s,q,'2026-10-22',12);
 assert.deepEqual(M.historySearch(s,{subjectId:q.id,kind:'zero'}).map(x=>x.date),[day]);assert.deepEqual(M.historySearch(s,{subjectId:q.id,kind:'complete'}).map(x=>x.date),['2026-10-22']);
 assert.equal(M.historySearch(s,{subjectId:q.id,keyword:'12 题'}).length,1);assert.equal(M.historySearch(s,{subjectId:q.id,keyword:'高数'}).length,0);
});
test('unit changes freeze historical goal units and preserve actual units when editing historical counts',()=>{
 const {s,q}=fixture();write(s,q,day,12);const actual=structuredClone(s.records);
 M.updateSubject(s,q.id,q.name,[10,10,10,10,10,10,10],'quantity','组');
 assert.deepEqual(s.records,actual);assert.equal(M.quantityUnit(s,day,q.id),'题');assert.equal(M.quantityUnit(s,'2026-10-20',q.id),'题');assert.equal(M.record(s,day).subjects[q.id].quantityUnit,'题');
 const E=require('../app/src/main/assets/evaluation.js'),now=E.context(s.evaluation.timezone).today,next=E.shift(now,1);if(now<=s.plan.endDate)assert.equal(M.quantityUnit(s,now,q.id),'题');if(next<=s.plan.endDate)assert.equal(M.quantityUnit(s,next,q.id),'组');
 assert.equal(M.validateState(s),true);assert.deepEqual(M.migrateState(JSON.parse(JSON.stringify(s))),s);
});
test('week and month statistics group different units without adding twelve questions to three sets',()=>{
 const {s,q}=fixture();write(s,q,day,12);M.updateSubject(s,q.id,q.name,[10,10,10,10,10,10,10],'quantity','组');
 s.plan.quantityUnits['2026-10-22'][q.id]='组';write(s,q,'2026-10-22',3,'组');
 for(const stats of [M.weekStats(s,day),M.monthStats(s,'2026-10')]){const result=stats.subjects.find(x=>x.id===q.id);assert.equal(result.actual,null);const groups=result.quantityGroups;assert.equal(groups.find(x=>x.unit==='题').actual,12);assert.equal(groups.find(x=>x.unit==='组').actual,3);assert.equal(groups.find(x=>x.unit==='题').recordedDays,1);}
 const html=T.renderQuantityStats(s,M.weekStats(s,day).days);assert.match(html,/12 题/);assert.match(html,/3 组/);assert.doesNotMatch(html,/15 组|15 题/);
});
test('quantity assessment never grades counts against a target with a different unit and outside/review/rest remain independent',()=>{
 const {s,q}=fixture();write(s,q,day,12);s.records[day].subjects[q.id].quantityUnit='组';let result=R.assess(s,day).quantities[0];assert.equal(result.kind,'unit');assert.equal(result.actualUnit,'组');assert.equal(result.unit,'题');
 s.records[day].status='休息';assert.equal(R.assess(s,day).quantities[0].kind,'rest');s.records[day].status='仅回顾';assert.equal(R.assess(s,day).quantities[0].kind,'review');
 s.records[day].status='减量';s.plan.endDate='2026-10-20';s.assessmentBases[day].inside=false;assert.equal(R.assess(s,day).quantities[0].kind,'outside');
});
test('quantity assessment history filters the selected quantity subject independently',()=>{
 const {s,q}=fixture(),second=M.addSubject(s,'阅读',[20,20,20,20,20,20,20],s.plan.startDate,'quantity','页');write(s,q,day,10);
 assert.equal(M.historySearch(s,{subjectId:q.id,assessmentDimension:'quantity',assessmentKind:'within'}).length,1);
 assert.equal(M.historySearch(s,{subjectId:second.id,assessmentDimension:'quantity',assessmentKind:'within'}).length,0);
});
test('goal-unit backup data rejects unknown/time subjects, malformed dates, blank units and older schemas',()=>{
 const {s,q}=fixture();s.plan.quantityUnits={[day]:{[q.id]:'题'}};assert.equal(M.validateState(s),true);
 for(const map of [{[day]:{math:'题'}},{[day]:{bad:'题'}},{bad:{[q.id]:'题'}},{[day]:{[q.id]:''}},{[day]:{[q.id]:42}}]){const bad=structuredClone(s);bad.plan.quantityUnits=map;assert.throws(()=>M.validateState(bad));}
 const old=structuredClone(s);old.version=7;assert.throws(()=>M.validateState(old));
});
