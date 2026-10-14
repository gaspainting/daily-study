'use strict';
// Actual HTTPS check/download and Android permission/installer flow. The bootstrap
// is the current updater code built with 1.2/code3 metadata, for emulator tests only.
const {connect,android,delay}=require('./cdp-client.cjs'),ui=require('./native-ui.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pkg='cn.edu.njupt.studycheckin',root=path.resolve(__dirname,'..');
const version=/android:versionName="([^"]+)"/.exec(fs.readFileSync(path.join(root,'app/src/main/AndroidManifest.xml'),'utf8'))[1];
const reports=path.join(root,'docs','validation-v'+version),shots=path.join(root,'docs','screenshots','v'+version);
const checks=[],check=(ok,name)=>{assert.ok(ok,name);checks.push(name);console.log('PASS '+name);};
let c,originalStudy,originalOnline,studyBefore,mediaBefore,photosBefore,failure;
const click=async selector=>{await c.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(200);};
const update=()=>c.evaluate('JSON.parse(Native.getUpdateState())');
const study=()=>c.evaluate('JSON.parse(Native.getState())');
async function until(test,message,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await delay(200);}throw Error(message);}
async function attach(){if(c)c.close();c=null;await until(async()=>{try{c=await connect();if(await c.evaluate('!!window.StudyUI'))return true;c.close();c=null;}catch{}return false;},'App WebView unavailable');await c.evaluate('InspirationUI.back()');}
async function about(){await click('.bottom-nav [data-nav=settings]');await click('[data-action=about]');}
function privateHash(file){return android('shell','sha256sum','/data/user/0/'+pkg+'/files/'+file).split(/\s/)[0];}
function photoHashes(){return android('shell','find','/data/user/0/'+pkg+'/files/inspiration-media','-type','f').split(/\r?\n/).filter(Boolean).map(file=>android('shell','sha256sum',file)).sort();}
function capture(name){android('shell','screencap','-p','/sdcard/daily-update-install.png');android('pull','/sdcard/daily-update-install.png',path.join(shots,name+'.png'));}
function settingsToggle(){const nodes=ui.nodes();const control=nodes.find(n=>/Switch/.test(n.class)&&n.checkable==='true')||nodes.find(n=>n.checkable==='true');assert.ok(control,'unknown-sources settings switch');return control;}
function sameContent(a,b){a=structuredClone(a);b=structuredClone(b);delete a._revision;delete b._revision;return JSON.stringify(a)===JSON.stringify(b);}
(async()=>{try{
  fs.mkdirSync(reports,{recursive:true});fs.mkdirSync(shots,{recursive:true});check(/^emulator-/.test(process.env.ANDROID_SERIAL||'emulator-5572')&&android('shell','id').includes('uid=0'),'test-only emulator root available for exact post-install file checks');
  // Revoking a previously allowed app-op may kill the process; set up the denied
  // state before attaching to its WebView instead of reusing a dead CDP socket.
  android('shell','appops','set',pkg,'REQUEST_INSTALL_PACKAGES','deny');
  android('shell','am','force-stop',pkg);android('shell','am','start','-W','-n',pkg+'/.MainActivity');
  await attach();check((await c.evaluate('JSON.parse(Native.getAppInfo())')).versionCode===3,'update-enabled 1.2 test bootstrap is installed, not published');
  check(!(await c.evaluate('JSON.parse(Native.getTimer())')).active,'actual update test does not interrupt an existing timer');
  originalStudy=await study();originalOnline=(await c.evaluate('JSON.parse(Native.getInspiration("daily",0,1))')).online;
  // Remove only this test's own previously downloaded APK, so a rerun transfers bytes again.
  const published=JSON.parse(fs.readFileSync(path.join(root,'release','v'+version,'update.json'),'utf8'));
  assert.equal(published.versionCode,4);assert.match(published.apkSha256,/^[a-f0-9]{64}$/);
  android('shell','rm','-f','/data/user/0/'+pkg+'/files/updates/update-4-'+published.apkSha256+'.apk');
  await c.evaluate('Native.setInspirationOnline(false)');await until(async()=>!(await c.evaluate('JSON.parse(Native.getInspiration("daily",0,1))')).fetching,'Image preparation did not finish');
  const representative=structuredClone(originalStudy),day=representative.plan.startDate;
  representative.plan.title='App 内更新数据保留验证';
  const base={minutes:null,content:'',problem:'',newWords:null,reviewWords:null,forgotWords:''};
  representative.records[day]={subjects:{math:{...base,minutes:null,content:'未记录'},vocab:{...base,minutes:0}},status:'休息',restKept:true,note:'覆盖安装保留 null、0、休息与随记'};
  const saved=await c.evaluate(`JSON.parse(Native.saveState(${JSON.stringify(JSON.stringify(representative))}))`);assert.ok(saved.ok,saved.error);
  await c.evaluate('onNativeResume()');await about();await click('[data-action=update-check]');
  await until(async()=>!['idle','checking'].includes((await update()).phase),'Live GitHub check did not settle');
  let next=await update();check(['available','ready'].includes(next.phase)&&next.candidate.versionName===version&&next.candidate.versionCode===4,'real stable GitHub manifest offers newer code4');capture('update-available-real');
  // Cancel synchronously before the executor can finish the small APK transfer.
  await c.evaluate('Native.downloadUpdate();Native.cancelUpdate();onAppUpdateChanged()');await delay(350);
  check((await update()).phase==='available','real download cancellation returns to available without stale ready completion');
  await click('[data-action=update-download]');await until(async()=>!['downloading'].includes((await update()).phase),'Actual APK download did not settle',60000);
  next=await update();check(next.phase==='ready','actual public APK download passes native size/hash/package/version/certificate checks');
  check(next.bytes===next.total&&next.bytes===next.candidate.apkBytes,'actual downloaded byte count matches published APK');
  const cached='updates/update-'+next.candidate.versionCode+'-'+next.candidate.apkSha256+'.apk';check(privateHash(cached)===next.candidate.apkSha256,'actual cached APK bytes match public manifest SHA256');
  await c.evaluate('onNativeResume()');check(!(await update()).canInstall,'denied install permission is read from actual Android state');
  const repeated=await c.evaluate('({first:JSON.parse(Native.installUpdate()),second:JSON.parse(Native.installUpdate())})');
  check(repeated.first.ok&&repeated.second.error?.includes('正在打开'),'rapid repeated installation requests are guarded');
  await delay(400);check(settingsToggle().checked==='false','explicit install action opens unknown-source settings with permission off');capture('update-install-permission');
  android('shell','input','keyevent','4');await delay(400);await c.evaluate('onNativeResume()');
  check(!(await update()).canInstall&&(await update()).phase==='ready','permission denial and Settings return preserve verified download');
  await click('[data-action=update-install]');await delay(400);ui.tap(settingsToggle());await delay(350);android('shell','input','keyevent','4');await delay(400);await c.evaluate('onNativeResume()');
  check((await update()).canInstall,'user enabling permission is reflected after returning from system Settings');
  await click('[data-action=update-install]');await delay(500);
  let installer=ui.nodes();check(installer.some(n=>n['resource-id']==='android:id/button1')&&installer.some(n=>n['resource-id']==='android:id/button2'),'verified APK opens actual Android installation confirmation');capture('update-install-confirm');
  await ui.byId('android:id/button2');await delay(400);await c.evaluate('onNativeResume()');
  check((await c.evaluate('JSON.parse(Native.getAppInfo())')).versionCode===3&&(await update()).phase==='ready','cancelling actual installer keeps original version and retryable APK');
  check(sameContent(await study(),representative),'cancelling actual installation preserves learning records');
  studyBefore=privateHash('study-state.json');mediaBefore=privateHash('inspiration.json');photosBefore=photoHashes();check(photosBefore.length>0,'actual stored images exist for update preservation check');
  await click('[data-action=update-install]');await delay(400);await ui.byId('android:id/button1');
  c.close();c=null;
  await until(async()=>/versionName=1\.3\.0\b/.test(android('shell','dumpsys','package',pkg)),'Actual installer did not upgrade the package',60000);
  check(privateHash('study-state.json')===studyBefore,'actual system cover-install preserves exact study file bytes');
  check(privateHash('inspiration.json')===mediaBefore&&JSON.stringify(photoHashes())===JSON.stringify(photosBefore),'actual system cover-install preserves exact daily history/favorites and image bytes');
  const dump=android('shell','dumpsys','package',pkg);check(/versionCode=4\b/.test(dump)&&!dump.match(/pkgFlags=\[[^\]]*DEBUGGABLE/),'installed public APK has code4 and is not debuggable');
  // Avoid relaunching a still-running old Activity while installer replaces it.
  android('shell','am','force-stop',pkg);android('shell','am','start','-W','-n',pkg+'/.MainActivity');await attach();await about();
  check(await c.evaluate('document.querySelector("[data-build-version]").dataset.buildVersion')===version,'after installation About reads the genuinely installed version');
  check(sameContent(await study(),representative),'after normal startup preserved null/zero/rest records remain readable');
  await click('[data-action=update-check]');await until(async()=>!['idle','checking'].includes((await update()).phase),'Post-install check did not settle');check((await update()).phase==='current','public installed version checks as current via actual GitHub endpoint');capture('update-current-real');
}catch(e){failure=e;console.error(e);}finally{
  const cleanup=[];
  if(c&&originalStudy){try{const current=await study();originalStudy._revision=current._revision||0;const result=await c.evaluate(`JSON.parse(Native.saveState(${JSON.stringify(JSON.stringify(originalStudy))}))`);assert.ok(result.ok,result.error);if(typeof originalOnline==='boolean')await c.evaluate('Native.setInspirationOnline('+originalOnline+')');}catch(e){cleanup.push(e.message);}}
  if(c)c.close();
  const result={version,from:'update-enabled 1.2.0/code3 emulator-only fixture',to:'actual public release 1.3.0/code4',passed:checks.length,checks,exactPreserved:{studySha256:studyBefore,mediaSha256:mediaBefore,photoFiles:photosBefore?.length},error:failure?.message||null,cleanupErrors:cleanup,unverified:['Physical vivo X100s network and installer UI; Android8-15 installation behavior.']};
  fs.writeFileSync(path.join(reports,'update-install-ui-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(failure||cleanup.length)process.exitCode=1;
}})();
