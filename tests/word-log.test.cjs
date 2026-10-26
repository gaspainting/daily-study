'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../app/src/main/assets/model.js'),L=require('../app/src/main/assets/word-log.js'),R=require('../app/src/main/assets/reference.js');
const seed=require('../app/src/main/assets/seed.json'),cases=require('./fixtures/word-log-cases.json');
const date='2026-10-25',at='2026-10-25T03:04:05.000Z',fresh=()=>M.migrateState(structuredClone(seed),date);
const event=(id,kind='new',count=10,operation='add',source='quick')=>({id,kind,count,operation,source,at});
for(const c of cases)test('word log parity: '+c.name,()=>{
  const before=structuredClone(c.log);
  if(c.valid){assert.deepEqual(L.totals(c.log),c.totals);assert.equal(L.validate(c.log,c.totals),true);}
  else assert.throws(()=>L.totals(c.log));
  assert.deepEqual(c.log,before);
});
test('legacy schema1–6 migration retains totals and sessions without generating batches',()=>{
  for(const version of [1,2,3,4,5,6]){
    const state=structuredClone(seed),record=M.record(state,date);
    record.subjects.vocab.newWords=50;record.subjects.vocab.reviewWords=0;state.records[date]=record;state.version=version;
    const original=structuredClone(state),next=M.migrateState(state,date);
    assert.equal(next.version,9);assert.deepEqual(next.records,original.records);assert.deepEqual(state,original);
    assert.equal(next.records[date].subjects.vocab.wordLog,undefined);
  }
});
test('quick additions preserve blank versus zero and removing a batch restores the original value',()=>{
  for(const before of [null,0,20]){
    const base={newWords:before,reviewWords:null},log=L.from(base),added=L.append(log,event('a'));
    assert.equal(L.totals(added).newWords,(before??0)+10);
    assert.deepEqual(L.totals(L.remove(added,'a')),base);
    assert.deepEqual(L.totals(log),base);
  }
});
test('editing or removing an earlier batch recalculates totals; absolute total adjustments remain explicit',()=>{
  let log=L.append(L.append(L.from({newWords:50,reviewWords:0}),event('a')),event('b','review',7));
  const original=structuredClone(log);log=L.edit(log,'a',15,at);
  assert.deepEqual(L.totals(log),{newWords:65,reviewWords:7});assert.equal(log.entries[0].source,'quick');assert.equal(log.entries[0].editedAt,at);
  log=L.setTotal(log,'new',40,'c',at,['a','b']);log=L.append(log,event('d','new',5));
  assert.equal(L.totals(L.edit(log,'a',12,at)).newWords,45);
  assert.equal(L.totals(L.remove(log,'c')).newWords,70);
  assert.deepEqual(original.entries.map(e=>e.count),[10,7]);
});
test('keystroke drafts coalesce total edits but preserve saved adjustments and interleaved additions',()=>{
  let log=L.from({newWords:null,reviewWords:0});
  log=L.setTotal(log,'new',5,'a',at,[]);log=L.setTotal(log,'new',50,'b',at,[]);
  assert.equal(log.entries.length,1);assert.equal(log.entries[0].id,'a');assert.equal(log.entries[0].count,50);
  log=L.setTotal(log,'review',10,'r',at,[]);log=L.setTotal(log,'new',null,'c',at,[]);
  assert.deepEqual(L.totals(log),{newWords:null,reviewWords:10});assert.equal(log.entries.length,1);
  log=L.setTotal(log,'new',20,'d',at,[]);log=L.setTotal(log,'new',30,'e',at,['d']);
  assert.equal(log.entries.filter(e=>e.kind==='new').length,2);
  log=L.append(log,event('f','new',2));log=L.setTotal(log,'new',10,'g',at,[]);
  assert.equal(log.entries.at(-2).id,'f');assert.equal(L.totals(log).newWords,10);
});
test('daily save and repeat save keep one set of IDs, independent word assessment, history and statistics',()=>{
  const state=fresh(),record=M.record(state,date),timeBefore=M.weekStats(state,date).subjects.find(s=>s.id==='math');
  record.status='正常参考';record.subjects.vocab=L.apply(record.subjects.vocab,L.append(L.from(record.subjects.vocab),event('a','new',50)));
  M.saveRecord(state,date,record);const snapshot=structuredClone(state.records);M.saveRecord(state,date,M.record(state,date));
  assert.deepEqual(state.records,snapshot);assert.equal(R.assess(state,date).words[0].kind,'within');
  assert.equal(M.recordSummary(state,date).total,null);assert.equal(M.historySearch(state,{subjectId:'vocab'})[0].newWords,50);
  assert.equal(M.wordStats(state,[date])[0].newWords,50);assert.equal(M.monthStats(state,'2026-10').actual,null);
  assert.deepEqual(M.weekStats(state,date).subjects.find(s=>s.id==='math'),timeBefore);
  const roundTrip=M.migrateState(JSON.parse(JSON.stringify(state)),date);assert.deepEqual(roundTrip.records,state.records);
});
test('malformed or mismatched logs fail before records are changed and cannot be assigned to a time subject',()=>{
  const state=fresh(),before=structuredClone(state),record=M.record(state,date);
  record.subjects.vocab.wordLog=L.append(L.from(record.subjects.vocab),event('a'));
  assert.throws(()=>M.saveRecord(state,date,record),/不一致/);assert.deepEqual(state,before);
  const bad=structuredClone(before);bad.records[date]=M.record(bad,date);bad.records[date].subjects.math.wordLog={base:{newWords:null,reviewWords:null},entries:[]};
  assert.throws(()=>M.validateState(bad),/单词/);
  const downgraded=fresh();downgraded.records[date]=M.record(downgraded,date);downgraded.records[date].subjects.vocab=L.apply(downgraded.records[date].subjects.vocab,L.append(L.from(downgraded.records[date].subjects.vocab),event('a')));downgraded.version=6;
  assert.throws(()=>M.validateState(downgraded));
});
test('limits and invalid edits are atomic and the ledger is isolated from other dates and plans',()=>{
  const log=L.from({newWords:null,reviewWords:0});for(let i=0;i<1000;i++)log.entries.push(event('e'+i,'new',1));
  const original=structuredClone(log);assert.throws(()=>L.append(log,event('overflow')));assert.throws(()=>L.edit(log,'e0',0,at));assert.throws(()=>L.remove(log,'missing'));assert.deepEqual(log,original);
  const a=fresh(),b=fresh(),r=M.record(a,date);r.subjects.vocab=L.apply(r.subjects.vocab,L.append(L.from(r.subjects.vocab),event('a')));M.saveRecord(a,date,r);
  assert.equal(M.record(a,'2026-10-26').subjects.vocab.wordLog,undefined);assert.equal(M.record(b,date).subjects.vocab.wordLog,undefined);
  const copy=M.record(a,date);copy.subjects.vocab.wordLog.entries[0].count=99;assert.equal(a.records[date].subjects.vocab.wordLog.entries[0].count,10);
});
test('cleared totals retain their real ledger in archived history without inventing a recorded count',()=>{
  const state=fresh(),record=M.record(state,date);
  let log=L.append(L.from(record.subjects.vocab),event('a'));
  log=L.setTotal(log,'new',null,'clear',at,['a']);record.subjects.vocab=L.apply(record.subjects.vocab,log);M.saveRecord(state,date,record);
  M.archiveSubject(state,'vocab',date);
  const summary=M.recordSummary(state,date);
  assert.equal(summary.newWords,null);assert.equal(summary.reviewWords,null);assert.equal(summary.recordedSubjects,0);assert.equal(summary.wordEntryCount,2);
  assert.equal(M.historySearch(state,{subjectId:'vocab'}).length,1);
  assert.match(require('../app/src/main/assets/tracking.js').summaryText(summary),/单词明细 2 条/);
});
