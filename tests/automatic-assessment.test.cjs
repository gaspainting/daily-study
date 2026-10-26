'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../app/src/main/assets/evaluation.js');
const fixtures=require('./fixtures/automatic-assessment-cases.json');
for(const c of fixtures)test(c.name,()=>{const before=structuredClone(c),r=E.evaluateDay(c.basis,c.record,c.recordRevision,c.phase);for(const[k,v]of Object.entries(c.expected))assert.deepEqual(k==='timeLevel'?r.items.find(i=>i.id==='total-time').level:r[k],v,k);assert.deepEqual(c,before);});
function profile(){const c=structuredClone(fixtures[0]);const subjects=[{id:'math',name:'高数',kind:'math',defaults:Array(7).fill({min:60,max:120})},{id:'vocab',name:'单词',kind:'vocab',wordGoal:0,defaults:Array(7).fill(0)}];return {version:9,plan:{startDate:'2026-10-26',endDate:'2026-11-02',subjects,targets:{}},records:{},_revision:0};}
const ctx={today:'2026-10-25',at:'2026-10-25T04:00:00.000Z',timezone:'Asia/Shanghai'};
test('basis is established before midnight and same-day reductions cannot replace it',()=>{
 const s=profile();E.initialize(s,ctx);const d='2026-10-27',prior=structuredClone(s.evaluation.bases[d]),next=structuredClone(s);next.plan.targets[d]={math:{min:10,max:20}};
 E.reconcile(s,next,{...ctx,today:d,at:d+'T04:00:00.000Z'});assert.deepEqual(next.evaluation.bases[d],prior);assert.ok(next.evaluation.changes.some(c=>c.type==='plan'));
 const future=structuredClone(s);future.plan.targets[d]={math:{min:10,max:20}};E.reconcile(s,future,{...ctx,today:'2026-10-26',at:'2026-10-26T04:00:00.000Z'});assert.equal(future.evaluation.bases[d].items[0].min,10);
});
test('D6 C4 P3 keeps missing dates in the denominator and excludes the current day',()=>{
 let s=profile();E.initialize(s,ctx);s=E.scheduleChange(s,{from:'2026-10-26',scope:'date',date:'2026-11-01',config:E.defaultConfig('rest')},ctx);
 for(let i=0;i<4;i++){const date=E.shift('2026-10-26',i);s.records[date]={subjects:{math:{minutes:i===3?40:90},vocab:{newWords:0,reviewWords:0}},status:null,note:'',restKept:null};}
 const r=E.statistics(s,'2026-10-26','2026-11-01','2026-11-02');assert.deepEqual([r.D,r.C,r.P,r.rest,r.unrecorded],[6,4,3,1,2]);assert.equal(r.rate,50);assert.equal(r.coverage,66.7);assert.equal(r.conditional,75);
 const current=E.statistics(s,'2026-10-26','2026-11-02','2026-10-27');assert.equal(current.D,1);
});
test('shortening a plan or clearing actual data does not erase ended obligations',()=>{
 const s=profile();E.initialize(s,ctx);const next=structuredClone(s);next.plan.startDate='2026-10-29';next.plan.endDate='2026-10-30';E.reconcile(s,next,{...ctx,today:'2026-10-29',at:'2026-10-29T04:00:00.000Z'});const r=E.statistics(next,'2026-10-26','2026-10-28','2026-10-29');assert.equal(r.D,3);assert.equal(r.P,0);assert.equal(r.unrecorded,3);
});
test('scheduled rest is explicit, future-only, and cannot contain required goals',()=>{
 const s=profile();E.initialize(s,ctx);assert.throws(()=>E.scheduleChange(s,{from:ctx.today,scope:'default',config:E.defaultConfig('rest')},ctx));const c=E.defaultConfig('rest');c.requiredTime=true;assert.throws(()=>E.scheduleChange(s,{from:'2026-10-26',scope:'default',config:c},ctx));
 const e=structuredClone(s);e.plan.targets['2026-10-26']={math:0};const n=E.reconcile(s,e,ctx);assert.equal(n.evaluation.bases['2026-10-26'].dayType,'unplanned');
});
test('fixed historical activity roles survive renaming and future role changes',()=>{
 let s=profile();E.initialize(s,ctx);const next=structuredClone(s);next.records['2026-10-26']={subjects:{math:{minutes:90},vocab:{newWords:0,reviewWords:0}},status:null,note:'',restKept:null};E.reconcile(s,next,{...ctx,today:'2026-10-26',at:'2026-10-26T04:00:00.000Z'});assert.equal(next.evaluation.recordRoles['2026-10-26']['math:minutes'],'study');
 const renamed=structuredClone(next);renamed.plan.subjects[0].name='复习课';E.reconcile(next,renamed,{...ctx,today:'2026-10-27',at:'2026-10-27T04:00:00.000Z'});assert.equal(renamed.evaluation.recordRoles['2026-10-26']['math:minutes'],'study');assert.equal(renamed.evaluation.bases['2026-10-26'].time[0].name,'高数');
});
