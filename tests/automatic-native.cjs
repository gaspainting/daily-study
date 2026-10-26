'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),E=require('../app/src/main/assets/evaluation.js');
process.env.COURSE_REPORT_NAME='automatic-native-wrapper-results.json';
require('./course-agenda-fix-ui.cjs')(async h=>{
 h.nativeCases();for(const extension of ['pdf','csv']){const name='automatic-assessment-sample.'+extension;fs.writeFileSync(path.join(h.report,name),h.read('cache/'+name));h.shell('rm -- cache/'+name);}const raw=h.read('cache/automatic-java-results.json');fs.writeFileSync(path.join(h.report,'automatic-java-results.json'),raw);h.shell('rm -- cache/automatic-java-results.json');
 const cases=require('./fixtures/automatic-assessment-cases.json'),actual=JSON.parse(raw);
 for(const c of cases){const row=actual.find(x=>x.name===c.name);assert.ok(row,c.name);assert.deepEqual(row.result,E.evaluateDay(c.basis,c.record,c.recordRevision,c.phase),c.name);}
 h.check(true,'all shared automatic-assessment cases match JavaScript and Android Java field for field');
});
