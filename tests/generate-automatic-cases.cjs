'use strict';
const fs=require('node:fs'),path=require('node:path'),E=require('../app/src/main/assets/evaluation.js');
const date='2026-10-27',at='2026-10-26T04:00:00.000Z';
function build(options={}){
 const c=E.defaultConfig(options.type||'study');if(c.type==='review'){c.reviewMin=options.min??45;c.reviewMax=options.max??60;c.reviewWords=options.reviewGoal??80;}if(options.referenceOnly)c.requiredTime=false;
 const subjects=[{id:'math',name:'高数',kind:'math',defaults:Array(7).fill({min:options.type==='review'||options.inferredReview?0:options.min??60,max:options.type==='review'||options.inferredReview?0:options.max??120})},{id:'course-review',name:'课程复习',kind:'custom',defaults:Array(7).fill(options.type==='review'||options.inferredReview?{min:options.min??45,max:options.max??60}:0)},{id:'vocab',name:'单词',kind:'vocab',wordGoal:options.newGoal??0,defaults:Array(7).fill(0)}];
 if(options.quantityGoal!==undefined)subjects.push({id:'practice',name:'练习',kind:'custom',measure:'quantity',unit:'题',defaults:Array(7).fill(options.quantityGoal)});
 const state={plan:{startDate:'2026-10-26',endDate:'2026-11-02',subjects,targets:{}},records:{}};
 const basis=E.snapshot(state,date,c,'default',1,at,'Asia/Shanghai');
 const entry=()=>({minutes:null,newWords:null,reviewWords:null,content:'',problem:'',forgotWords:''});
 const record=options.absent?null:{subjects:Object.fromEntries(subjects.map(s=>[s.id,entry()])),status:options.oldStatus??null,restKept:null,note:''};
 if(record){record.subjects.math.minutes=options.type==='review'?options.extraMath??0:options.minutes??null;record.subjects['course-review'].minutes=options.type==='review'?options.minutes??null:options.courseMinutes??0;record.subjects.vocab.newWords=options.newWords??(options.newGoal?null:0);record.subjects.vocab.reviewWords=options.reviewWords??0;if(options.quantityGoal!==undefined)Object.assign(record.subjects.practice,{quantity:options.quantity??null,quantityUnit:options.actualUnit||'题'});}
 return {basis,record,recordRevision:1,phase:'closed'};
}
const cases=[];
function add(name,options,expected){cases.push({name,...build(options),expected});}
for(const [minutes,level]of [[0,'zero'],[59,'partialGoal'],[60,'basic'],[79,'basic'],[80,'standard'],[90,'standard'],[99,'standard'],[100,'full'],[120,'full'],[121,'excess']])add('60—120 minutes / '+minutes,{minutes},{timeLevel:level,kind:minutes>=60?'within':'below',complete:true});
add('fixed interval endpoint',{min:60,max:60,minutes:60},{timeLevel:'exact',kind:'within'});
add('zero reference is not rest or an achievement',{min:0,max:0,minutes:20},{timeLevel:'reference',kind:'range',achieved:false});
add('all missing',{absent:true,newGoal:40},{kind:'empty',complete:false});
add('known zero plus missing words',{minutes:0,newGoal:40},{kind:'partial',complete:false});
add('time success cannot compensate word shortfall',{minutes:110,newGoal:40,newWords:20},{kind:'below',complete:true});
add('unit mismatch',{minutes:90,quantityGoal:3,quantity:3,actualUnit:'页'},{kind:'pending',complete:false});
add('integer quantity not rounded up',{minutes:90,quantityGoal:3,quantity:2},{kind:'below',complete:true});
add('ordinary day only review keeps normal requirements',{minutes:0,courseMinutes:35,newGoal:40,newWords:0,reviewWords:80},{kind:'below',activity:'仅回顾'});
add('missing new words does not establish only review',{minutes:0,courseMinutes:35,newGoal:40,reviewWords:80},{kind:'partial',activity:'已记录回顾'});
add('planned review reaches both goals plus extra new words',{type:'review',minutes:50,reviewWords:80,newWords:5},{kind:'within',label:'回顾日达标',activity:'回顾与其他学习'});
add('planned review time below fixed lower bound',{type:'review',minutes:20,reviewWords:80},{kind:'below'});
add('planned review missing time',{type:'review',reviewWords:80},{kind:'partial'});
add('planned rest with extra learning',{type:'rest',minutes:20},{kind:'rest',achieved:false});
add('old rest selector cannot exempt an ordinary day',{minutes:0,newGoal:40,newWords:0,oldStatus:'休息'},{kind:'below'});
add('old reduced selector cannot halve requirements',{minutes:40,newGoal:40,newWords:40,oldStatus:'减量'},{kind:'below'});
add('review-only extra record with all required inputs blank',{newGoal:40,courseMinutes:null,reviewWords:80},{kind:'partial',recordState:'待补全',activity:'已记录回顾'});
add('all required zero is incomplete rather than partial success',{minutes:0,newGoal:40,newWords:0},{kind:'below',label:'必达目标未完成',complete:true});
add('inferred review cannot replace required review time with extra new learning',{inferredReview:true,minutes:90,courseMinutes:0,newGoal:0},{dayType:'review',kind:'below',timeLevel:'zero'});
add('zero cannot achieve a positive target below the comparison resolution',{min:0.00000001,max:0.00000001,minutes:0},{kind:'below',achieved:false,timeLevel:'zero'});
const out=path.join(__dirname,'fixtures/automatic-assessment-cases.json');fs.writeFileSync(out,JSON.stringify(cases,null,2)+'\n');console.log(cases.length+' shared automatic-assessment cases generated');
