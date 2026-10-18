'use strict';
// Formal APK cover-install and a real system-keyboard task save on the owned emulator.
const {android,delay}=require('./cdp-client.cjs'),ui=require('./native-ui.cjs');
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),pkg='cn.edu.njupt.studycheckin',serial=process.env.ANDROID_SERIAL||'emulator-5572';
const adb=path.join(process.env.ANDROID_SDK_ROOT,'platform-tools/adb.exe'),base='/data/user/0/'+pkg;
const report=path.join(root,'docs/validation-v1.4.0'),shots=path.join(root,'docs/screenshots/v1.4.0');
const checks=[],check=(v,n)=>{assert.ok(v,n);checks.push(n);console.log('PASS '+n);};
const oldStylus=android('shell','settings','get','secure','stylus_handwriting_enabled');
const write=(file,data)=>cp.execFileSync(adb,['-s',serial,'shell','cat > '+base+'/files/'+file],{input:data});
const read=file=>cp.execFileSync(adb,['-s',serial,'exec-out','cat',base+'/files/'+file]);
async function tapText(text){for(let i=0;i<9;i++){const n=ui.nodes().find(n=>{if(n.text!==text)return false;const b=[...n.bounds.matchAll(/\d+/g)].map(x=>Number(x[0]));return b[2]>b[0]&&b[3]>b[1]&&(text!=='关于'||(b[1]+b[3])/2<2000);});if(n){ui.tap(n);await delay(350);return;}android('shell','input','swipe','500','1750','500','650','300');await delay(150);}throw Error('Visible text not found: '+text);}
async function boot(){android('shell','am','force-stop',pkg);android('shell','am','start','-W','-n',pkg+'/.MainActivity');await delay(1700);const skip=ui.nodes().find(n=>n.text?.includes('跳过'));if(skip){ui.tap(skip);await delay(200);}}
function info(){const out=android('shell','dumpsys','package',pkg);return {version:/versionName=([^\s]+)/.exec(out)?.[1],code:Number(/versionCode=(\d+)/.exec(out)?.[1]),debuggable:/flags=\[[^\]]*DEBUGGABLE/.test(out)};}
(async()=>{let error;try{
 assert.equal(serial,'emulator-5572');assert.match(android('shell','id'),/uid=0/);android('shell','am','force-stop',pkg);
 android('shell','settings','put','secure','stylus_handwriting_enabled','0');
 const fixture=structuredClone(require('../app/src/main/assets/seed.json'));fixture.version=2;fixture._revision=7;fixture.plan.title='正式覆盖升级验证';fixture.plan.manualWeekGoals=true;fixture.plan.weekGoals={'2026-10-12':'保留我自己的教材与章节'};fixture.plan.weekHints={'2026-10-12':'正式升级前的随记'};
 const blank=minutes=>({minutes,content:'原学习内容',problem:'',newWords:null,reviewWords:null,forgotWords:''});
 fixture.records['2026-10-14']={subjects:{math:blank(0),vocab:blank(null)},status:'休息',restKept:null,note:'保留历史记录'};fixture.records['2026-10-14'].subjects.vocab.reviewWords=10;
 write('study-state.json',Buffer.from(JSON.stringify(fixture)));write('plans.json',Buffer.from(JSON.stringify({version:1,activeId:'main',items:[{id:'main',name:fixture.plan.title,state:null}]})));android('shell','rm','-f',base+'/files/drafts.json');
 android('install','-r','-d',path.join(root,'dist/每日学习-v1.3.5.apk'));await boot();check(info().version==='1.3.5','previous actual formal v1.3.5 APK launches before upgrade');
 const before=read('study-state.json');android('shell','am','force-stop',pkg);android('install','-r',path.join(root,'dist/每日学习-v1.4.0.apk'));
 check(read('study-state.json').equals(before),'same-signature cover install retains original state file byte for byte');
 check(info().version==='1.4.0'&&info().code===10&&!info().debuggable,'installed formal package is v1.4.0/code10 without debuggable flag');
 await boot();check(read('study-state.json').equals(before),'first launch reads a migrated view without rewriting legacy observations');
 await tapText('编辑本周目标');check(ui.nodes().some(n=>n.text==='保留我自己的教材与章节'),'formal task editor shows original self-written goal');
 await tapText('添加任务');await delay(500);for(const letter of 'UpgradeCheck'){android('shell','input','text',letter);await delay(80);}await delay(500);check(ui.nodes().some(n=>n.text==='UpgradeCheck'),'system key input reaches the task field in full');check(ui.nodes().some(n=>n.text==='UpgradeCheck，完成'),'renamed task checkbox exposes its current title to accessibility');
 // Android's keyboard can cover the bottom of a WebView while accessibility
 // still reports the obscured bounds. Navigate to the named button by keyboard.
 for(let i=0;i<5;i++){android('shell','input','keyevent','KEYCODE_TAB');await delay(80);}
 let focused=ui.nodes().find(n=>n.focused==='true');
 for(let i=0;i<12&&focused?.text!=='保存目标';i++){android('shell','input','keyevent','KEYCODE_TAB');await delay(80);focused=ui.nodes().find(n=>n.focused==='true');}
 check(focused?.text==='保存目标','keyboard navigation reaches the named save button');android('shell','input','keyevent','KEYCODE_ENTER');await delay(500);
 const saved=JSON.parse(read('study-state.json'));check(saved.version===3,'formal manual save persists the new schema');
 const items=saved.plan.weekTasks['2026-10-12'];check(items.length===1&&items[0].title==='UpgradeCheck'&&!items[0].done,'real Android keyboard task input is saved exactly once by formal APK');
 check(saved.plan.weekGoals['2026-10-12']==='保留我自己的教材与章节'&&saved.plan.weekHints['2026-10-12']==='正式升级前的随记','formal task save retains original goal and hint text');
 check(JSON.stringify(saved.records)===JSON.stringify(fixture.records),'formal upgrade and new task save preserve explicit zero unknown values rest state and vocabulary review');
 check(saved._revision===8,'formal task submit advances original revision exactly once');
 if(process.env.FORMAL_UPGRADE_SKIP_ABOUT!=='1'){await tapText('设置');await tapText('关于');check(ui.nodes().some(n=>n.text?.replace(/\s+/g,'').includes('版本1.4.0')),'About displays actual installed PackageInfo version');}
 android('shell','screencap','-p','/sdcard/v140-about.png');android('pull','/sdcard/v140-about.png',path.join(shots,'formal-upgrade.png'));
}catch(e){error=e;console.error(e);}finally{android('shell','am','force-stop',pkg);if(oldStylus==='null')android('shell','settings','delete','secure','stylus_handwriting_enabled');else android('shell','settings','put','secure','stylus_handwriting_enabled',oldStylus);fs.writeFileSync(path.join(report,'formal-upgrade-results.json'),JSON.stringify({passed:checks.length,checks,error:error?.stack||null,unverified:process.env.FORMAL_UPGRADE_SKIP_ABOUT==='1'?['Formal About UI locator; installed metadata and test APK getAppInfo are checked separately']:[]},null,2));if(error)process.exitCode=1;}})();
