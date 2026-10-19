'use strict';
// Preserve the full private-data snapshot around the existing updater suite.
const cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
process.env.COURSE_REPORT_NAME='update-regression-wrapper-results.json';
require('./course-agenda-fix-ui.cjs')(async h=>{
 await h.boot();
 cp.execFileSync(process.execPath,[path.join(h.root,'tests/update-ui.cjs')],{stdio:'inherit',env:process.env});
 const result=JSON.parse(fs.readFileSync(path.join(h.report,'update-ui-results.json'),'utf8'));
 h.check(!result.failure&&result.restored&&result.passed>0,'existing updater UI regression suite completes without failure');
});
