/* Connect to the test APK's actual Android WebView; no browser dependencies. */
'use strict';
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const serial=process.env.ANDROID_SERIAL||'emulator-5572';
const adb=process.env.ANDROID_SDK_ROOT?path.join(process.env.ANDROID_SDK_ROOT,'platform-tools','adb.exe'):'adb';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function android(...args){return execFileSync(adb,['-s',serial,...args],{encoding:'utf8'}).trim();}
class CDP {
  constructor(socket){this.socket=socket;this.nextId=1;this.pending=new Map();this.events=[];
    socket.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.id){const pending=this.pending.get(msg.id);if(pending){this.pending.delete(msg.id);msg.error?pending.reject(new Error(JSON.stringify(msg.error))):pending.resolve(msg.result);}}else this.events.push(msg);});}
  call(method,params={}){return new Promise((resolve,reject)=>{const id=this.nextId++,timeout=setTimeout(()=>{this.pending.delete(id);reject(new Error('CDP timeout: '+method));},20000);this.pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}});this.socket.send(JSON.stringify({id,method,params}));});}
  async evaluate(expression){const data=await this.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(data.exceptionDetails)throw new Error(JSON.stringify(data.exceptionDetails));return data.result.value;}
  close(){this.socket.close();}
}
async function connect(){
  const pid=android('shell','pidof','cn.edu.njupt.studycheckin');if(!pid)throw new Error('Test APK is not running');
  android('forward','tcp:9229','localabstract:webview_devtools_remote_'+pid);
  let pages=[];
  for(let i=0;i<20;i++){try{pages=await(await fetch('http://127.0.0.1:9229/json')).json();if(pages.length)break;}catch{}await delay(200);}
  const page=pages.find(p=>p.type==='page');if(!page)throw new Error('No debuggable WebView');
  const socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const client=new CDP(socket);await client.call('Runtime.enable');await client.call('Log.enable');return client;
}
module.exports={connect,android,delay};
if(require.main===module){(async()=>{const client=await connect();try{console.log(JSON.stringify(await client.evaluate('({title:document.title,body:document.body.innerText,buttons:[...document.querySelectorAll("button")].map(x=>({text:x.innerText,id:x.id,action:x.dataset.action,nav:x.dataset.nav}))})'),null,2));}finally{client.close();}})().catch(e=>{console.error(e);process.exitCode=1;});}
