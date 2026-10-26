'use strict';
const fs=require('node:fs'),path=require('node:path');
process.env.COURSE_REPORT_NAME='update-native-wrapper-results.json';
require('./course-agenda-fix-ui.cjs')(async h=>{
 const out=h.android('shell','am','instrument','-w','-r','cn.edu.njupt.studycheckin/cn.edu.njupt.studycheckin.UpdateInstrumentation');fs.writeFileSync(path.join(h.report,'update-native-results.txt'),out+'\n');
 h.check(/PASS \d+ update checks/.test(out)&&/INSTRUMENTATION_CODE: -1/.test(out)&&!out.includes('FAILED'),'native update validation cooldown manual bypass cancellation and timer checks pass');
 if(process.env.UPDATE_PUBLIC_CODE){
  const keys=['http_proxy','global_http_proxy_host','global_http_proxy_port','global_http_proxy_exclusion_list','global_proxy_pac_url'],old=Object.fromEntries(keys.map(k=>[k,h.android('shell','settings','get','global',k)]));
  try{
   h.android('shell','settings','put','global','http_proxy','10.0.2.2:7897');await h.delay(300);
   const network=h.android('shell','am','instrument','-w','-r','-e','network','true','-e','expectedCode',process.env.UPDATE_PUBLIC_CODE,'cn.edu.njupt.studycheckin/cn.edu.njupt.studycheckin.UpdateInstrumentation');fs.writeFileSync(path.join(h.report,'update-public-native-results.txt'),network+'\n');
   h.check(/PASS 3 update checks/.test(network)&&/INSTRUMENTATION_CODE: -1/.test(network)&&!network.includes('FAILED'),'real native HTTPS reads and validates the latest public manifest through the test host proxy');
  }finally{for(const key of keys){if(old[key]==='null')h.android('shell','settings','delete','global',key);else h.android('shell','settings','put','global',key,old[key]);}h.check(keys.every(k=>h.android('shell','settings','get','global',k)===old[k]),'all original emulator proxy settings restored');}
 }
});
