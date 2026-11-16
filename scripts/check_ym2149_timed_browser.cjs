// SPDX-License-Identifier: BSD-3-Clause
// Timed AY API through the real Synth Code UI. Every speaker route has gain 0.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const {chromium,webkit} = require('playwright');

const config = {root:path.resolve(__dirname,'../docs'),entry:'/synth-ym2149-st/index.html',
  engines:'chromium,webkit',out:path.join(os.tmpdir(),'ym2149-timed-browser.json')};
for(const argument of process.argv.slice(2)) {
  const match = /^--(root|entry|engines|out)=(.+)$/.exec(argument);
  assert(match,`Unknown argument ${argument}`); config[match[1]] = match[2];
}
config.root = path.resolve(config.root);
assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines = config.engines.split(',');
assert(engines.length&&engines.every(name => ['chromium','webkit'].includes(name)));
const mime = {'.js':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm',
  '.json':'application/json','.webp':'image/webp','.ts':'text/plain'};
const server = http.createServer(async(request,response) => {
  try {
    let name = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(name.endsWith('/'))name += 'index.html';
    const file = path.resolve(config.root,'.'+name);
    if(!file.startsWith(config.root+path.sep)){response.writeHead(403).end();return;}
    const data = await fs.readFile(file);
    response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(data);
  } catch {response.writeHead(404).end();}
});

function installSilentAudit() {
  const Context = window.AudioContext??window.webkitAudioContext, Worklet = window.AudioWorkletNode;
  const connect = AudioNode.prototype.connect, post = MessagePort.prototype.postMessage;
  const addMessage = MessagePort.prototype.addEventListener, removeMessage = MessagePort.prototype.removeEventListener;
  const audit = window.__ymTimedAudit = {contexts:[],nodes:[],meters:[],traffic:[],receipts:[],sequence:0};
  window.AudioContext = class extends Context {constructor(...args){super(...args);audit.contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(context,name,options){super(context,name,options);if(name==='tetorica-ay8910')audit.nodes.push(this);}
  };
  AudioNode.prototype.connect = function(destination,...args) {
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser = this.context.createAnalyser(), mute = this.context.createGain();
    analyser.fftSize=4096; mute.gain.value=0;
    connect.call(this,analyser); connect.call(analyser,mute); connect.call(mute,destination);
    audit.meters.push({analyser,mute}); return destination;
  };
  MessagePort.prototype.postMessage = function(data,...args) {
    if(data?.method || data?.type?.startsWith('performance-')) {
      const payload=data.method==='ayTimed'?data.args?.[0]:null;
      audit.traffic.push({method:data.method,type:data.type,action:payload?.action,owner:payload?.owner,
        transactionId:payload?.transactionId,name:payload?.options?.name??payload?.name??payload?.args?.[1]?.name});
      if(payload&&data.id!==undefined) {
        const port=this,listener=event=>{
          if(event.data?.id!==data.id)return;
          removeMessage.call(port,'message',listener);
          audit.receipts.push({action:payload.action,owner:payload.owner,id:data.id,ok:!event.data.error});
        };
        addMessage.call(port,'message',listener);port.start();
      }
    }
    return post.call(this,data,...args);
  };
  audit.level = () => {
    let peak=0,sum=0,count=0;
    for(const {analyser} of audit.meters) {
      const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);
      for(const value of values){peak=Math.max(peak,Math.abs(value));sum+=value*value;count++;}
    }
    return {peak,rms:Math.sqrt(sum/Math.max(1,count))};
  };
  audit.request = (method,args) => new Promise((resolve,reject) => {
    const node=audit.nodes.at(-1),id=`timed-browser-audit:${++audit.sequence}`;
    const listener=event=>{
      if(event.data?.id!==id)return;
      node.port.removeEventListener('message',listener);
      if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.value);
    };
    node.port.addEventListener('message',listener);node.port.start();node.port.postMessage({method,args,id});
  });
  audit.capture = () => audit.request('ayTimed',[{action:'capture'}]);
}

