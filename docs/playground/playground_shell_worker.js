const pending=new Map(),modules=new Map(),urls=[];
let sequence=0,terminal=false,api;
function rpc(method,args=[]){
  const id=++sequence;
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  pending.set(id,{resolve,reject,promise});postMessage({type:'rpc',id,method,args});return promise;
}
function format(value){
  if(value instanceof Error)return value.stack??value.message;
  if(typeof value==='string')return value;
  try{return JSON.stringify(value)??String(value);}catch{return String(value);}
}
const shellConsole={};
for(const level of ['log','info','warn','error','debug'])shellConsole[level]=(...values)=>postMessage({type:'output',level,text:values.map(format).join(' ')+'\n'});
function fail(error){if(terminal)return;terminal=true;postMessage({type:'failed',error:String(error?.stack??error?.message??error)});}
self.addEventListener('error',event=>{event.preventDefault();fail(event.error??event.message);});
self.addEventListener('unhandledrejection',event=>{event.preventDefault();fail(event.reason);});
async function load(specifier,referrer){
  if(specifier==='tetorica:shell')return api;
  const module=await rpc('module',[specifier,referrer]);
  if(!modules.has(module.path))modules.set(module.path,(async()=>{
    const url=URL.createObjectURL(new Blob([module.source+`\n//# sourceURL=tetorica-shell:${encodeURI(module.path)}\n`],{type:'text/javascript'}));urls.push(url);
    return import(url);
  })());
  return modules.get(module.path);
}
self.addEventListener('message',async event=>{
  const data=event.data;
  if(data.type==='reply'){
    const request=pending.get(data.id);if(!request)return;pending.delete(data.id);
    if(data.error)request.reject(new Error(data.error));else request.resolve(data.result);return;
  }
  if(data.type!=='start'||api)return;
  const fs={};
  for(const method of ['get','has','stat','readdir','list','listDirectories','snapshot','readFile','writeFile','writeText','writeBinary','mkdir','delete','remove','rename','copy'])fs[method]=(...args)=>rpc('fs.'+method,args);
  const shell={cwd:data.cwd,async execute(source){const reply=await rpc('execute',[source]);shell.cwd=reply.cwd;return reply.result;}};
  api=Object.freeze({fs:Object.freeze(fs),shell,console:shellConsole,args:Object.freeze(data.args),cwd:data.cwd});
  globalThis.__tetoricaShellImport=load;globalThis.console=shellConsole;
  globalThis.args=api.args;globalThis.cwd=api.cwd;
  try{
    await load(data.path,null);
    while(pending.size)await Promise.all([...pending.values()].map(request=>request.promise));
    await new Promise(resolve=>setTimeout(resolve,0)); // Give unhandled rejections their own event turn.
    if(!terminal){terminal=true;postMessage({type:'done'});}
  }catch(error){fail(error);}
});
