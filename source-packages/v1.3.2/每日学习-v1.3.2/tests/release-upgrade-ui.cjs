/* Real same-signature, cover-install regression. Run only with exclusive emulator access. */
'use strict';
const {connect,android,delay}=require('./cdp-client.cjs');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const manifest=fs.readFileSync(path.join(root,'app/src/main/AndroidManifest.xml'),'utf8');
const attr=name=>{const found=new RegExp('android:'+name+'="([^"]+)"').exec(manifest);assert.ok(found,'manifest '+name);return found[1];};
const version=attr('versionName'),versionCode=Number(attr('versionCode')),label=attr('label');
const pkg=/\bpackage="([^"]+)"/.exec(manifest)[1];
assert.equal(pkg,'cn.edu.njupt.studycheckin','CDP helper package matches manifest');
const previousVersion='1.1.0',previousApk=path.join(root,'dist',label+'-v'+previousVersion+'-test.apk');
const targetApk=path.join(root,'dist',label+'-v'+version+'-test.apk');
const reportDir=path.join(root,'docs','validation-v'+version),recoveryDir=path.join(root,'tmp','upgrade-v'+version);
const sdk=process.env.ANDROID_SDK_ROOT||'D:\\Program\\Android\\SDK';
const java=path.join(process.env.JAVA_HOME||'D:\\Program\\Android\\Android Studio\\jbr','bin','java.exe');
const signer=path.join(sdk,'build-tools','36.0.0','lib','apksigner.jar');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const checks=[],check=(condition,name)=>{assert.ok(condition,name);checks.push(name);console.log('PASS '+name);};
let c,original,originalOnline,originalPermission,fixture,mediaBefore,studyBefore,inspirationBefore,mainError,oldCertificate,targetCertificate;
let installedTarget=false,restoredStudy=false,restoredOnline=false,restoredPermission=false;
const cleanupErrors=[];
const nativeState=()=>c.evaluate('JSON.parse(Native.getState())');
const nativeMedia=()=>c.evaluate('JSON.parse(Native.getInspiration("daily",0,50))');
const parseNative=(result,name)=>{assert.ok(result&&!result.error,name+': '+(result&&result.error));return result;};
function cert(apk){const output=execFileSync(java,['-jar',signer,'verify','--print-certs',apk],{encoding:'utf8'});const found=/Signer #1 certificate SHA-256 digest:\s*([a-f\d]+)/i.exec(output);assert.ok(found,'APK certificate digest');return found[1].toLowerCase();}
function rawPrivate(file){return android('shell','run-as',pkg,'cat','files/'+file);}
function privateImageDigests(meta){const images={};for(const card of Object.values(meta.cards)){assert.match(card.imageKey,/^[a-f\d]{64}\.(png|jpg)$/);if(!images[card.imageKey]){const result=android('shell','run-as',pkg,'sha256sum','files/inspiration-media/'+card.imageKey);const found=/^([a-f\d]{64})\s/.exec(result);assert.ok(found,'image digest '+card.imageKey);images[card.imageKey]=found[1];}assert.equal(images[card.imageKey],card.imageHash,'real image bytes match stored digest');}return images;}
function installedInfo(){const output=android('shell','dumpsys','package',pkg);return {version:/\bversionName=([^\s]+)/.exec(output)?.[1],versionCode:Number(/\bversionCode=(\d+)/.exec(output)?.[1])};}
function disconnect(){if(c)c.close();c=null;}
async function launch(){disconnect();android('shell','am','force-stop',pkg);android('shell','am','start','-W','-n',pkg+'/.MainActivity');let lastError;for(let i=0;i<40;i++){try{c=await connect();if(await c.evaluate('!!(window.StudyUI&&window.InspirationUI)')){await c.evaluate('InspirationUI.back()');await delay(150);return;}}catch(error){lastError=error;}disconnect();await delay(150);}throw lastError||new Error('APK WebView did not load');}
async function save(value){const before=parseNative(await nativeState(),'read study state');value=structuredClone(value);value._revision=before._revision||0;const result=await c.evaluate('JSON.parse(Native.saveState('+JSON.stringify(JSON.stringify(value))+'))');assert.ok(result.ok,result.error||'save failed');return parseNative(await nativeState(),'read saved state');}
function withoutRevision(value){value=structuredClone(value);delete value._revision;return value;}
function dayAfter(day,days){const date=new Date(day+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function subject(minutes,content='',problem='',newWords=null,reviewWords=null,forgotWords=''){return {minutes,content,problem,newWords,reviewWords,forgotWords};}
function representativeState(){const value=JSON.parse(fs.readFileSync(path.join(root,'app/src/main/assets/seed.json'),'utf8'));const first=value.plan.subjects[0].id,second=value.plan.subjects[1].id,custom='upgrade_custom',day=value.plan.startDate;
  value.plan.title='覆盖升级验证计划';value.plan.startWeek=9;
  value.plan.subjects.push({id:custom,name:'新增科目',kind:'custom',defaults:[0,5,10,15,20,25,30]});
  value.plan.targets[day][first]=32.5;value.plan.targets[day][second]=0;value.plan.targets[day][custom]=15;
  value.plan.weekGoals[day]='自定义周目标';value.plan.weekHints[day]='原有周备注';
  value.records={};
  value.records[day]={subjects:{[first]:subject(null,'尚未计时','保留的问题'),[second]:subject(0,'明确记录 0','',0,null,'容易忘记的词'),[custom]:subject(null)},status:null,restKept:null,note:'零与空值分别保留'};
  value.records[dayAfter(day,1)]={subjects:{[first]:subject(17.5,'部分科目记录','例题疑问'),[second]:subject(null),[custom]:subject(null)},status:'减量',restKept:true,note:'部分记录与小数分钟'};
  value.records[dayAfter(day,2)]={subjects:{[first]:subject(0),[second]:subject(0,'词数原样保留','',12,28,'word'),[custom]:subject(0)},status:'正常参考',restKept:false,note:'全部显式零'};
  value.records[dayAfter(day,3)]={subjects:{[first]:subject(null),[second]:subject(null),[custom]:subject(null)},status:'休息',restKept:true,note:'休息不写零'};
  value.records[dayAfter(day,4)]={subjects:{[first]:subject(0),[second]:subject(5,'复习旧词'),[custom]:subject(null)},status:'仅回顾',restKept:null,note:'保留存储枚举'};
  value.reviews={
    [day]:{load:'低强度',mathProblem:'原有复盘问题',vocabReview:'复习旧词',adjustment:'减量',reason:'课程较忙',halfDayRest:true},
    [dayAfter(day,7)]:{load:'',mathProblem:'',vocabReview:'',adjustment:'顺延',reason:'',halfDayRest:null},
    [dayAfter(day,14)]:{load:'中等',mathProblem:'待复习',vocabReview:'',adjustment:'',reason:'安排调整',halfDayRest:false}
  };
  value.sessions=[{id:'upgrade_completed_session',date:dayAfter(day,1),subjectId:first,seconds:1050,endedAt:dayAfter(day,1)+'T12:30:00Z'}];
  value.settings.reminders={enabled:true,weekdayTime:'19:05',weekendTime:'10:16'};return value;
}
(async()=>{try{
  for(const file of [previousApk,targetApk,java,signer])assert.ok(fs.existsSync(file),'Required file exists: '+file);
  assert.notEqual(version,previousVersion,'target differs from v1.1 source');fs.mkdirSync(reportDir,{recursive:true});fs.mkdirSync(recoveryDir,{recursive:true});
  oldCertificate=cert(previousApk);targetCertificate=cert(targetApk);check(oldCertificate===targetCertificate,'v1.1 and target APK certificates are identical');
  await launch();original=parseNative(await nativeState(),'original learning state');const timer=parseNative(await c.evaluate('JSON.parse(Native.getTimer())'),'current timer');assert.ok(!timer.active,'Do not interrupt an active timer; finish or cancel it before upgrade testing');
  const platform=parseNative(await c.evaluate('JSON.parse(Native.getPlatformInfo())'),'platform');originalPermission=platform.runtimePermissionGranted??platform.notificationsGranted;
  let media=parseNative(await nativeMedia(),'original media');originalOnline=media.online;
  check(media.cached>0,'existing genuine downloaded images available for upgrade verification');
  assert.ok(media.daily&&media.favorites>0,'Run the genuine daily-card/favorite test first; upgrade checks require existing daily and favorite IDs');
  fs.writeFileSync(path.join(recoveryDir,'original-study-state.json'),JSON.stringify(original,null,2));
  const offline=parseNative(await c.evaluate('JSON.parse(Native.setInspirationOnline(false))'),'pause online preparation');assert.ok(offline.ok);
  for(let i=0;i<120;i++){media=parseNative(await nativeMedia(),'preparation status');if(!media.fetching)break;await delay(250);}assert.ok(!media.fetching,'Existing network preparation finished before upgrade');
  // No notification dialog should obscure the v1.1 save path. The original grant is restored below.
  android('shell','pm','grant',pkg,'android.permission.POST_NOTIFICATIONS');disconnect();android('shell','am','force-stop',pkg);
  android('install','-r','-d',previousApk);await launch();check(installedInfo().version===previousVersion,'known local v1.1 test APK is installed before preparing upgrade state');
  fixture=await save(representativeState());check(fixture.records[fixture.plan.startDate].subjects.math.minutes===null&&fixture.records[fixture.plan.startDate].subjects.vocab.minutes===0,'v1.1 saves null and explicit zero as distinct values');
  disconnect();android('shell','am','force-stop',pkg);
  studyBefore=rawPrivate('study-state.json');inspirationBefore=rawPrivate('inspiration.json');mediaBefore=JSON.parse(inspirationBefore);
  const imagesBefore=privateImageDigests(mediaBefore);check(Object.keys(imagesBefore).length>0,'pre-upgrade image bytes agree with all recorded image digests');
  fs.writeFileSync(path.join(recoveryDir,'pre-upgrade-study-state.json'),studyBefore);fs.writeFileSync(path.join(recoveryDir,'pre-upgrade-inspiration.json'),inspirationBefore);
  android('install','-r',targetApk);installedTarget=true;
  check(installedInfo().version===version&&installedInfo().versionCode===versionCode,'cover install reports manifest version and versionCode');
  check(rawPrivate('study-state.json')===studyBefore,'cover install preserves complete learning file and revision before first launch');
  check(rawPrivate('inspiration.json')===inspirationBefore,'cover install preserves complete media metadata before first launch');
  assert.deepEqual(privateImageDigests(JSON.parse(rawPrivate('inspiration.json'))),imagesBefore);check(true,'cover install preserves every downloaded image byte digest');
  await launch();const upgraded=parseNative(await nativeState(),'upgraded learning state');assert.deepEqual(upgraded,fixture);check(true,'first target launch preserves plan, all subject fields, nulls, zeros, arrangements, reviews, reminders and completed sessions');
  const mediaAfter=JSON.parse(rawPrivate('inspiration.json'));
  for(const [id,card]of Object.entries(mediaBefore.cards))assert.deepEqual(mediaAfter.cards[id],card,'retained card '+id);
  check(true,'first launch preserves existing card IDs, text/image attribution and favorite flags');
  const afterEvents=new Map(mediaAfter.events.map(event=>[event.id,event]));for(const event of mediaBefore.events)assert.deepEqual(afterEvents.get(event.id),event,'retained history '+event.id);
  check(true,'first launch preserves every daily and startup history ID and record');
  for(const [date,id]of Object.entries(mediaBefore.daily))assert.equal(mediaAfter.daily[date],id,'retained daily '+date);check(true,'first launch preserves fixed daily card date indexes');
  const imagesAfter=privateImageDigests(mediaAfter);for(const [image,digest]of Object.entries(imagesBefore))assert.equal(imagesAfter[image],digest);check(true,'first launch retains genuine picture bytes alongside metadata');
  const beforeFavoriteIds=Object.values(mediaBefore.cards).filter(card=>card.favorite).map(card=>card.id).sort();const afterFavoriteIds=Object.values(mediaAfter.cards).filter(card=>card.favorite).map(card=>card.id).sort();assert.deepEqual(afterFavoriteIds,beforeFavoriteIds);check(true,'favorite ID set is unchanged by cover upgrade');
  const today=await nativeMedia();check(today.daily?.id===(mediaBefore.daily[today.today]||undefined),'fixed card for today is unchanged when one existed before upgrade');
  check(c.events.filter(event=>event.method==='Runtime.exceptionThrown').length===0,'no uncaught target WebView exception after cover upgrade');
}catch(error){mainError=error;}finally{
  // Always return to the target build, even if downgrade or a comparison failed.
  try{disconnect();if(installedInfo().version!==version){android('install','-r',targetApk);}installedTarget=installedInfo().version===version;await launch();
    if(original){const restored=await save(original);assert.deepEqual(withoutRevision(restored),withoutRevision(original));restoredStudy=true;}
    if(typeof originalOnline==='boolean'){const result=parseNative(await c.evaluate('JSON.parse(Native.setInspirationOnline('+originalOnline+'))'),'restore online setting');assert.ok(result.ok);assert.equal((await nativeMedia()).online,originalOnline);restoredOnline=true;}
  }catch(error){cleanupErrors.push(error.message);}finally{disconnect();}
  if(typeof originalPermission==='boolean'){try{android('shell','pm',originalPermission?'grant':'revoke',pkg,'android.permission.POST_NOTIFICATIONS');restoredPermission=true;}catch(error){cleanupErrors.push(error.message);}}
  const report={fromVersion:previousVersion,toVersion:version,versionCode,platform:'Android16/API36 actual APK WebView',passed:checks.length,checks,apkSha256:{source:fs.existsSync(previousApk)?hash(fs.readFileSync(previousApk)):null,target:fs.existsSync(targetApk)?hash(fs.readFileSync(targetApk)):null},certificateSha256:{source:oldCertificate||null,target:targetCertificate||null},preserved:{studyHash:studyBefore?hash(Buffer.from(studyBefore)):null,mediaMetadataHash:inspirationBefore?hash(Buffer.from(inspirationBefore)):null,cards:mediaBefore?Object.keys(mediaBefore.cards).length:null,historyIds:mediaBefore?.events.length??null,favoriteIds:mediaBefore?Object.values(mediaBefore.cards).filter(card=>card.favorite).map(card=>card.id):[]},cleanup:{installedTarget,restoredStudy,restoredOnline,restoredPermission,errors:cleanupErrors},unverified:['Physical vivo X100s installation is not tested'],error:mainError?.message||null};
  fs.mkdirSync(reportDir,{recursive:true});fs.writeFileSync(path.join(reportDir,'upgrade-ui-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
if(mainError)throw mainError;if(cleanupErrors.length)throw new Error('Upgrade cleanup failed: '+cleanupErrors.join('; '));
})().catch(error=>{console.error(error);process.exitCode=1;});