const firstCode = `const ym = await useSoundChip("ay8910");
setBpm(120);
ym.setVoice(CH1, {tone:true, noise:false, volume:12, envelope:true});
ym.setNote(CH1, "E3");
ym.setEnvelope({period:64, shape:8});
ym.keyOn(CH1);
const operations = ym.build(b => {
  b.atSample(0).setEnvelope({shape:8});
});
const startCurrent = performance.now();
const current = await ym.compile(operations);
const currentMs = performance.now() - startCurrent;
const startClient = performance.now();
const client = await ym.compile(operations, {initialState:"client"});
const clientMs = performance.now() - startClient;
const reset = await ym.compile(operations, {initialState:"reset"});
const snapshot = await ym.captureState();
if (!Object.isFrozen(snapshot) || !Object.isFrozen(snapshot.registers) || !Object.isFrozen(snapshot.levels)) throw Error("Snapshot must be read-only plain data");
const saved = JSON.stringify(snapshot);
const fromSnapshot = await ym.compile(operations, {initialState:snapshot});
const other = await ym.compile(ym.build(b => b.setEnvelope({shape:10})), {initialState:snapshot});
if (JSON.stringify(snapshot) !== saved) throw Error("Snapshot changed during compilation");
for (const rows of [current,client,reset,fromSnapshot]) {
  if (rows.length !== 1 || rows[0].register !== 13 || rows[0].value !== 8) throw Error("Unexpected register trace");
}
if (other[0].value !== 10) throw Error("Independent snapshot comparison failed");
await ym.schedule(operations, {name:"browser-buzzer",repeatSeconds:1/110});
console.log("TIMED_METRICS " + JSON.stringify({currentMs,clientMs,referenceSampleRate:operations.referenceSampleRate,rows:current.length,snapshotFrame:snapshot.frame}));
console.log("TIMED_READY_8");
`;
const replacementCode = `const ym = await useSoundChip("ay8910");
await ym.schedule(ym.build(b => b.setEnvelope({shape:10})), {name:"browser-buzzer",repeatSeconds:1/110});
console.log("TIMED_APPLIED_10");
`;
const failedCode = `const ym = await useSoundChip("ay8910");
await ym.schedule(ym.build(b => b.setEnvelope({shape:12})), {name:"browser-buzzer",repeatSeconds:1/110});
console.log("TIMED_FAILED_STAGE");
throw Error("EXPECTED_TIMED_APPLY_FAILURE");
`;
const emptyCode = `const ym = await useSoundChip("ay8910");
ym.setEnvelope({shape:13});
console.log("TIMED_EMPTY_APPLY");
`;
const loopCode = `const ym = await useSoundChip("ay8910");
setBpm(120);
ym.setVoice(CH1,{tone:true,noise:false,volume:12,envelope:true});
ym.setNote(CH1,"E3");ym.setEnvelope({period:64});ym.keyOn(CH1);
liveLoop("timed-buzzer",async()=>{
  await ym.schedule(ym.build(b=>b.setEnvelope({shape:8})),{name:"loop-buzzer",repeatSeconds:1/110});
  await beat(4);
});
console.log("TIMED_LOOP_READY");
`;

async function readShape(page) {
  const state=await page.evaluate(()=>__ymTimedAudit.capture());
  return {shape:state.registers[13]&15,frame:state.frame,sampleRate:state.sampleRate};
}
async function settleShape(page,shape,count=4) {
  const observed=[];
  for(let attempt=0;attempt<40;attempt++) {
    const state=await readShape(page); observed.push(state);
    if(observed.length>=count&&observed.slice(-count).every(value=>value.shape===shape)&&observed.at(-1).frame>observed.at(-count).frame)return observed.slice(-count);
    await page.waitForTimeout(20);
  }
  assert.fail(`Expected stable shape ${shape}: ${JSON.stringify(observed)}`);
}
async function code(page,source,button,marker) {
  const receiptIndex=await page.evaluate(()=>__ymTimedAudit.receipts.length);
  await page.locator('#synthCodeEditor').fill(source);
  await page.locator(`#synthCode${button}Button`).click();
  await page.waitForFunction(text=>document.getElementById('synthCodeLog').textContent.includes(text),marker);
  if(button==='Run')await page.waitForFunction(()=>tetoricaYm2149StSynth.getCodeState().running);
  return receiptIndex;
}
async function acknowledged(page,action,index) {
  await page.waitForFunction(({action,index})=>__ymTimedAudit.receipts.slice(index).some(receipt=>receipt.action===action&&receipt.ok),{action,index});
}

