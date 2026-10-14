'use strict';
const {android,delay}=require('./cdp-client.cjs');
function nodes(){let out;try{out=android('shell','uiautomator','dump','/sdcard/daily-release-ui.xml');}catch(error){
  // Some API 36 emulator runs kill the dump process after its successful write.
  // Accept only this invocation's explicit completion; never reuse a stale dump.
  out=String(error.stdout||'');if(!out.includes('UI hierchary dumped to: /sdcard/daily-release-ui.xml'))throw error;
}if(!out.includes('dumped'))throw Error(out);const xml=android('shell','cat','/sdcard/daily-release-ui.xml');if(!xml.includes('<hierarchy'))throw Error('Invalid UI hierarchy');return [...xml.matchAll(/<node\s+([^>]+)>/g)].map(m=>Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(x=>[x[1],x[2]])));}
function tap(node){if(!node)throw Error('Native control not found');const b=[...node.bounds.matchAll(/\d+/g)].map(x=>Number(x[0]));android('shell','input','tap',String(Math.round((b[0]+b[2])/2)),String(Math.round((b[1]+b[3])/2)));}
async function byText(text){for(let i=0;i<5;i++){const all=nodes(),node=all.find(n=>n.text===text||n['content-desc']===text);if(node){tap(node);return all;}await delay(150);}throw Error('Missing native text '+text);}
async function byId(id){const all=nodes();tap(all.find(n=>n['resource-id']===id));return all;}
module.exports={nodes,tap,byText,byId};
