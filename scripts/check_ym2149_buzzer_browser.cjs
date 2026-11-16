// SPDX-License-Identifier: BSD-3-Clause
// The shipped Sync-buzzer example through Files / Code in real browsers.
// All physical destination connections pass through an immutable zero gain.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const {chromium,webkit} = require('playwright');

const config = {root:path.resolve(__dirname,'../docs'),entry:'/synth-ym2149-st/index.html',
  engines:'chromium,webkit',out:path.join(os.tmpdir(),'ym2149-buzzer-browser.json')};
for(const argument of process.argv.slice(2)) {
  const match=/^--(root|entry|engines|out)=(.+)$/.exec(argument);
  assert(match,`Unknown argument ${argument}`);config[match[1]]=match[2];
}
config.root=path.resolve(config.root);
assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');
assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.wasm':'application/wasm',
  '.json':'application/json','.webp':'image/webp','.ts':'text/plain'};
const server=http.createServer(async(request,response)=>{
  try {
    let name=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(name.endsWith('/'))name+='index.html';
    const file=path.resolve(config.root,'.'+name);
    if(!file.startsWith(config.root+path.sep)){response.writeHead(403).end();return;}
    response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream',
      'Cache-Control':'no-store'}).end(await fs.readFile(file));
  } catch {response.writeHead(404).end();}
});

