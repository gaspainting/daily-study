'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Model=require('../app/src/main/assets/model.js'),Words=require('../app/src/main/assets/words.js');
const seed=require('../app/src/main/assets/seed.json');
const state=()=>Model.migrateState(structuredClone(seed));
test('undo restores the exact prior blank, explicit zero, and alternate numeric spelling',()=>{
 for(const before of ['', '0', '0.0', '20']){const change=Words.addition(before,10);assert.equal(Words.undo(change,change.after),before);}
});
test('undo never overrides subsequent manual edits and consecutive increments restore only the latest prior value',()=>{
 const first=Words.addition('',10),second=Words.addition(first.after,20);
 assert.equal(second.after,'30');assert.equal(Words.undo(second,'30'),'10');assert.equal(Words.undo(second,'40'),null);assert.equal(Words.undo(null,'30'),null);
});
test('word additions reject invalid inputs or overflow without altering a caller snapshot',()=>{
 for(const [value,amount] of [['100000',1],['-1',10],['1.2',10],['bad',10],['0',0],['0',1.5],['0',100001],['0','10']])assert.throws(()=>Words.addition(value,amount));
 assert.equal(Words.addition('99999',1).after,'100000');
});
test('shortcut settings are independently cloned per vocabulary subject and leave historical records and goals intact',()=>{
 const s=state(),before=structuredClone(s),steps=[1,5,10];
 Model.setWordSteps(s,'vocab',steps);steps[0]=99;
 assert.deepEqual(Model.wordSteps(s,'vocab'),[1,5,10]);const returned=Model.wordSteps(s,'vocab');returned[0]=88;
 assert.deepEqual(Model.wordSteps(s,'vocab'),[1,5,10]);assert.deepEqual(s.records,before.records);assert.deepEqual(s.plan.targets,before.plan.targets);
 assert.equal(Model.wordTarget(s,'2026-10-14','vocab'),50);assert.deepEqual(Model.wordSteps(state(),'vocab'),[5,10,20]);
 assert.deepEqual(Model.wordSteps(Model.migrateState(JSON.parse(JSON.stringify(s))),'vocab'),[1,5,10]);
});
test('shortcut validation is strict about subject kind, three positive integral values, uniqueness and upper bound',()=>{
 for(const steps of [null,[1,2],[1,2,3,4],[0,5,10],[-1,5,10],[1.5,5,10],[1,1,10],['1',5,10],[1,5,100001]])assert.throws(()=>Model.setWordSteps(state(),'vocab',steps));
 assert.throws(()=>Model.setWordSteps(state(),'math',[1,5,10]));
 const s=state();s.version=1;s.plan.subjects[1].wordSteps=[1,5,10];delete s.plan.manualWeekGoals;assert.throws(()=>Model.validate(s));
});
