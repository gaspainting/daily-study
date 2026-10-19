'use strict';
// Responsive measurements use the actual signed APK on the owned emulator.
const {connect,android,delay}=require('./cdp-client.cjs');
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const M=require('../app/src/main/assets/model.js'),pkg='cn.edu.njupt.studycheckin',base='/data/user/0/'+pkg;
const root=path.resolve(__dirname,'..'),version=/android:versionName="([^"]+)"/.exec(fs.readFileSync(path.join(root,'app/src/main/AndroidManifest.xml'),'utf8'))[1];
const baseline=process.env.PLAN_LAYOUT_BASELINE==='1',report=path.join(root,'docs/validation-v'+version),shots=path.join(root,'docs/screenshots/v'+version);
const adb=path.join(process.env.ANDROID_SDK_ROOT,'platform-tools/adb.exe'),serial=process.env.ANDROID_SERIAL||'emulator-5572';
let c,failure;const checks=[],metrics=[],saved=new Map(),check=(ok,name)=>{assert.ok(ok,name);checks.push(name);console.log('PASS '+name);};
const oldFont=android('shell','settings','get','system','font_scale');
const shell=s=>android('shell',s),read=f=>cp.execFileSync(adb,['-s',serial,'exec-out','cat',base+'/'+f]);
const write=(f,b)=>{
 const owner=android('shell','stat','-c','%u:%g',base);
 cp.execFileSync(adb,['-s',serial,'shell','base64 -d > '+base+'/'+f],{input:Buffer.from(b.toString('base64')+'\n','ascii')});
 android('shell','chown',owner,base+'/'+f);
};
const native=(n,...args)=>c.evaluate(`JSON.parse(Native[${JSON.stringify(n)}](...${JSON.stringify(args)}))`);
async function boot(){if(c)c.close();c=null;android('shell','am','force-stop',pkg);android('shell','am','start','-W','-n',pkg+'/.MainActivity');for(let i=0;i<35;i++){try{c=await connect();if(await c.evaluate('!!window.StudyUI'))break;c.close();c=null;}catch{}await delay(150);}assert.ok(c);await c.evaluate('InspirationUI.back()');}
const click=async s=>{await c.evaluate(`document.querySelector(${JSON.stringify(s)}).click()`);await delay(150);};
async function openPlan(){await click('.bottom-nav [data-nav=plan]');for(let n=0;n<110&&await c.evaluate('!!document.querySelector("[data-action=week-prev]:not(:disabled)")');n++)await click('[data-action=week-prev]');}
async function shot(name){await c.evaluate('document.querySelector(".week-list").scrollIntoView({block:"start"})');await delay(500);android('shell','screencap','-p','/sdcard/plan-layout.png');android('pull','/sdcard/plan-layout.png',path.join(shots,name+'.png'));}
function fixture(){const state=M.migrateState(JSON.parse(fs.readFileSync(path.join(root,'app/src/main/assets/seed.json'),'utf8')),'2026-10-15');
 for(const [date,value]of [['2026-10-12',45],['2026-10-13',75],['2026-10-14',90]]){const r=M.record(state,date);r.subjects.math.minutes=value;r.subjects.vocab.newWords=0;r.subjects.vocab.reviewWords=0;r.status='减量';M.saveRecord(state,date,r);}
 let r=M.record(state,'2026-10-15');r.subjects['course-review'].minutes=0;r.status='休息';M.saveRecord(state,'2026-10-15',r);
 r=M.record(state,'2026-10-17');r.subjects['course-review'].minutes=0;r.subjects.math.minutes=0;r.subjects.vocab.newWords=0;r.subjects.vocab.reviewWords=0;M.saveRecord(state,'2026-10-17',r);
 r=M.record(state,'2026-10-18');r.note='周末随记';r.status='休息';M.saveRecord(state,'2026-10-18',r);return state;
}
async function measurements(){return c.evaluate(`Array.from(document.querySelectorAll('.week-list>.plan-day')).map(row=>{
 const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
 const meta=row.querySelector('.plan-day-meta'),ref=row.querySelector('.plan-day-subjects'),state=row.querySelector('.plan-day-state');
 return {date:row.dataset.date,row:rect(row),meta:rect(meta),reference:rect(ref),state:rect(state),arrow:rect(row.querySelector('svg')),text:row.innerText,summary:state.innerText};})`);}
