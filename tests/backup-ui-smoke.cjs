'use strict';
const {connect,android,delay}=require('./cdp-client.cjs'),ui=require('./native-ui.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pkg='cn.edu.njupt.studycheckin';
const configuredVersion=/android:versionName="([^"]+)"/.exec(fs.readFileSync(path.join(__dirname,'../app/src/main/AndroidManifest.xml'),'utf8'))[1];
let c,original,dailyId,originalFavorite,originalOnline,version,reportDir,localDir,files,fileBytes=0,cleanupError;
const checks=[],check=(value,message)=>{assert.ok(value,message);checks.push(message);console.log('PASS '+message);};
const study=()=>c.evaluate('JSON.parse(Native.getState())');
const cards=()=>c.evaluate(`JSON.parse(Native.getInspiration('daily',0,20))`);
const withoutRevision=value=>{value=structuredClone(value);delete value._revision;return value;};
const Model=require('../app/src/main/assets/model.js');
const sameStudy=(a,b)=>JSON.stringify(withoutRevision(Model.migrateState(a)))===JSON.stringify(withoutRevision(Model.migrateState(b)));
const inspiration=()=>JSON.parse(android('shell','run-as',pkg,'cat','files/inspiration.json'));
const isPicker=nodes=>nodes.some(n=>n.package==='com.google.android.documentsui'||n.package==='com.android.documentsui');
async function waitNative(predicate,message,attempts=10){for(let i=0;i<attempts;i++){const nodes=ui.nodes();if(predicate(nodes))return nodes;await delay(180);}throw Error(message);}
async function backToApp(){for(let i=0;i<4;i++){const nodes=ui.nodes();if(!isPicker(nodes)&&!nodes.some(n=>n['resource-id']==='android:id/alertTitle'))break;android('shell','input','keyevent','KEYCODE_BACK');await delay(160);}android('shell','am','start','-W','-n',pkg+'/.MainActivity');await delay(120);}
async function downloads(){let nodes=ui.nodes();const root=nodes.find(n=>['Show roots','显示根目录','显示位置'].includes(n['content-desc']));if(root){ui.tap(root);await delay(150);}nodes=ui.nodes();const download=nodes.find(n=>['Downloads','下载','下载内容'].includes(n.text));if(!download)throw Error('Downloads root not found in system document picker');ui.tap(download);await delay(220);}
async function launchPicker(action){const result=await c.evaluate(`JSON.parse(Native.${action}())`);assert.ok(result.ok,result.error);await delay(250);return waitNative(isPicker,'System document picker did not open');}
async function chooseFile(name){await launchPicker('importBackup');await downloads();const nodes=await waitNative(all=>all.some(n=>n.text===name),'Backup not visible in Downloads: '+name);ui.tap(nodes.find(n=>n.text===name));}
async function restoreDialog(complete){
  const nodes=await waitNative(all=>all.some(n=>n.text===(complete?'恢复并替换全部计划？':'恢复并替换当前计划？')),'Restore confirmation did not appear');
  const message=nodes.find(n=>n['resource-id']==='android:id/message')?.text||nodes.map(n=>n.text).join('\n');
  check(message.includes('学习记录、计时明细、复盘、学习提醒设置')&&message.includes('草稿'),'restore confirmation states learning, sessions, review and reminders replacement');
  check(complete?message.includes('将替换全部计划')&&message.includes('日签图片、历史和收藏')&&/备份共 \d+ 个计划/.test(message):message.includes('将替换当前计划')&&message.includes('其他计划和日签保留'),'restore confirmation states actual '+(complete?'complete ZIP':'legacy JSON')+' media scope');
  check(nodes.some(n=>n.text==='恢复并替换')&&nodes.some(n=>n.text==='取消'),'restore offers explicit replacement and cancel actions');return nodes;
}
async function restoreOriginal(){
  if(!c||!original)return;await backToApp();const current=await study(),value=structuredClone(original);value._revision=current._revision||0;
  const result=await c.evaluate(`JSON.parse(Native.saveState(${JSON.stringify(JSON.stringify(value))}))`);assert.ok(result.ok,result.error);
  if(dailyId&&originalFavorite!==undefined){const r=await c.evaluate(`JSON.parse(Native.favoriteInspiration(${JSON.stringify(dailyId)},${originalFavorite}))`);assert.ok(r.ok,r.error);}
  if(originalOnline!==undefined){const r=await c.evaluate(`JSON.parse(Native.setInspirationOnline(${originalOnline}))`);assert.ok(r.ok,r.error);}
  await c.evaluate('window.onBackupRestored && onBackupRestored()');assert.ok(sameStudy(await study(),original),'finally restores original learning fields');if(dailyId)assert.equal((await cards()).daily.card.favorite,originalFavorite,'finally restores original favorite');
}
(async()=>{let failure;try{
  android('shell','am','start','-W','-n',pkg+'/.MainActivity');c=await connect();await c.evaluate('window.InspirationUI && InspirationUI.back()');
  check(!(await c.evaluate('JSON.parse(Native.getTimer())')).active,'backup test starts without an unsaved active timer');
  const info=await c.evaluate('JSON.parse(Native.getAppInfo())');version=info.versionName;check(version===configuredVersion,'backup report version matches actual package and manifest');
  reportDir=path.join(__dirname,'../docs/validation-v'+version);localDir=path.join(__dirname,'../tmp/backup-ui-v'+version);fs.mkdirSync(reportDir,{recursive:true});fs.mkdirSync(localDir,{recursive:true});
  files={complete:'daily-study-ux-'+version+'-complete.zip',bad:'daily-study-ux-'+version+'-bad.zip',legacy:'daily-study-ux-'+version+'-legacy.json'};
  original=await study();const before=await cards();check(!!before.daily,'backup scenario contains an actual saved daily image');dailyId=before.daily.id;originalFavorite=before.daily.card.favorite;originalOnline=before.online;
  const startup=(await c.evaluate('InspirationUI.snapshot()')).startupId;await c.evaluate('JSON.parse(Native.setInspirationOnline(false))');
  for(let i=0;i<120&&(await cards()).fetching;i++)await delay(250);check(!(await cards()).fetching,'network preparation settles before comparing persistent card data');
  for(const name of Object.values(files))android('shell','rm','-f','/sdcard/Download/'+name);const initialCards=inspiration(),backupBefore=await c.evaluate('JSON.parse(Native.getBackupStatus())');

  await launchPicker('exportBackup');android('shell','input','keyevent','KEYCODE_BACK');await delay(220);
  check(sameStudy(await study(),original)&&JSON.stringify(inspiration())===JSON.stringify(initialCards),'cancelling create-document preserves learning and card data');
  check((await c.evaluate('JSON.parse(Native.getBackupStatus())')).lastExportAt===backupBefore.lastExportAt,'cancelled backup export leaves last successful date unchanged');
  await launchPicker('importBackup');android('shell','input','keyevent','KEYCODE_BACK');await delay(220);
  check(sameStudy(await study(),original)&&JSON.stringify(inspiration())===JSON.stringify(initialCards),'cancelling open-document preserves learning and card data');

  await launchPicker('exportBackup');await downloads();let nodes=ui.nodes();
  const title=nodes.find(n=>n.class==='android.widget.EditText'&&n['resource-id']==='android:id/title')||nodes.find(n=>n.class==='android.widget.EditText'&&(n.text||'').endsWith('.zip'));
  check(!!title,'Android create-document requests a complete ZIP filename');ui.tap(title);
  android('shell','input','keyevent','KEYCODE_MOVE_END',...Array.from({length:title.text.length},()=>'KEYCODE_DEL'));android('shell','input','text',files.complete);nodes=ui.nodes();ui.tap(nodes.find(n=>['SAVE','保存'].includes(n.text)));
  const remote='/sdcard/Download/'+files.complete;let lastSize=-1,stable=0;
  for(let i=0;i<60;i++){try{const size=Number(android('shell','stat','-c','%s',remote));stable=size>1000&&size===lastSize?stable+1:0;lastSize=size;if(stable>=3)break;}catch{}await delay(250);}
  const completePath=path.join(localDir,files.complete);android('pull',remote,completePath);const bytes=fs.readFileSync(completePath);fileBytes=bytes.length;
  check(Date.parse((await c.evaluate('JSON.parse(Native.getBackupStatus())')).lastExportAt)>Date.parse(backupBefore.lastExportAt||'1970-01-01'),'successful complete ZIP records its actual completion date');
  check(bytes[0]===80&&bytes[1]===75&&bytes.length>1000,'actual SAF writes a nonempty complete ZIP');check(!(await c.evaluate('InspirationUI.snapshot()')).splashVisible,'return from export picker does not replay startup');
  await c.evaluate(`(()=>{const f=JSON.parse(Native.favoriteInspiration(${JSON.stringify(dailyId)},${!originalFavorite}));if(f.error)throw Error(f.error);const s=JSON.parse(Native.getState()),day=StudyModel.today(),r=StudyModel.record(s,day);r.note='系统备份恢复验证临时手记';StudyModel.saveRecord(s,day,r);const saved=JSON.parse(Native.saveState(JSON.stringify(s)));if(!saved.ok)throw Error(saved.error);return true;})()`);
  check((await cards()).daily.card.favorite===!originalFavorite,'temporary favorite change is visible before restoring ZIP');const modified=await study(),modifiedCards=inspiration();
  await chooseFile(files.complete);await restoreDialog(true);await ui.byId('android:id/button2');await delay(220);
  check(sameStudy(await study(),modified)&&JSON.stringify(inspiration())===JSON.stringify(modifiedCards),'cancelling overwrite confirmation preserves learning, favorite and card history');

  const badPath=path.join(localDir,files.bad);fs.writeFileSync(badPath,Buffer.concat([Buffer.from([80,75,3,4]),Buffer.from('truncated-invalid-zip')]));android('push',badPath,'/sdcard/Download/'+files.bad);await chooseFile(files.bad);
  const badNodes=await waitNative(all=>all.some(n=>(n.text||'').includes('备份检查失败')),'Invalid ZIP did not report visible validation failure',8);
  check(!badNodes.some(n=>/^恢复并替换(?:全部|当前)计划？$/.test(n.text)),'invalid ZIP is rejected before overwrite confirmation');check(badNodes.some(n=>n.text==='重新选择')&&badNodes.some(n=>n.text==='取消'),'invalid ZIP offers actual retry and cancel controls');check(sameStudy(await study(),modified)&&JSON.stringify(inspiration())===JSON.stringify(modifiedCards),'failed ZIP validation leaves learning and card data unchanged');

  await ui.byId('android:id/button2');  await chooseFile(files.complete);await restoreDialog(true);await ui.byId('android:id/button1');for(let i=0;i<60&&!sameStudy(await study(),original);i++)await delay(180);
  check(sameStudy(await study(),original),'actual SAF complete ZIP restores learning fields');const restored=await cards();check(restored.daily.id===dailyId&&restored.daily.card.favorite===originalFavorite,'complete ZIP restores fixed daily entry and favorite');

  const legacy=structuredClone(original);legacy.version=1;delete legacy.plan.manualWeekGoals;delete legacy.plan.wordTargets;legacy.plan.subjects.forEach(s=>{delete s.activePeriods;delete s.wordGoal;delete s.wordSteps;});Object.values(legacy.reviews||{}).forEach(r=>delete r.subjects);const day=await c.evaluate('StudyModel.today()');legacy.records[day]=legacy.records[day]||{status:null,restKept:null,note:'',subjects:{}};legacy.records[day].note='旧JSON兼容导入验证';
  for(const subject of legacy.plan.subjects)legacy.records[day].subjects[subject.id]=legacy.records[day].subjects[subject.id]||{minutes:null,content:'',problem:'',newWords:null,reviewWords:null,forgotWords:''};
  const legacyPath=path.join(localDir,files.legacy);fs.writeFileSync(legacyPath,JSON.stringify(legacy));android('push',legacyPath,'/sdcard/Download/'+files.legacy);
  const favoriteResult=await c.evaluate(`JSON.parse(Native.favoriteInspiration(${JSON.stringify(dailyId)},${!originalFavorite}))`);assert.ok(favoriteResult.ok,favoriteResult.error);const beforeLegacy=inspiration();
  await chooseFile(files.legacy);await restoreDialog(false);await ui.byId('android:id/button1');for(let i=0;i<60&&!sameStudy(await study(),legacy);i++)await delay(180);
  check(sameStudy(await study(),legacy),'actual SAF legacy version-1 JSON imports learning data');check(JSON.stringify(inspiration())===JSON.stringify(beforeLegacy),'legacy JSON preserves image references, daily/startup history and favorites');
  await c.evaluate(`document.querySelector('.bottom-nav [data-nav="inspiration"]').click()`);await delay(220);let imageLoaded=false;
  for(let i=0;i<20;i++){imageLoaded=await c.evaluate('!!document.querySelector(".card-art")&&document.querySelector(".card-art").complete&&document.querySelector(".card-art").naturalWidth>0');if(imageLoaded)break;await delay(100);}check(imageLoaded,'legacy import leaves the existing daily image available');
  const finalStartup=await c.evaluate('InspirationUI.snapshot()');check(finalStartup.startupId===startup&&!finalStartup.splashVisible,'restore confirmation does not create another startup');
}catch(error){failure=error;}finally{
  try{await restoreOriginal();}catch(error){cleanupError=error;if(!failure)failure=error;}if(c)c.close();
  if(reportDir){const report={version,passed:checks.length,checks,fileBytes,completed:!failure,cleanupRestored:!!original&&!cleanupError,error:failure?String(failure.stack||failure):null};fs.writeFileSync(path.join(reportDir,'backup-ui.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
}if(failure)throw failure;})().catch(error=>{console.error(error);process.exitCode=1;});
