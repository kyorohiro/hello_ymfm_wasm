// SPDX-License-Identifier: BSD-3-Clause
// Real FM Synth Code / Worklet integration. Every physical output is muted.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const {chromium, webkit} = require('playwright');
const config = {root:path.resolve(__dirname, '../docs'), entry:'/synth-fm2608/index.html',
  engines:'chromium,webkit', out:path.join(os.tmpdir(), 'ym2608-timed-browser.json')};
for (const argument of process.argv.slice(2)) {
  const match = /^--(root|entry|engines|out)=(.+)$/.exec(argument);
  assert(match, `Unknown argument ${argument}`); config[match[1]] = match[2];
}
config.root = path.resolve(config.root);
const mime = {'.js':'text/javascript', '.html':'text/html', '.css':'text/css',
  '.wasm':'application/wasm', '.json':'application/json', '.ts':'text/plain'};
const server = http.createServer(async (request, response) => {
  try {
    let name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (name.endsWith('/')) name += 'index.html';
    const file = path.resolve(config.root, '.' + name);
    if (!file.startsWith(config.root + path.sep)) {response.writeHead(403).end(); return;}
    const bytes = await fs.readFile(file);
    response.writeHead(200, {'Content-Type':mime[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control':'no-store'}).end(bytes);
  } catch {response.writeHead(404).end();}
});

function installSilentAudit() {
  const Context = window.AudioContext ?? window.webkitAudioContext, Worklet = window.AudioWorkletNode;
  const connect = AudioNode.prototype.connect;
  const audit = window.__fmTimedAudit = {nodes:[], contexts:[], routes:[], sequence:0,commands:[]};
  window.AudioContext = class extends Context {constructor(...args) {super(...args); audit.contexts.push(this);}};
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(context, name, options) {super(context, name, options); if (name === 'ym2608-processor') {audit.nodes.push(this);const post=this.port.postMessage.bind(this.port);this.port.postMessage=(data,...rest)=>{audit.commands.push(data);return post(data,...rest);};}}
  };
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...args);
    const meter = this.context.createAnalyser(), mute = this.context.createGain();
    meter.fftSize = 2048; mute.gain.value = 0;
    connect.call(this, meter); connect.call(meter, mute); connect.call(mute, destination);
    audit.routes.push({meter, mute}); return destination;
  };
  audit.capture = () => new Promise((resolve, reject) => {
    const port = audit.nodes[0].port, id = 'fm-browser:' + ++audit.sequence;
    const listener = event => {
      if (event.data?.id !== id) return;
      port.removeEventListener('message', listener);
      event.data.error ? reject(Error(event.data.error)) : resolve(event.data.value);
    };
    port.addEventListener('message', listener); port.start();
    port.postMessage({method:'ym2608Timed', id, args:[{action:'capture'}]});
  });
  audit.level = () => {
    let peak = 0;
    for (const {meter} of audit.routes) {
      const pcm = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(pcm);
      for (const value of pcm) peak = Math.max(peak, Math.abs(value));
    }
    return peak;
  };
}