async function verify(width,scale,label){await c.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});await delay(100);
 const rows=await measurements();metrics.push({label,width,fontScale:scale,rows});
 if(baseline)return;
 check(await c.evaluate('document.documentElement.scrollWidth<=innerWidth'),label+' no page overflow');
 check(rows.every(r=>r.meta.w>=Math.min(170,width*.5)),label+' reference text keeps a readable column');
 check(rows.every(r=>r.state.y>=r.meta.bottom-1&&Math.abs(r.state.x-r.meta.x)<1),label+' saved summary sits below reference text');
 check(rows.every(r=>r.row.h>=44&&r.arrow.right<=r.row.right+1&&r.reference.right<=r.row.right+1),label+' full row remains tappable and content fits');
 check(rows[0].summary.includes('45 分钟')&&rows[0].summary.includes('新学 0 个')&&rows[0].summary.includes('2/2'),label+' saved minute and quantity values remain visible');
 check(rows[3].summary.includes('1/3')&&rows[3].summary.includes('0 分钟')&&!rows[3].summary.includes('未学习'),label+' partial zero remains distinct from a complete zero day');
 check(rows[4].summary.includes('未记录')&&rows[5].summary.includes('0 分钟')&&rows[5].summary.includes('3/3'),label+' unknown and fully recorded zero keep distinct states');
 check(rows[4].summary.split('未记录').length===2,label+' unknown status is shown once');
}
(async()=>{try{
 fs.mkdirSync(report,{recursive:true});fs.mkdirSync(shots,{recursive:true});assert.equal(serial,'emulator-5572');assert.match(android('shell','id'),/uid=0/);
 android('shell','am','force-stop',pkg);
 for(const f of ['files/study-state.json','files/plans.json','files/drafts.json','shared_prefs/stopwatch.xml'])saved.set(f,shell('if [ -f '+base+'/'+f+' ]; then echo yes; else echo no; fi')==='yes'?read(f):null);
 const state=fixture();write('files/study-state.json',Buffer.from(JSON.stringify(state)));shell('rm -f '+base+'/files/drafts.json');
 android('shell','settings','put','system','font_scale','1.0');await boot();const info=await native('getAppInfo');
 if(!baseline)check(info.versionName===version,'actual installed APK matches the build version');
 await openPlan();await verify(390,1,'390px default text');await shot(baseline?'plan-before':'plan-recorded');
 if(baseline){check(metrics[0].rows[0].meta.w<100,'original signed APK reproduces squeezed reference column');}
 else{
  for(const width of [320,360,430,760])await verify(width,1,width+'px default text');
  const ax=await c.call('Accessibility.getFullAXTree');check(state.plan.startDate&&ax.nodes.some(n=>!n.ignored&&n.role?.value==='button'&&n.name?.value.includes('2026.10.12')),'plan date buttons retain accessible names');
  const before=JSON.stringify((await native('getState')).records);await click('.plan-day[data-date="2026-10-12"]');
  check(await c.evaluate('document.querySelector("#minutes-math").value==="45"&&document.querySelector("#newWords-vocab").value==="0"'),'tapping a completed day opens its original values');
  check(JSON.stringify((await native('getState')).records)===before,'opening the plan and date does not rewrite saved records');
  for(const scale of [1.3,1.5,2]){
   android('shell','settings','put','system','font_scale',String(scale));await boot();await openPlan();
   check(Math.abs((await native('getPlatformInfo')).fontScale-scale)<.01,'actual system font scale '+scale+' reaches WebView');
   await verify(320,scale,'320px '+scale+'x system font');if(scale===2)await shot('plan-large-text');
  }
  android('shell','settings','put','system','font_scale','1.0');android('shell','am','force-stop',pkg);c.close();c=null;
  const long=fixture();for(const name of ['专业课程复习与作业整理以及课堂笔记回顾','ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD','物理光学与激光原理'])M.addSubject(long,name,[15,15,15,15,15,15,15],'2026-10-15');
  write('files/study-state.json',Buffer.from(JSON.stringify(long)));await boot();await openPlan();await c.call('Emulation.setDeviceMetricsOverride',{width:320,height:900,deviceScaleFactor:1,mobile:true});
  const many=await measurements(),today=many.find(r=>r.date==='2026-10-15');
  check(today.text.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD')&&today.meta.w>=160,'six subjects and a long name remain intact in the reference column');
  check(await c.evaluate('document.documentElement.scrollWidth<=innerWidth'),'long subject names do not overflow the page');
  check(today.state.y>=today.meta.bottom-1,'long subject references do not collide with actual summary');
  await c.evaluate('Array.from(document.querySelectorAll(".plan-day")).find(el=>el.dataset.date==="2026-10-15").scrollIntoView({block:"center"})');await delay(250);
  android('shell','screencap','-p','/sdcard/plan-long.png');android('pull','/sdcard/plan-long.png',path.join(shots,'plan-long-subjects.png'));
  check(c.events.filter(e=>e.method==='Runtime.exceptionThrown').length===0,'plan layout interactions have no uncaught WebView exceptions');
 }
 }catch(e){failure=e;console.error(e);}finally{
  if(c)c.close();try{android('shell','am','force-stop',pkg);for(const[f,data]of saved){if(data===null)shell('rm -f '+base+'/'+f);else write(f,data);}for(const[f,data]of saved)if(data)assert.deepEqual(read(f),data);
   android('shell','settings','put','system','font_scale',oldFont==='null'?'1.0':oldFont);checks.push('original learning files and system font setting restored');
  }catch(e){failure=failure||e;console.error(e);}
  fs.writeFileSync(path.join(report,baseline?'plan-layout-baseline.json':'plan-layout-results.json'),JSON.stringify({version,baseline,checks,passed:checks.length,metrics,error:failure?.stack||null},null,2));
 }if(failure)throw failure;console.log('PASS '+checks.length+' checks');})().catch(e=>{console.error(e);process.exitCode=1;});
