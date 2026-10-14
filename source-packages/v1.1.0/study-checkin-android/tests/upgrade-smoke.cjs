'use strict';
const {connect,android,delay}=require('./cdp-client.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
let c,original;const checks=[];const check=(b,m)=>{assert.ok(b,m);checks.push(m);};
async function launch(){android('shell','pm','grant','cn.edu.njupt.studycheckin','android.permission.POST_NOTIFICATIONS');android('shell','input','keyevent','4');android('shell','am','force-stop','cn.edu.njupt.studycheckin');android('shell','am','start','-W','-n','cn.edu.njupt.studycheckin/.MainActivity');await delay(500);for(let i=0;i<15;i++){try{c=await connect();break;}catch{await delay(160);}}if(!c)throw Error('APK process did not start');for(let i=0;i<30;i++){if(await c.evaluate('!!window.StudyUI'))return;await delay(100);}throw Error('UI did not load');}
const nativeState=()=>c.evaluate('JSON.parse(Native.getState())');
(async()=>{try{
  android('install','-r','-d',path.join(__dirname,'../dist/每日学习-v1.0.0-test.apk'));await launch();original=await nativeState();
  let sample=structuredClone(original);sample.records['2026-10-12']={subjects:{math:{minutes:17.5,content:'覆盖升级保留测试',problem:'原有问题记录',newWords:null,reviewWords:null,forgotWords:''},vocab:{minutes:0,content:'明确未学习',problem:'',newWords:0,reviewWords:null,forgotWords:''}},status:'减量',restKept:true,note:'v1.0数据应原样保留'};
  sample.reviews['2026-10-12']={load:'低强度',mathProblem:'原有复盘',vocabReview:'复习旧词',adjustment:'减量',reason:'课程较忙',halfDayRest:true};sample.settings.reminders.enabled=false;sample.settings.reminders.weekdayTime='19:05';
  const saved=await c.evaluate(`JSON.parse(Native.saveState(${JSON.stringify(JSON.stringify(sample))}))`);check(saved.ok,'v1.0 saves representative learning/review/settings data');sample=await nativeState();c.close();c=null;
  android('install','-r',path.join(__dirname,'../dist/每日学习-v1.1.0-test.apk'));await launch();const upgraded=await nativeState();check(JSON.stringify(upgraded)===JSON.stringify(sample),'cover upgrade to v1.1 preserves entire v1.0 state and revision');
  check(upgraded.records['2026-10-12'].subjects.math.minutes===17.5&&upgraded.records['2026-10-12'].subjects.vocab.minutes===0,'upgrade keeps actual minutes and explicit zero');
  check(upgraded.reviews['2026-10-12'].halfDayRest===true&&upgraded.settings.reminders.weekdayTime==='19:05','upgrade keeps review and reminder preferences');
  const daily=await c.evaluate(`JSON.parse(Native.getInspiration('daily',0,1))`);check(daily&&daily.today,'daily-card module available after covering old APK');
  check(android('shell','dumpsys','package','cn.edu.njupt.studycheckin').includes('versionName=1.1.0'),'installed package reports v1.1.0');
  fs.writeFileSync(path.join(__dirname,'../docs/upgrade-test-results.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}finally{if(c){if(original){const current=await nativeState();original._revision=current._revision||0;await c.evaluate(`JSON.parse(Native.saveState(${JSON.stringify(JSON.stringify(original))}))`);}c.close();}}})().catch(e=>{console.error(e);process.exitCode=1;});