function installSilentAudit() {
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  const addMessage=MessagePort.prototype.addEventListener,removeMessage=MessagePort.prototype.removeEventListener;
  const audit=window.__ymBuzzerAudit={contexts:[],nodes:[],meters:[],traffic:[],receipts:[],sequence:0};
  window.AudioContext=class extends Context {constructor(...args){super(...args);audit.contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet {
    constructor(context,name,options){super(context,name,options);if(name==='tetorica-ay8910')audit.nodes.push(this);}
  };
  AudioNode.prototype.connect=function(destination,...args) {
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();
    analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser);connect.call(analyser,mute);connect.call(mute,destination);
    audit.meters.push({analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...args) {
    if(data?.method==='ayTimed') {
      const payload=structuredClone(data.args[0]);
      audit.traffic.push({...payload,id:data.id,time:performance.now()/1000,
        audioTime:audit.contexts.at(-1)?.currentTime});
      if(data.id!==undefined) {
        const port=this,listener=event=>{
          if(event.data?.id!==data.id)return;
          removeMessage.call(port,'message',listener);
          audit.receipts.push({action:payload.action,owner:payload.owner,id:data.id,ok:!event.data.error,
            value:event.data.value,error:event.data.error});
        };
        addMessage.call(port,'message',listener);port.start();
      }
    }
    return post.call(this,data,...args);
  };
  audit.level=()=>{
    let peak=0,sum=0,count=0;
    for(const {analyser}of audit.meters) {
      const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);
      for(const value of values){peak=Math.max(peak,Math.abs(value));sum+=value*value;count++;}
    }
    return {peak,rms:Math.sqrt(sum/Math.max(1,count))};
  };
  audit.request=(method,args)=>new Promise((resolve,reject)=>{
    const node=audit.nodes.at(-1),id=`buzzer-browser-audit:${++audit.sequence}`;
    const listener=event=>{
      if(event.data?.id!==id)return;
      node.port.removeEventListener('message',listener);
      if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.value);
    };
    node.port.addEventListener('message',listener);node.port.start();node.port.postMessage({method,args,id});
  });
  audit.capture=()=>audit.request('ayTimed',[{action:'capture'}]);
}

async function snapshot(page) {
  return page.evaluate(async()=>{const s=await __ymBuzzerAudit.capture();
    return {shape:s.registers[13]&15,mixer:s.registers[7],frame:s.frame,sampleRate:s.sampleRate};});
}
async function stableShape(page,shape,durationMs=180) {
  const observations=[],start=Date.now();
  do {
    const s=await snapshot(page);observations.push(s);
    assert.equal(s.shape,shape,`Unexpected R13 after acknowledged cancellation: ${JSON.stringify(observations)}`);
    await page.waitForTimeout(25);
  }while(Date.now()-start<durationMs);
  assert(observations.at(-1).frame>observations[0].frame,'Worklet frames advance');
  return {first:observations[0],last:observations.at(-1),observations:observations.length,durationMs};
}
async function acknowledged(page,action,index,owner) {
  await page.waitForFunction(({action,index,owner})=>__ymBuzzerAudit.receipts.slice(index).some(
    r=>r.action===action&&r.ok&&(owner===undefined||r.owner===owner)),{action,index,owner});
}
async function apply(page,source,marker) {
  const receiptIndex=await page.evaluate(()=>__ymBuzzerAudit.receipts.length);
  await page.locator('#synthCodeEditor').fill(source+`\nconsole.log(${JSON.stringify(marker)});\n`);
  await page.locator('#synthCodeApplyButton').click();
  await page.waitForFunction(marker=>document.getElementById('synthCodeLog').textContent.includes(marker),marker);
  return receiptIndex;
}
async function schedules(page,index=0) {
  return page.evaluate(index=>__ymBuzzerAudit.traffic.slice(index).filter(
    item=>item.action==='schedule'&&item.options?.name==='sync-buzzer'),index);
}
async function waitSchedules(page,count,index=0,rates) {
  await page.waitForFunction(({count,index,rates})=>{
    const rows=__ymBuzzerAudit.traffic.slice(index).filter(item=>item.action==='schedule'&&item.options?.name==='sync-buzzer');
    return rates?rates.every(hz=>rows.some(item=>Math.abs(1/item.options.repeatSeconds-hz)<1e-8)):rows.length>=count;
  },{count,index,rates},{timeout:10000});
  return schedules(page,index);
}
function checkSchedules(rows,rates,stepSeconds) {
  assert.deepEqual(rows.slice(0,rates.length).map(row=>Math.round(1/row.options.repeatSeconds)),rates);
  for(const row of rows.slice(0,rates.length)) {
    assert(row.owner?.includes(':loop:'),'Reservation belongs to a named loop');
    assert.equal(row.operations.operations.length,1);
    const operation=row.operations.operations[0];
    assert.equal(operation.method,'setEnvelope');assert.deepEqual(operation.args,[{shape:8}]);
    assert.deepEqual(operation.time,{unit:'sample',value:0});
  }
  const intervals=rows.slice(1,rates.length).map((row,i)=>row.audioTime-rows[i].audioTime);
  // Observe musical timing on the actual audio clock, with room for CI scheduling jitter.
  for(const seconds of intervals)assert(Math.abs(seconds-stepSeconds)<0.35,
    `Expected ${stepSeconds}s rate step, observed ${seconds}s`);
  return {ratesHz:rates,stepSeconds,intervalsSeconds:intervals,owner:rows[0].owner,
    operation:rows[0].operations.operations[0],scheduleOptions:rows.slice(0,rates.length).map(row=>row.options)};
}

async function runEngine(name,origin) {
  const browser=await ({chromium,webkit}[name]).launch({headless:true});
  let context,page;
  try {
    context=await browser.newContext({viewport:{width:1280,height:1050}});
    await context.addInitScript(installSilentAudit);
    await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    page=await context.newPage();const errors=[],missing=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{if(response.url().startsWith(origin)&&response.status()>=400)missing.push(response.url());});
    await page.goto(origin+config.entry);
    await page.waitForFunction(()=>Boolean(window.tetoricaYm2149StSynth)&&!document.getElementById('ymFileExamplesButton')?.disabled);
    const assertCold=async()=>{
      assert.equal(await page.evaluate(()=>__ymBuzzerAudit.contexts.length),0,'Browsing/editing examples creates no AudioContext');
      assert.equal(await page.evaluate(()=>tetoricaYm2149StSynth.getCodeState().running),false,'Files never starts Code');
    };
    await assertCold();
    // Materialize and edit index.js before adding examples, then keep Keyboard selected.
    await page.locator('#synthInputCodeTab').click();
    const editor=page.locator('#synthCodeEditor');await editor.waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.getElementById('synthCodeEditor').readOnly);
    const indexSource='// Kept browser-check edit in index.js.\n'+await editor.inputValue();
    await editor.fill(indexSource);
    await page.locator('#synthInputKeyboardTab').click();
    if(!await page.locator('#ymFilesPanel').isVisible())await page.locator('#ymFilesToggle').click();
    const selectedBefore=await page.locator('#ymFilesSelected').textContent();
    await page.locator('#ymFilesTree button[data-file-path="/examples/sync-buzzer.js"]').waitFor({state:'visible'});
    await page.locator('#ymFilesTree button[data-file-path="/examples/README.md"]').waitFor({state:'visible'});
    await page.locator('#ymFileExamplesButton').click();
    await page.waitForFunction(()=>document.getElementById('ymFilesStatus').textContent.includes('existing files were kept'));
    assert.equal(await page.locator('#ymFilesSelected').textContent(),selectedBefore,'Examples preserves selected index.js');
    assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'keyboard');
    await assertCold();
    await page.setViewportSize({width:390,height:844});
    const mobile=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));
    assert(mobile.width<=mobile.viewport+1,'Files / Examples fit a 390px viewport');
    await page.setViewportSize({width:1280,height:1050});
    const select=async file=>{
      await page.locator(`#ymFilesTree button[data-file-path="${file}"]`).click();
      await page.waitForFunction(file=>document.getElementById('ymFilesSelected').textContent===file,file);
    };
    await select('/index.js');await page.locator('#synthInputCodeTab').click();
    assert.equal(await editor.inputValue(),indexSource,'Adding examples preserves edited index.js');
    await page.locator('#synthInputKeyboardTab').click();
    await select('/examples/sync-buzzer.js');
    assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'keyboard','Choosing an example preserves Keyboard');
    await assertCold();await page.locator('#synthInputCodeTab').click();
    const example=await editor.inputValue();
    assert(example.includes('const retriggerHz = [100, 125, 160, 200];')&&example.includes('await beat(2);'));
    const savedExample=example+'\n// Kept browser-check edit in the example.\n';
    await editor.fill(savedExample);
    await page.locator('#ymFileExamplesButton').click();
    await page.waitForFunction(()=>document.getElementById('ymFilesStatus').textContent.includes('existing files were kept'));
    assert.equal(await page.locator('#ymFilesSelected').textContent(),'/examples/sync-buzzer.js');
    assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'code');
    await select('/examples/README.md');
    assert((await editor.inputValue()).includes('YM2149 timed sound examples'),'README is editable text in Code');
    assert.equal(await editor.getAttribute('readonly'),null);
    await select('/examples/sync-buzzer.js');
    assert.equal(await editor.inputValue(),savedExample,'Re-adding examples keeps existing edited source');
    await assertCold();

    await page.locator('#synthCodeRunButton').click();
    await page.waitForFunction(()=>tetoricaYm2149StSynth.getCodeState().running);
    await page.waitForFunction(()=>tetoricaYm2149StSynth.getCodeState().loopNames.length===2);
    assert.deepEqual(await page.evaluate(()=>tetoricaYm2149StSynth.getCodeState().loopNames.slice().sort()),['buzzer-motion','melody']);
    const sounding=await page.waitForFunction(()=>{const level=__ymBuzzerAudit.level();return level.rms>0.0001?level:false;},{},{timeout:5000});
    const pcm=await sounding.jsonValue();await sounding.dispose();
    const initial=checkSchedules(await waitSchedules(page,5),[100,125,160,200,100],1);
    const initialFrames=await stableShape(page,8,100);
    const consoleText=await page.locator('#synthCodeLog').textContent();
    const table=consoleText.split('\n').filter(line=>line.includes('|')).map(line=>line.split('|').map(cell=>cell.trim()));
    const header=table.find(row=>row.includes('register')&&row.includes('value'));
    assert(header,'Console displays the compile table');
    assert(table.some(row=>row[header.indexOf('register')]==='13'&&row[header.indexOf('value')]==='8'),'Console compile row is R13 = 8');
    for(const hz of [100,125,160,200])assert(consoleText.includes(`R13 Shape 8: ${hz} retriggers/s`));
    if(name==='chromium')await page.screenshot({path:'/tmp/tetorica-ym2149-buzzer-files.png',fullPage:true});

    // README exploration uses the selected physical channel and shared controls.
    await page.locator('#ymChannel1Tab').click();
    await page.locator('#toneEnabled').uncheck();
    let controlled;
    for(let i=0;i<20;i++){controlled=await snapshot(page);if(controlled.mixer&1)break;await page.waitForTimeout(10);}
    assert(controlled.mixer&1,'CH1 Tone off updates R7');
    assert.equal(await page.evaluate(()=>tetoricaYm2149StSynth.getCodeState().running),true);
    await page.locator('#synthInputKeyboardTab').click();
    await page.locator('#channelStatus').click();await page.keyboard.down('a');
    await page.waitForFunction(()=>document.querySelector('#keyboard .key[data-key="a"]')?.classList.contains('is-active'));
    await page.waitForTimeout(120);await page.keyboard.up('a');
    await page.waitForFunction(()=>!document.querySelector('#keyboard .key[data-key="a"]')?.classList.contains('is-active'));
    assert.deepEqual(await page.evaluate(()=>tetoricaYm2149StSynth.getCodeState().loopNames.slice().sort()),['buzzer-motion','melody']);
    await page.locator('#synthInputCodeTab').click();

    const edited=example.replace('[100, 125, 160, 200]','[110, 137]').replace('await beat(2);','await beat(0.5);');
    const editIndex=await page.evaluate(()=>__ymBuzzerAudit.traffic.length);
    await apply(page,edited,'BUZZER_EDIT_APPLIED');
    const editedRows=await waitSchedules(page,2,editIndex,[110,137]);
    const firstNew=editedRows.findIndex(row=>Math.round(1/row.options.repeatSeconds)===110);
    const applied=checkSchedules(editedRows.slice(firstNew),[110,137],0.25);
    assert.equal(applied.owner,initial.owner,'Apply retains the named motion loop owner');
    const failedSource=edited+'\nawait ym.schedule(ym.build(b=>b.setEnvelope({shape:12})), {name:"failed-entry",repeatSeconds:1/90});\n'+
      'console.log("BUZZER_EXPECTED_FAILURE_STAGE");\nthrow Error("EXPECTED_BUZZER_APPLY_FAILURE");\n';
    const failedReceipt=await apply(page,failedSource,'BUZZER_EXPECTED_FAILURE_STAGE');
    await page.waitForFunction(()=>document.getElementById('synthCodeError').textContent.includes('EXPECTED_BUZZER_APPLY_FAILURE'));
    await acknowledged(page,'abort',failedReceipt);
    assert.equal(await page.evaluate(()=>tetoricaYm2149StSynth.getCodeState().running),true);
    const failedApply=await stableShape(page,8,160);

    const removed=edited.replace(/liveLoop\("buzzer-motion", async \(\) => \{[\s\S]*?\n\}\);\n/,'');
    assert(!removed.includes('liveLoop("buzzer-motion"'));
    const removeReceipt=await apply(page,removed,'BUZZER_MOTION_REMOVED');
    await acknowledged(page,'releaseOwner',removeReceipt,initial.owner);
    assert.deepEqual(await page.evaluate(()=>tetoricaYm2149StSynth.getCodeState().loopNames),['melody']);
    // A final old write can arrive before its release ACK. Establish the sentinel after ACK.
    await page.evaluate(()=>__ymBuzzerAudit.request('writeRegister',[13,13]));
    const removedMotion=await stableShape(page,13,550);
    const restartIndex=await page.evaluate(()=>__ymBuzzerAudit.traffic.length);
    await apply(page,edited,'BUZZER_MOTION_RESTORED');
    const restoredRows=await waitSchedules(page,1,restartIndex,[110]);
    const restoredOwner=restoredRows.find(row=>Math.round(1/row.options.repeatSeconds)===110).owner;
    const stopReceipt=await page.evaluate(()=>__ymBuzzerAudit.receipts.length);
    await page.locator('#synthCodeStopButton').click();
    await page.waitForFunction(()=>{const state=tetoricaYm2149StSynth.getCodeState();return !state.running&&!state.stopping&&!state.busy;});
    await acknowledged(page,'cancelOwner',stopReceipt,restoredOwner);
    await page.waitForFunction(()=>__ymBuzzerAudit.level().rms<1e-6,{},{timeout:5000});
    const stoppedCount=(await schedules(page)).length;
    await page.evaluate(()=>__ymBuzzerAudit.request('writeRegister',[13,15]));
    const stopped=await stableShape(page,15,650);
    assert.equal((await schedules(page)).length,stoppedCount,'Stop prevents future loop scheduling');
    const audit=await page.evaluate(()=>({contexts:__ymBuzzerAudit.contexts.length,nodes:__ymBuzzerAudit.nodes.length,
      speakerRoutes:__ymBuzzerAudit.meters.length,physicalOutputMuted:__ymBuzzerAudit.meters.every(item=>item.mute.gain.value===0),
      stoppedPcm:__ymBuzzerAudit.level(),failedReceipts:__ymBuzzerAudit.receipts.filter(row=>!row.ok),
      lifecycle:__ymBuzzerAudit.traffic.filter(item=>!['capture','schedule'].includes(item.action))}));
    assert.equal(audit.contexts,1);assert.equal(audit.nodes,1);assert(audit.speakerRoutes>0);assert(audit.physicalOutputMuted);
    assert(audit.stoppedPcm.rms<1e-6);assert.deepEqual(audit.failedReceipts,[]);
    assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    return {engine:name,passed:true,editor:'Offline textarea; external CDN intentionally blocked',
      files:{coldAudioContexts:0,mobile,indexPreserved:true,keyboardModePreserved:true,selectionPreserved:true,
        editableExampleAndReadme:true,editedExamplePreserved:true},pcm,initial,initialFrames,
      controls:{selectedChannel:'CH1',toneOffMixer:controlled.mixer,heldKeyboardPreservesLoops:true},
      applied,failedApply,removedMotion,stopped,audit,errors,missing,console:consoleText};
  } catch(error) {
    if(page)try{console.error(JSON.stringify({engine:name,diagnostics:await page.evaluate(()=>({
      code:tetoricaYm2149StSynth.getCodeState(),error:document.getElementById('synthCodeError').textContent,
      log:document.getElementById('synthCodeLog').textContent,traffic:__ymBuzzerAudit.traffic.filter(row=>row.action!=='capture').slice(-20),
      receipts:__ymBuzzerAudit.receipts.filter(row=>row.action!=='capture').slice(-20)}))},null,2));}catch{}
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
