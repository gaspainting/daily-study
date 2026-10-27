(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.StudyBridgeContract=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const VERSION=1,OPERATIONS=['state.save','evaluation.schedule.save'];let sequence=0;
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k),clone=x=>JSON.parse(JSON.stringify(x));
 function fail(message){throw new Error(message);}
 function object(value,name){if(!value||typeof value!=='object'||Array.isArray(value))fail((name||'数据')+'格式无效');return value;}
 function id(value,name){if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(value))fail((name||'请求标识')+'无效');return value;}
 function plan(value){if(typeof value!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value))fail('计划标识无效');return value;}
 function revision(value){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)fail('修订号无效');return value;}
 function operation(value){if(!OPERATIONS.includes(value))fail('桥接操作无效');return value;}
 function nextId(prefix){sequence=(sequence+1)%1000000;return (prefix||'ui')+'-'+Date.now().toString(36)+'-'+sequence.toString(36);}
 function request(operationName,planId,expectedRevision,payload,requestId){
  operation(operationName);plan(planId);revision(expectedRevision);object(payload,'桥接内容');const rid=requestId||nextId('ui');id(rid,'请求标识');
  return {contractVersion:VERSION,requestId:rid,operation:operationName,planId,expectedRevision,payload:clone(payload)};
 }
 function parse(raw){let value=raw;try{if(typeof raw==='string')value=JSON.parse(raw);}catch(_){fail('桥接请求不是有效JSON');}object(value,'桥接请求');const keys=['contractVersion','requestId','operation','planId','expectedRevision','payload'];if(Object.keys(value).length!==keys.length||keys.some(k=>!own(value,k)))fail('桥接请求字段无效');if(value.contractVersion!==VERSION)fail('桥接版本不兼容');id(value.requestId);operation(value.operation);plan(value.planId);revision(value.expectedRevision);object(value.payload,'桥接内容');return {contractVersion:VERSION,requestId:value.requestId,operation:value.operation,planId:value.planId,expectedRevision:value.expectedRevision,payload:clone(value.payload)};}
 function result(raw){let value=raw;try{if(typeof raw==='string')value=JSON.parse(raw);}catch(_){fail('桥接结果不是有效JSON');}object(value,'桥接结果');if(value.contractVersion!==VERSION)fail('桥接结果版本不兼容');id(value.requestId);operation(value.operation);plan(value.planId);if(typeof value.accepted!=='boolean')fail('桥接结果状态无效');if(value.accepted){revision(value.revision);object(value.state,'桥接状态');}else if(typeof value.error!=='string')fail('桥接操作未完成');return value;}
 function invoke(bridge,operationName,planId,expectedRevision,payload,requestId){
  if(!bridge||typeof bridge.dispatch!=='function')fail('当前页面没有可用的桥接接口');const req=request(operationName,planId,expectedRevision,payload,requestId);let raw;
  try{raw=bridge.dispatch(JSON.stringify(req));}catch(error){if(typeof bridge.getState==='function'){try{const state=JSON.parse(bridge.getState());if(state&&Number.isSafeInteger(state._revision)&&state._revision>expectedRevision)fail('保存结果待确认；已读取修订 '+state._revision); }catch(recovery){if(recovery&&recovery.message&&recovery.message.startsWith('保存结果待确认'))throw recovery;}}throw error;}
  const value=result(raw);if(value.requestId!==req.requestId||value.operation!==req.operation||value.planId!==req.planId)fail('桥接响应与请求不匹配，请重新读取');if(!value.accepted)fail(value.error);if(!value.state||!Number.isSafeInteger(value.state._revision)||value.state._revision!==value.revision||value.revision<=expectedRevision)fail('桥接保存结果无效，请重新读取');return value;
 }
 function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
 function fingerprint(req){const value=parse(req);return [value.operation,value.planId,String(value.expectedRevision),canonical(value.payload)].join('|');}
 return Object.freeze({VERSION,OPERATIONS,nextId,request,parse,result,invoke,fingerprint});
});
