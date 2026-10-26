'use strict';
// Real public channel and real previous signed APK; no updater fixtures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ui=require('./native-ui.cjs');
process.env.COURSE_FORMAL_UPGRADE='1';process.env.COURSE_REPORT_NAME='public-startup-results.json';
require('./course-agenda-fix-ui.cjs')(async h=>{
 const source=fs.readFileSync(path.join(h.root,'app/src/main/AndroidManifest.xml'),'utf8'),version=/android:versionName="([^"]+)"/.exec(source)[1],base=process.env.UPDATE_BASE_VERSION||'1.6.5',pkg='cn.edu.njupt.studycheckin';
 assert.equal(h.android('shell','id','-u'),'0');const keys=['http_proxy','global_http_proxy_host','global_http_proxy_port','global_http_proxy_exclusion_list','global_proxy_pac_url'],old=Object.fromEntries(keys.map(k=>[k,h.android('shell','settings','get','global',k)]));
 try{
  h.android('install','--no-incremental','-r','-d',path.join(h.root,'dist/每日学习-v'+base+'.apk'));
  h.check(h.android('shell','dumpsys','package',pkg).includes('versionName='+base),'public-channel discovery runs the actual previous formal version');
  h.android('shell','settings','put','global','http_proxy','10.0.2.2:7897');await h.delay(300);h.android('shell','am','force-stop',pkg);h.android('shell','am','start','-W','-n',pkg+'/.MainActivity');
  const end=Date.now()+60000;let nodes=[];while(Date.now()<end){nodes=ui.nodes();const labels=nodes.flatMap(n=>[n.text,n['content-desc']]);if(labels.includes('应用更新')&&labels.some(t=>(t||'').includes(version))&&labels.includes('下载更新'))break;await h.delay(300);}
  fs.writeFileSync(path.join(h.report,'public-startup-native-nodes.json'),JSON.stringify(nodes,null,2));
  const labels=nodes.flatMap(n=>[n.text,n['content-desc']]);h.check(labels.includes('应用更新')&&labels.some(t=>(t||'').includes(version))&&labels.includes('下载更新'),'previous formal APK discovers the real published update on cold start without entering About');
  h.android('shell','screencap','-p','/sdcard/public-startup-update.png');h.android('pull','/sdcard/public-startup-update.png',path.join(h.shots,'public-native-startup.png'));
  h.check(labels.includes('稍后')&&!labels.includes('安装更新'),'real public startup discovery does not automatically download or request installation');
 }finally{
  for(const key of keys){if(old[key]==='null')h.android('shell','settings','delete','global',key);else h.android('shell','settings','put','global',key,old[key]);}
  h.android('install','--no-incremental','-r',path.join(h.root,'dist/每日学习-v'+version+'.apk'));
  h.check(keys.every(k=>h.android('shell','settings','get','global',k)===old[k]),'public-channel check restores all original emulator proxy settings');
 }
});
