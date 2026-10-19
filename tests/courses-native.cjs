'use strict';
const fs=require('node:fs'),path=require('node:path');
process.env.COURSE_REPORT_NAME='courses-native-results.json';
require('./course-agenda-fix-ui.cjs')(async h=>{
 h.nativeCases();
 const pdf=h.read('cache/courses-validation.pdf');
 h.check(pdf.subarray(0,5).toString()==='%PDF-'&&pdf.length>1000,'actual native per-course PDF is available for visual review');
 fs.writeFileSync(path.join(h.report,'courses-validation.pdf'),pdf);
 h.shell("rm -f cache/courses-validation.pdf cache/history-validation.pdf cache/history-validation.csv");
});