const base = `const fm = await useSoundChip("ym2608");
fm.setAlgo(CH1,7);fm.setPan(CH1,true,true);
fm.setOperator(CH1,OP1,{dt:3,multi:1,tl:32,ar:31,rr:8});
fm.ssg.tone(CH1,{frequency:440,volume:10});
const plan=fm.build(b=>{b.setOperator(CH1,OP1,{multi:2});b.ssg.setEnvelope({period:300,shape:8});});
const current=await fm.compile(plan),client=await fm.compile(plan,{initialState:'client'}),reset=await fm.compile(plan,{initialState:'reset'});
const snapshot=await fm.captureState(),saved=JSON.stringify(snapshot),reused=await fm.compile(plan,{initialState:snapshot});
if(current[0].value!==0x32||client[0].value!==0x32||reset[0].value!==2||reused[0].value!==0x32)throw Error('baseline mismatch');
if(JSON.stringify(snapshot)!==saved)throw Error('snapshot mutated');
await fm.schedule(plan,{name:'browser-operator',repeatSeconds:.01});
console.log('FM_TIMED_READY');`;
const replacement=value=>`const fm=await useSoundChip('ym2608');await fm.schedule(fm.build(b=>b.setOperator(CH1,OP1,{multi:${value}})),{name:'browser-operator',repeatSeconds:.01});console.log('FM_APPLY_${value}');`;
async function execute(page,source,action,marker){
 await page.locator('#synthCodeEditor').fill(source);await page.locator('#synthCode'+action+'Button').click();
 await page.waitForFunction(marker=>document.getElementById('synthCodeLog').textContent.includes(marker),marker);
}
async function stable(page,value){
 let state;for(let i=0;i<60;i++){state=await page.evaluate(()=>__fmTimedAudit.capture());if(state.registers[0][0x30]===value)return state.frame;await page.waitForTimeout(20);}
 assert.equal(state.registers[0][0x30],value);
}
async function level(page,predicate,label){
 let peak=0;for(let i=0;i<60;i++){peak=await page.evaluate(()=>__fmTimedAudit.level());if(predicate(peak))return peak;await page.waitForTimeout(30);}assert.fail(`${label}: last peak ${peak}`);
}
async function monitorFlow(page){
 const goCode=async()=>{await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});};
 const mute=async(section,expected)=>{await page.locator('#tab-mixer').click();const button=page.locator(`[data-mixer-section="${section}"][data-mixer-channel="0"]`);await button.click();assert.equal(await button.getAttribute('aria-pressed'),String(!expected));await page.waitForTimeout(160);};
 const setup=`const fm=await useSoundChip('ym2608');
fm.setAlgo(CH1,7);fm.setPan(CH1,true,true);fm.setLfo(false,0);
for(let op=0;op<4;op++)fm.setOperator(CH1,op,{multi:1,tl:op?127:24,ar:31,d1r:0,d2r:0,sl:0,rr:8});
for(let ch=0;ch<3;ch++)fm.ssg.keyOff(ch);`;
 const fmPhrase=(tl,tag)=>`const fm=await useSoundChip('ym2608');await fm.schedule(fm.build(b=>{b.setOperator(CH1,OP1,{tl:${tl}});b.noteOn(CH1,'A3');}),{name:'monitor-fm',repeatSeconds:.05});console.log('${tag}');`;
 await goCode();await execute(page,setup+fmPhrase(24,'MONITOR_FM').replace("const fm=await useSoundChip('ym2608');",''),'Run','MONITOR_FM');
 const fmBefore=await level(page,x=>x>.003,'FM starts');await mute('fm',true);const fmMuted=await level(page,x=>x<.0001,'FM muted');
 await goCode();await execute(page,fmPhrase(18,'MONITOR_FM_CHANGED'),'Apply','MONITOR_FM_CHANGED');await page.waitForTimeout(160);
 assert((await page.evaluate(()=>__fmTimedAudit.capture())).keyMasks[0]>0);assert(await page.evaluate(()=>__fmTimedAudit.level())<.0001);
 await mute('fm',false);const fmAfter=await level(page,x=>x>fmBefore*1.25,'latest timed FM level restored');
 await goCode();await page.locator('#synthCodeStopButton').click();await level(page,x=>x<.0001,'FM Stop');await page.waitForTimeout(180);
 await execute(page,`const fm=await useSoundChip('ym2608');await fm.schedule(fm.build(b=>b.noteOn(CH1,'A3')),{name:'gate-only',repeatSeconds:.05});console.log('FM_GATE_ONLY');`,'Run','FM_GATE_ONLY');
 const fmRerun=await level(page,x=>x>fmBefore*1.25,'Key On-only FM rerun');assert.equal((await page.evaluate(()=>__fmTimedAudit.capture())).registers[0][0x40],18);
 await page.locator('#synthCodeStopButton').click();await level(page,x=>x<.0001,'FM stopped before SSG');await page.waitForTimeout(180);
 const ssgPhrase=(volume,tag)=>`const fm=await useSoundChip('ym2608');await fm.schedule(fm.build(b=>{b.ssg.setVolume(CH1,${volume});b.ssg.noteOn(CH1,'A4');}),{name:'monitor-ssg',repeatSeconds:.05});console.log('${tag}');`;
 await execute(page,`const fm=await useSoundChip('ym2608');fm.ssg.setMixer(CH1,{tone:true,noise:false});`+ssgPhrase(12,'MONITOR_SSG').replace("const fm=await useSoundChip('ym2608');",''),'Run','MONITOR_SSG');
 const ssgBefore=await level(page,x=>x>.003,'SSG starts');await mute('ssg',true);const ssgMuted=await level(page,x=>x<.0001,'SSG muted');
 await goCode();await execute(page,ssgPhrase(5,'MONITOR_SSG_CHANGED'),'Apply','MONITOR_SSG_CHANGED');await page.waitForTimeout(160);assert(await page.evaluate(()=>__fmTimedAudit.level())<.0001);
 await mute('ssg',false);const ssgAfter=await level(page,x=>x>.0003&&x<ssgBefore*.7,'latest timed SSG level restored');
 await goCode();await page.locator('#synthCodeStopButton').click();await level(page,x=>x<.0001,'SSG Stop');await page.waitForTimeout(180);
 await execute(page,`const fm=await useSoundChip('ym2608');await fm.schedule(fm.build(b=>b.ssg.noteOn(CH1,'A4')),{name:'ssg-gate-only',repeatSeconds:.05});console.log('SSG_GATE_ONLY');`,'Run','SSG_GATE_ONLY');
 const ssgRerun=await level(page,x=>x>.0003&&x<ssgBefore*.7,'Key On-only SSG rerun');assert.equal((await page.evaluate(()=>__fmTimedAudit.capture())).registers[0][8],5);
 await page.locator('#synthCodeStopButton').click();await level(page,x=>x<.0001,'final Stop');
 return {fmBefore,fmMuted,fmAfter,fmRerun,ssgBefore,ssgMuted,ssgAfter,ssgRerun};
}
async function rhythmFlow(page){
 const goCode=async()=>{await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});};
 const mute=async()=>{await page.locator('#tab-mixer').click();await page.locator('[data-mixer-section="rhythm"][data-mixer-channel="1"]').click();await page.waitForTimeout(180);};
 const phrase=(voice,tag)=>`const fm=await useSoundChip('ym2608');await fm.schedule(fm.build(b=>{b.rhythm.setVolume(48);b.rhythm.setVoice('snare',${JSON.stringify(voice)});b.rhythm.keyOn('snare');}),{name:'rhythm-browser',repeatSeconds:.05});console.log('${tag}');`;
 await goCode();await execute(page,phrase({volume:24,left:true,right:true},'RHYTHM_READY'),'Run','RHYTHM_READY');
 const before=await level(page,x=>x>.001,'Rhythm plays');await mute();const muted=await level(page,x=>x<.0001,'Rhythm muted');
 await goCode();await execute(page,phrase({volume:18},'RHYTHM_CHANGED'),'Apply','RHYTHM_CHANGED');await page.waitForTimeout(180);
 const state=await page.evaluate(()=>__fmTimedAudit.capture());assert.equal(state.registers[0][0x19],18);assert.equal(state.rhythmLevels[1],0xd2);assert(await page.evaluate(()=>__fmTimedAudit.level())<.0001);
 await mute();const restored=await level(page,x=>x>.001,'Rhythm unmute restores authored pan');
 await goCode();await execute(page,phrase({left:false},'RHYTHM_RIGHT'),'Apply','RHYTHM_RIGHT');await page.waitForTimeout(100);assert.equal((await page.evaluate(()=>__fmTimedAudit.capture())).rhythmLevels[1],0x52);
 await page.locator('#synthCodeEditor').fill(phrase({volume:30},'RHYTHM_STAGED')+"throw Error('EXPECTED_RHYTHM_FAILURE');");await page.locator('#synthCodeApplyButton').click();
 await page.waitForFunction(()=>document.getElementById('synthCodeError').textContent.includes('EXPECTED_RHYTHM_FAILURE'));await page.waitForTimeout(120);
 assert.equal((await page.evaluate(()=>__fmTimedAudit.capture())).rhythmLevels[1],0x52,'failed Apply keeps accepted drum pattern');
 await page.locator('#synthCodeStopButton').click();const stopped=await level(page,x=>x<.0001,'Rhythm Stop');await page.waitForTimeout(180);
 assert.equal((await page.evaluate(()=>__fmTimedAudit.capture())).registers[0][0x10],0xbf);
 return {before,muted,restored,stopped,partialPanAndVolumePreserved:true,failedApplyPreserved:true};
}
async function run(browserName,origin){
 const browser=await {chromium,webkit}[browserName].launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:900}});let page;
 try{
  await context.addInitScript(installSilentAudit);
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+config.entry);await page.waitForFunction(()=>!document.getElementById('synthFileNewButton')?.disabled);
  await page.locator('#startAudio').click();await page.waitForFunction(()=>document.getElementById('audioStatus').textContent.includes('OPNA ready'));
  await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
  await execute(page,base,'Run','FM_TIMED_READY');const initial=await stable(page,0x32);
  await execute(page,replacement(5),'Apply','FM_APPLY_5');const applied=await stable(page,0x35);
  await page.locator('#synthCodeEditor').fill(replacement(7)+"throw Error('EXPECTED_APPLY_FAILURE');");await page.locator('#synthCodeApplyButton').click();
  await page.waitForFunction(()=>document.getElementById('synthCodeError').textContent.includes('EXPECTED_APPLY_FAILURE'));
  await page.waitForTimeout(80);const rolledBack=await stable(page,0x35);
  await page.locator('#synthCodeStopButton').click();await page.waitForFunction(()=>document.getElementById('synthCodeState').textContent.includes('Stopped'));
  await page.waitForTimeout(250);
  await page.waitForFunction(async()=>{const s=await __fmTimedAudit.capture();return s.keyMasks[0]===0&&s.registers[0][8]===0;});
  const stopped=await page.evaluate(()=>__fmTimedAudit.capture());assert.equal(stopped.keyMasks[0],0);assert.equal(stopped.registers[0][8],0);
  const monitor=await monitorFlow(page);
  const rhythm=await rhythmFlow(page);
  // Run the same example distributed in each new Cassette.
  const example=await page.evaluate(async()=>{const m=await import('./synth-fm2608/code_examples.js'.replace('./synth-fm2608/',location.pathname.includes('/synth-fm2608/')?'./':'./synth-fm2608/'));return m.FM2608_TIMED_EXAMPLE;});
  await execute(page,example+"\nconsole.log('EXAMPLE_READY');",'Run','EXAMPLE_READY');await page.waitForTimeout(100);
  await page.locator('#synthCodeStopButton').click();await page.waitForTimeout(180);
  const drumExample=await page.evaluate(async()=>{const m=await import('./synth-fm2608/code_examples.js'.replace('./synth-fm2608/',location.pathname.includes('/synth-fm2608/')?'./':'./synth-fm2608/'));return m.FM2608_RHYTHM_EXAMPLE;});
  await execute(page,drumExample+"\nconsole.log('RHYTHM_EXAMPLE_READY');",'Run','RHYTHM_EXAMPLE_READY');await level(page,x=>x>.001,'distributed Rhythm example');await page.locator('#synthCodeStopButton').click();
  const audit=await page.evaluate(()=>({contexts:__fmTimedAudit.contexts.length,nodes:__fmTimedAudit.nodes.length,muted:__fmTimedAudit.routes.length>0&&__fmTimedAudit.routes.every(x=>x.mute.gain.value===0)}));
  assert(audit.muted);assert.deepEqual(errors,[]);return {browser:browserName,passed:true,initial,applied,rolledBack,stoppedFrame:stopped.frame,monitor,rhythm,audit};
 }catch(error){if(page)console.error(await page.evaluate(()=>({status:document.getElementById('audioStatus')?.textContent,error:document.getElementById('synthCodeError')?.textContent,log:document.getElementById('synthCodeLog')?.textContent,commands:__fmTimedAudit.commands.filter(x=>x.method!=='ym2608Timed'||x.args[0].action!=='capture').slice(-22)})));throw error;}
 finally{await context.close();await browser.close();}
}
(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{const results=[];for(const name of config.engines.split(','))results.push(await run(name,`http://127.0.0.1:${server.address().port}`));const report={passed:true,physicalOutputMuted:true,results};await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}finally{await new Promise(resolve=>server.close(resolve));}})().catch(error=>{console.error(error);process.exitCode=1;});