async function runEngine(name,origin) {
  const browser=await ({chromium,webkit}[name]).launch({headless:true});
  let context,page;
  try {
    context=await browser.newContext({viewport:{width:1280,height:900}});
    await context.addInitScript(installSilentAudit);
    await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    page=await context.newPage();const errors=[],missing=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{if(response.url().startsWith(origin)&&response.status()>=400)missing.push(response.url());});
    await page.goto(origin+config.entry);
    await page.waitForFunction(()=>Boolean(window.tetoricaYm2149StSynth)&&!document.getElementById('ymFileNewButton')?.disabled);
    assert.equal(await page.evaluate(()=>__ymTimedAudit.contexts.length),0,'Cold page opens no audio');
    await page.locator('#enableAudio').click();
    await page.waitForFunction(()=>document.getElementById('enableAudio').textContent==='Audio ready');
    await page.locator('#synthInputCodeTab').click();
    await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.getElementById('synthCodeEditor').readOnly);

    await code(page,firstCode,'Run','TIMED_READY_8');
    const run=await settleShape(page,8);
    const sounding=await page.waitForFunction(()=>{const level=__ymTimedAudit.level();return level.rms>0.0001?level:false;},{},{timeout:5000});
    const pcm=await sounding.jsonValue();await sounding.dispose();
    const metrics=await page.locator('#synthCodeLog').textContent();
    const timing=JSON.parse(metrics.split('\n').find(line=>line.includes('TIMED_METRICS ')).split('TIMED_METRICS ')[1]);

    await code(page,replacementCode,'Apply','TIMED_APPLIED_10');
    const applied=await settleShape(page,10);
    await code(page,failedCode,'Apply','TIMED_FAILED_STAGE');
    await page.waitForFunction(()=>document.getElementById('synthCodeError').textContent.includes('EXPECTED_TIMED_APPLY_FAILURE'));
    assert.equal(await page.evaluate(()=>tetoricaYm2149StSynth.getCodeState().running),true,'Failed Apply preserves the old performance');
    const failed=await settleShape(page,10);

    const emptyReceipt=await code(page,emptyCode,'Apply','TIMED_EMPTY_APPLY');
    await acknowledged(page,'commit',emptyReceipt);
    // Cancellation affects future writes only. A final old write may occur
    // between the source's edit and its commit; establish the sentinel after ACK.
    await page.evaluate(()=>__ymTimedAudit.request('writeRegister',[13,13]));
    const omitted=await settleShape(page,13,6);
    await code(page,loopCode,'Apply','TIMED_LOOP_READY');
    const loop=await settleShape(page,8);
    const removedReceipt=await code(page,emptyCode.replace('TIMED_EMPTY_APPLY','TIMED_REMOVED_LOOP'),'Apply','TIMED_REMOVED_LOOP');
    await acknowledged(page,'releaseOwner',removedReceipt);
    await page.evaluate(()=>__ymTimedAudit.request('writeRegister',[13,13]));
    const removed=await settleShape(page,13,6);

    await code(page,loopCode.replace('TIMED_LOOP_READY','TIMED_STOP_LOOP'),'Apply','TIMED_STOP_LOOP');
    await settleShape(page,8);
    await page.locator('#synthCodeStopButton').click();
    await page.waitForFunction(()=>{const state=tetoricaYm2149StSynth.getCodeState();return !state.running&&!state.stopping&&!state.busy;});
    await page.waitForFunction(()=>__ymTimedAudit.level().rms<1e-6,{},{timeout:5000});
    const stoppedTraffic=await page.evaluate(()=>__ymTimedAudit.traffic.filter(item=>item.method==='ayTimed'&&item.action!=='capture').length);
    // A silent sentinel catches leaked same-value repeating writes after Stop.
    await page.evaluate(()=>__ymTimedAudit.request('writeRegister',[13,15]));
    const stopped=await settleShape(page,15,8);
    const final=await page.evaluate(()=>({contexts:__ymTimedAudit.contexts.length,nodes:__ymTimedAudit.nodes.length,
      speakerRoutes:__ymTimedAudit.meters.length,physicalOutputMuted:__ymTimedAudit.meters.every(item=>item.mute.gain.value===0),
      pcm:__ymTimedAudit.level(),scheduleTraffic:__ymTimedAudit.traffic.filter(item=>item.method==='ayTimed'&&item.action!=='capture').length}));
    assert.equal(final.contexts,1);assert.equal(final.nodes,1);assert(final.speakerRoutes>0);assert(final.physicalOutputMuted);
    assert(final.pcm.rms<1e-6,'Stop and sentinel preserve silence');
    assert.equal(final.scheduleTraffic,stoppedTraffic,'Stopped loops issue no future scheduling traffic');
    assert.deepEqual(errors,[],'No uncaught browser errors');assert.deepEqual(missing,[],'No missing local resources');
    const log=await page.locator('#synthCodeLog').textContent();
    return {engine:name,passed:true,editor:'offline textarea; external CDN intentionally blocked',timing,
      timingScope:'One-operation inspection sample; browser timer resolution applies; no latency deadline is asserted',pcm,
      checkpoints:{run,applied,failedApply:failed,omittedEntry:omitted,loop,removedLoop:removed,stopped},audit:final,errors,missing,log};
  } catch(error) {
    if(page)try {
      const diagnostics=await page.evaluate(()=>({code:tetoricaYm2149StSynth.getCodeState(),
        error:document.getElementById('synthCodeError').textContent,log:document.getElementById('synthCodeLog').textContent,
        traffic:__ymTimedAudit.traffic.filter(item=>item.action!=='capture').slice(-30),
        receipts:__ymTimedAudit.receipts.filter(item=>item.action!=='capture').slice(-30)}));
      console.error(JSON.stringify({engine:name,diagnostics},null,2));
    } catch {}
    throw error;
  } finally {await context?.close();await browser.close();}
}

async function main() {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,results=[];
  try {
    for(const engine of engines)results.push(await runEngine(engine,origin));
    const report={passed:true,entry:config.entry,physicalOutputMuted:true,results};
    await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  } finally {await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
