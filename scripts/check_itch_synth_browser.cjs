// Narrow standalone Synth release smoke. Only the extracted ZIP is served;
// public file import/keyboard UI drives real WASM and Worklet audio.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const args=process.argv.slice(2),option=name=>args.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
const usage='Usage: node scripts/check_itch_synth_browser.cjs --zip=ARCHIVE [--out=REPORT.json] [--images=DIR] [--chromium|--webkit]';
if(args.includes('--help')){console.log(usage);process.exit(0);}
assert(option('zip'),usage);
assert(args.every(arg=>['--chromium','--webkit'].includes(arg)||/^--(?:zip|out|images)=/.test(arg)),usage);
const archive=path.resolve(option('zip')),out=path.resolve(option('out')??path.join(os.tmpdir(),'itch-synth-browser.json'));
const images=path.resolve(option('images')??path.join(os.tmpdir(),'itch-synth-browser-images'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const captureSource=`class SynthReleaseCapture extends AudioWorkletProcessor{
 constructor(){super();this.pending=null;this.port.onmessage=({data})=>{if(this.pending)throw Error('Concurrent capture');this.pending={id:data.id,left:new Float32Array(data.frames),right:new Float32Array(data.frames),offset:0};};}
 process(inputs,outputs){for(const ch of outputs[0])ch.fill(0);const p=this.pending;if(!p)return true;const count=Math.min(128,p.left.length-p.offset),input=inputs[0];for(let i=0;i<count;i++){p.left[p.offset+i]=input[0]?.[i]??0;p.right[p.offset+i]=input[1]?.[i]??input[0]?.[i]??0;}p.offset+=count;if(p.offset===p.left.length){this.pending=null;this.port.postMessage(p,[p.left.buffer,p.right.buffer]);}return true;}
}registerProcessor('itch-synth-release-capture',SynthReleaseCapture);`;
function instrumentation(){
 const audit=window.__itchSynthAudit={contexts:[],worklets:[],sinks:new Map()};
 const Context=window.AudioContext,Worklet=window.AudioWorkletNode,connect=AudioNode.prototype.connect,disconnect=AudioNode.prototype.disconnect;
 audit.connect=connect;
 window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
 if(window.webkitAudioContext===Context)window.webkitAudioContext=window.AudioContext;
 window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);audit.worklets.push(name);}};
 AudioNode.prototype.connect=function(destination,...args){
  if(destination===this.context.destination){
   let sink=audit.sinks.get(this.context);
   if(!sink){const sum=this.context.createGain(),gate=this.context.createGain();gate.gain.value=0;connect.call(sum,gate);connect.call(gate,destination);sink={sum,gate};audit.sinks.set(this.context,sink);}
   connect.call(this,sink.sum,...args);return destination;
  }
  return connect.call(this,destination,...args);
 };
 AudioNode.prototype.disconnect=function(...args){if(args[0]===this.context.destination&&audit.sinks.has(this.context))args[0]=audit.sinks.get(this.context).sum;return disconnect.apply(this,args);};
}
// Original, sustained single-carrier patch. TFI physical slot order 1,3,2,4.
function fixture(){
 const bytes=Buffer.alloc(42);bytes[0]=7;
 for(let op=0;op<4;op++){const p=2+op*10;bytes[p]=1;bytes[p+2]=op===3?8:127;bytes[p+4]=31;bytes[p+7]=15;}
 return bytes;
}
async function capture(page){
 return page.evaluate(async()=>{
  const audit=window.__itchSynthAudit,context=audit.contexts.find(c=>c.state!=='closed'&&audit.sinks.has(c));if(!context)throw Error('No live Synth output');
  const sink=audit.sinks.get(context);
  if(!sink.capture){
   await context.audioWorklet.addModule('/__synth_release_capture.js');
   const node=new AudioWorkletNode(context,'itch-synth-release-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
   audit.connect.call(sink.sum,node);audit.connect.call(node,sink.gate);sink.capture=node;sink.id=0;
   node.port.onmessage=({data})=>{if(sink.pending?.id===data.id){const p=sink.pending;sink.pending=null;clearTimeout(p.timer);p.resolve(data);}};
  }
  const data=await new Promise((resolve,reject)=>{if(sink.pending)throw Error('Concurrent capture');const id=++sink.id,timer=setTimeout(()=>reject(Error('Synth PCM capture timeout')),10000);sink.pending={id,resolve,timer};sink.capture.port.postMessage({id,frames:12288});});
  let peak=0,sum=0,count=0;
  for(const channel of[data.left,data.right])for(const value of channel.subarray(1024)){if(!Number.isFinite(value))throw Error('Nonfinite Synth PCM');peak=Math.max(peak,Math.abs(value));sum+=value*value;count++;}
  return {frames:data.left.length-1024,sampleRate:context.sampleRate,peak,rms:Math.sqrt(sum/count)};
 });
}
async function check(browser,name,origin,images){
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage();
 await context.addInitScript(instrumentation);page.setDefaultTimeout(35000);
 const errors=[],failed=[],bad=[],consoleErrors=[],result={browser:name,version:browser.version()};
 page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('requestfailed',request=>failed.push({url:request.url(),error:request.failure()?.errorText}));
 page.on('response',response=>{if(response.status()>=400)bad.push({url:response.url(),status:response.status()});});page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
 try{
  await page.goto(origin+'/index.html');
  await page.waitForFunction(()=>document.querySelector('#keyboard .key')&&!document.getElementById('synthFileNewButton').disabled);
  result.startup=await page.evaluate(()=>({title:document.title,status:document.getElementById('status').textContent,presets:document.getElementById('presetSelect').options.length,audioContexts:window.__itchSynthAudit.contexts.length}));
  assert(result.startup.presets>0);assert.equal(result.startup.audioContexts,0,'Startup does not initialize audio');
  await page.locator('#synthMenuButton').click();
  const[chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#importPresetButton').click()]);
  await chooser.setFiles({name:'ci-smoke.tfi',mimeType:'application/octet-stream',buffer:fixture()});
  await page.waitForFunction(()=>document.getElementById('synthActiveFilePath').textContent.includes('ci-smoke')&&!document.getElementById('synthFileNewButton').disabled);
  assert.equal(await page.locator('.param-value[aria-label="ALGO"]').textContent(),'7');
  assert.equal(await page.locator('#operatorControls .param-value[aria-label="TL"]').allTextContents().then(x=>x.join(',')),'127,127,127,8');
  assert.equal(await page.evaluate(()=>window.__itchSynthAudit.contexts.length),0,'TFI parsing remains lazy');
  result.importedPath=await page.locator('#synthActiveFilePath').textContent();
  // First gesture completes asynchronous WASM initialization before key hold.
  await page.locator('#keyboard .key').first().click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Audio ready'));
  await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.down('a');
  await page.waitForFunction(()=>document.querySelector('#keyboard .key[data-key="a"]').classList.contains('is-active'));
  result.held=await capture(page);assert(result.held.rms>.0002&&result.held.peak<1,'Imported TFI produces finite audible actual PCM');
  result.screenshot=path.join(images,`${name}-synth.png`);await page.screenshot({path:result.screenshot});
  await page.keyboard.up('a');await page.waitForFunction(()=>!document.querySelector('#keyboard .key[data-key="a"]').classList.contains('is-active'));
  await page.waitForTimeout(500);result.released=await capture(page);assert(result.released.rms<Math.max(1e-6,result.held.rms*.01),'Key release becomes quiet');
  await page.keyboard.down('a');result.replayed=await capture(page);assert(result.replayed.rms>.0002,'A second key press sounds again');await page.keyboard.up('a');
  result.worklets=await page.evaluate(()=>window.__itchSynthAudit.worklets);assert(result.worklets.some(name=>name!=='itch-synth-release-capture'),'Application AudioWorklet actually ran');
  assert.deepEqual(errors,[],'Page errors');assert.deepEqual(failed,[],'Failed requests');assert.deepEqual(bad,[],'HTTP errors');assert.deepEqual(consoleErrors,[],'Console errors');
  result.passed=true;return result;
 }catch(error){result.failure=String(error.stack??error);result.status=await page.locator('#status').textContent().catch(()=>null);throw Object.assign(error,{caseResult:result});}
 finally{Object.assign(result,{errors,failed,bad,consoleErrors});await context.close();}
}
(async()=>{
 const archiveBytes=await fs.readFile(archive),root=await fs.mkdtemp(path.join(os.tmpdir(),'itch-synth-browser-'));await fs.mkdir(images,{recursive:true});
 const extractor=String.raw`import json,sys,zipfile
from pathlib import Path
root=Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as z:
 for i in z.infolist():
  if not (root/i.filename).resolve().is_relative_to(root):raise ValueError('Unsafe ZIP path')
 z.extractall(root)
 print(json.dumps({'entries':len(z.infolist()),'directories':sum(i.is_dir() for i in z.infolist())}))`;
 const counts=JSON.parse(execFileSync('python3',['-c',extractor,archive,root],{encoding:'utf8'})),served=new Map();
 const report={artifact:{archive,root,bytes:archiveBytes.length,sha256:sha(archiveBytes),...counts},physicalOutputMuted:true,repositoryFallback:false,privateProductionHooks:false,cases:[]};
 const server=http.createServer(async(request,response)=>{
  try{
   const pathname=decodeURIComponent(new URL(request.url,'http://local').pathname);
   if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
   if(pathname==='/__synth_release_capture.js'){response.writeHead(200,{'Content-Type':'text/javascript'}).end(captureSource);return;}
   const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep))throw Error('Outside ZIP');const bytes=await fs.readFile(file),relative=path.relative(root,file),record={bytes:bytes.length,sha256:sha(bytes)};
   if(served.has(relative))assert.deepEqual(record,served.get(relative),'Artifact changed');served.set(relative,record);
   const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml'};
   response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
  }catch(error){response.writeHead(404).end(String(error));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 try{
  const selected=args.includes('--chromium')?[['chromium',chromium]]:args.includes('--webkit')?[['webkit',webkit]]:[['chromium',chromium],['webkit',webkit]];
  for(const[name,type]of selected){const browser=await type.launch({headless:true});try{report.cases.push(await check(browser,name,origin,images));console.log(`PASS ${name}: packaged Synth startup, TFI import, actual keyboard PCM, quiet release and replay`);}finally{await browser.close();}}
  report.passed=true;
 }catch(error){report.passed=false;if(error.caseResult)report.cases.push(error.caseResult);report.failure=String(error.stack??error);console.error(report.failure);process.exitCode=1;}
 finally{await new Promise(resolve=>server.close(resolve));report.servedFiles=Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)));await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:out,passed:report.passed,cases:report.cases.length,servedFiles:served.size,sha256:sha(await fs.readFile(out))}));}
})().catch(error=>{console.error(error);process.exitCode=1;});
