'use strict';
const {connect,android,delay}=require('./cdp-client.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let c;const checks=[];const check=(b,m)=>{assert.ok(b,m);checks.push(m);};
function nodes(){const dumped=android('shell','uiautomator','dump','/sdcard/study-backup-ui.xml');if(!dumped.includes('dumped'))throw Error('Native UI hierarchy not ready: '+dumped);const xml=android('shell','cat','/sdcard/study-backup-ui.xml');return [...xml.matchAll(/<node\s+([^>]+)>/g)].map(m=>Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(x=>[x[1],x[2]])));}
function tap(node){if(!node)throw Error('Native control not found');const xy=[...node.bounds.matchAll(/\d+/g)].map(m=>Number(m[0]));android('shell','input','tap',String(Math.round((xy[0]+xy[2])/2)),String(Math.round((xy[1]+xy[3])/2)));}
const study=()=>c.evaluate('JSON.parse(Native.getState())'),cards=()=>c.evaluate(`JSON.parse(Native.getInspiration('daily',0,20))`);
const withoutRevision=s=>{s=structuredClone(s);delete s._revision;return s;};
(async()=>{try{
  c=await connect();const original=await study(),before=await cards(),startup=(await c.evaluate('InspirationUI.snapshot()')).startupId;check(!!before.daily,'backup scenario contains a real daily image and favorite');
  let ui=nodes();if(!ui.some(n=>n.text==='SAVE')){await c.evaluate(`InspirationUI.back();document.querySelector('.bottom-nav [data-nav="settings"]').click();document.querySelector('[data-action="export-backup"]').click()`);await delay(700);ui=nodes();}
  const filename=ui.find(n=>n.text&&n.text.endsWith('.zip')&&n['resource-id']==='android:id/title').text;check(filename.endsWith('.zip'),'Android create-document picker requests complete ZIP');tap(ui.find(n=>n.text==='SAVE'));await delay(700);
  const local=path.join(__dirname,'../tmp/actual-complete-backup.zip');android('pull','/sdcard/Download/'+filename,local);const bytes=fs.readFileSync(local);check(bytes[0]===80&&bytes[1]===75&&bytes.length>1000,'system picker wrote a nonempty actual ZIP file');
  check(!(await c.evaluate('InspirationUI.snapshot()')).splashVisible,'return from export picker does not replay splash');
  await c.evaluate(`(()=>{Native.favoriteInspiration(${JSON.stringify(before.daily.id)},false);const s=JSON.parse(Native.getState()),day=StudyModel.today(),r=StudyModel.record(s,day);r.note='系统备份恢复验证临时手记';StudyModel.saveRecord(s,day,r);Native.saveState(JSON.stringify(s));})()`);check(!(await cards()).daily.card.favorite,'temporary favorite change is visible before restore');
  await c.evaluate('Native.importBackup()');await delay(600);ui=nodes();let file=ui.find(n=>n.text===filename);if(!file){tap(ui.find(n=>n['content-desc']==='Show roots'));await delay(180);ui=nodes();tap(ui.find(n=>n.text==='Downloads'));await delay(300);ui=nodes();file=ui.find(n=>n.text===filename);}tap(file);await delay(650);ui=nodes();check(ui.some(n=>n.text==='确认恢复备份')&&ui.some(n=>n.text.includes('图文历史')),'native restore dialog reports image history before replacement');tap(ui.find(n=>n.text==='恢复备份'));
  for(let i=0;i<30;i++){if(JSON.stringify(withoutRevision(await study()))===JSON.stringify(withoutRevision(original)))break;await delay(180);}
  check(JSON.stringify(withoutRevision(await study()))===JSON.stringify(withoutRevision(original)),'actual SAF ZIP import restores complete learning fields');const restored=await cards();check(restored.daily.id===before.daily.id&&restored.daily.card.favorite===before.daily.card.favorite,'actual ZIP import restores fixed daily and favorite');
  check((await c.evaluate('InspirationUI.snapshot()')).startupId===startup&&!(await c.evaluate('InspirationUI.snapshot()')).splashVisible,'import confirmation does not create another startup');
  fs.writeFileSync(path.join(__dirname,'../docs/backup-ui-test-results.json'),JSON.stringify({passed:checks.length,checks,fileBytes:bytes.length},null,2));console.log(JSON.stringify({passed:checks.length,checks,fileBytes:bytes.length},null,2));
}finally{if(c)c.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
