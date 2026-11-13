// Real DMG Synth Code/Files integration, headless and physically silent.
// Every destination connection is intercepted before application code loads
// and passes through gain zero. Chromium also starts with --mute-audio.
// node scripts/check_dmg_synth_code_browser.cjs --root=docs --entry=/synth-dmg/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-dmg/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'dmg-synth-code-browser.json'),screenshots:path.join(tmpdir(),'dmg-synth-code-browser')};
for(const arg of process.argv.slice(2)){
  const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];
}

config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const served=new Map(),missing=[],external=[],blockedMonaco=[],httpErrors=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json',
  '.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
async function until(predicate,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await wait(35);}throw Error('Timeout: '+label);}

function installSilentAudit(){
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const contexts=[],nodes=[],meters=[],commands=[],captureMutes=[];let sequence=0,capture=null;
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...args){
    if(data?.method){commands.push({method:data.method,args:data.args});if(commands.length>10000)commands.shift();}
    return post.call(this,data,...args);
  };
  const muted=()=>meters.every(item=>item.mute.gain.value===0)&&captureMutes.every(item=>item.gain.value===0);
  function sample(item){
    const values=new Float32Array(item.analyser.fftSize);item.analyser.getFloatTimeDomainData(values);
    let square=0,peak=0;for(const value of values){square+=value*value;peak=Math.max(peak,Math.abs(value));}
    return{rms:Math.sqrt(square/values.length),peak,finite:values.every(Number.isFinite)};
  }
  const readOutput=()=>{
    const active=meters.filter(item=>item.source.context.state==='running').map(item=>sample(item)).sort((a,b)=>b.rms-a.rms);
    return{...(active[0]??{rms:0,peak:0,finite:true}),muted:muted()};
  };
  async function read(method='read',args=[]){
    const node=nodes.findLast(item=>item.name==='tetorica-gameboy-synth')?.node;if(!node)throw Error('DMG editor Worklet missing');
    const id=--sequence;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('DMG audit read timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timeout);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});
    });
  }
  async function beginCapture(){
    if(capture)throw Error('Capture already active');
    const source=meters.filter(item=>item.source.context.state==='running').sort((a,b)=>sample(b).rms-sample(a).rms)[0]?.source;
    if(!source)throw Error('No post-Master source');
    const name='dmg-code-fade-audit-'+Math.abs(--sequence),url=URL.createObjectURL(new Blob([
      `class Capture extends AudioWorkletProcessor{process(inputs){const x=inputs[0];if(x?.[0])this.port.postMessage({frame:currentFrame,values:x[0].slice()});return true;}}registerProcessor('${name}',Capture);`
    ],{type:'text/javascript'}));
    try{await source.context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
    const node=new AudioWorkletNode(source.context,name,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]}),mute=source.context.createGain();mute.gain.value=0;captureMutes.push(mute);
    const current=capture={source,node,mute,blocks:[],mark:null};
    node.port.onmessage=({data})=>{if(current.blocks.length<1024)current.blocks.push(data);};
    connect.call(source,node);connect.call(node,mute);connect.call(mute,source.context.destination);
  }
  function finishCapture(){
    const item=capture;capture=null;if(!item||item.mark===null)throw Error('Stop capture missing');
    item.source.disconnect(item.node);item.node.disconnect();item.mute.disconnect();item.node.port.close();
    const blocks=item.blocks.sort((a,b)=>a.frame-b.frame),rate=item.source.context.sampleRate;
    if(blocks.length<20)throw Error('Stop capture is too short');
    const first=blocks[0].frame,last=blocks.at(-1),values=new Float32Array(last.frame+last.values.length-first);
    let expected=first;for(const block of blocks){if(block.frame!==expected)throw Error('Stop capture has render gaps');values.set(block.values,block.frame-first);expected+=block.values.length;}
    const mark=item.mark-first;let beforePeak=0,beforeJump=0,maxJump=0,tailPeak=0,lastNonzero=null;
    for(let i=Math.max(1,mark-Math.round(.05*rate));i<values.length;i++){
      const peak=Math.abs(values[i]),jump=Math.abs(values[i]-values[i-1]);
      if(i<mark-128){beforePeak=Math.max(beforePeak,peak);beforeJump=Math.max(beforeJump,jump);}
      if(i>=mark-128&&i<mark+.04*rate)maxJump=Math.max(maxJump,jump);
      if(i>mark+.05*rate)tailPeak=Math.max(tailPeak,peak);
      if(peak>1e-8)lastNonzero=first+i;
    }
    return{frames:values.length,sampleRate:rate,beforePeak,beforeJump,maxJump,normalizedJump:maxJump/beforePeak,tailPeak,
      lastNonzeroAfterStopMs:lastNonzero===null?null:1000*(lastNonzero-item.mark)/rate,muted:muted()};
  }
  window.__dmgCodeAudit={read,output:readOutput,beginCapture,finishCapture,markStop(){if(!capture)throw Error('Capture missing');capture.mark=Math.round(capture.source.context.currentTime*capture.source.context.sampleRate);},
    graph(){return{contexts:contexts.length,runningContexts:contexts.filter(item=>item.state==='running').length,editorWorklets:nodes.filter(item=>item.name==='tetorica-gameboy-synth').length,
      destinationConnections:meters.length,captureBranches:captureMutes.length,muted:muted()};},drain(){return commands.splice(0);}};
}
const read=(page,method='read')=>page.evaluate(method=>__dmgCodeAudit.read(method),method);
async function pcm(page,nonzero=true){
  let value;await until(async()=>{value=await page.evaluate(()=>__dmgCodeAudit.output());return value.finite&&value.muted&&(nonzero?value.rms>.0001:value.peak<1e-7);},nonzero?'actual APU output':'output silence');return value;
}
async function files(page){if(await page.locator('#dmgFilesPanel').isHidden())await page.locator('#dmgFilesToggle').click();await until(()=>page.locator('#dmgFileImportButton').isEnabled(),'Files ready');}
async function selectFile(page,filename,{code=false}={}){
  await files(page);
  for(let index=0;index<12;index++){const closed=page.locator('#dmgFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}
  await page.locator('#dmgFilesTree button[data-file-path]').locator(`xpath=self::*[@data-file-path=${JSON.stringify(filename)}]`).click();
  await until(()=>page.locator('#dmgFilesSelected').textContent().then(value=>value===filename),'selected '+filename);
  if(code)await page.locator('#synthInputCodeTab').click();
}
async function source(page,text){await selectFile(page,'/index.js',{code:true});await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(text);}
async function execute(page,apply=false){
  await page.locator(apply?'#synthCodeApplyButton':'#synthCodeRunButton').click();
  await until(async()=>{const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return /Running|Playing/.test(await page.locator('#synthCodeState').textContent());},apply?'Apply':'Run');
}
async function stop(page){await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'Code stopped');await wait(150);await pcm(page,false);}
async function download(page,selector){
  if(await page.locator(selector).evaluate(node=>Boolean(node.closest('#synthMenu')))&&!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();
  const pending=page.waitForEvent('download');await page.locator(selector).click();const item=await pending,chunks=[];
  for await(const chunk of await item.createReadStream())chunks.push(chunk);return {name:item.suggestedFilename(),bytes:Buffer.concat(chunks)};
}
const wave=Array.from({length:32},(_,index)=>index%16);
const HOLD=`const gb=await useSoundChip('gameboy');
const {notes}=await import('./notes.mjs');
await livePrepare('setup',async()=>{
  await gb.initialize();
  await gb.pulse.setVoice(0,{duty:.25,volume:6,envelope:{direction:'down',period:0}});
  await gb.pulse.setVoice(1,{duty:.5,volume:4,envelope:{direction:'down',period:0}});
  await gb.wave.stopAndSetWaveform(${JSON.stringify(wave)});
  await gb.wave.setLevel(.5);
  await gb.noise.setVoice({volume:3,envelope:{direction:'down',period:0},divisor:3,shift:4,width:7});
  for(let ch=0;ch<4;ch++)await gb.setPan(ch,true,true);
  await gb.pulse.noteOn(0,notes[0]);await gb.pulse.noteOn(1,notes[1]);
  await gb.wave.noteOn(notes[2]);await gb.noise.keyOn();
  return {ready:true};
});
context.count=(context.count??0)+1;
globalThis.__dmgSaved=gb;
log('apply-count',context.count);
`;
const FADE=`const gb=await useSoundChip('gameboy');
await gb.initialize();
await gb.wave.stopAndSetWaveform(Array.from({length:32},(_,i)=>Math.round(7.5+7.5*Math.sin(i*Math.PI/16))));
await gb.wave.setLevel(1);await gb.wave.noteOn('A3');`;

async function check(browser,name,origin,loadCassette){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'});
  const errors=[],consoleErrors=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installSilentAudit);
  const step=value=>{stage=value;checks.push(value);console.log(`CHECK ${name}: ${value}`);};
  try{
    await page.goto(origin+config.entry);await files(page);
    step('Code / Files mount lazily with a usable fallback and no audio');
    assert.equal((await page.evaluate(()=>__dmgCodeAudit.graph())).contexts,0);
    await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    assert.match(await page.locator('#synthCodeEditor').inputValue(),/useSoundChip\("gameboy"\)/);
    await page.locator('#dmgFilesInput').setInputFiles([
      {name:'notes.mjs',mimeType:'text/javascript',buffer:Buffer.from('export const notes=["A3","C4","E4"];\n')},
      {name:'data.json',mimeType:'application/json',buffer:Buffer.from('{"marker":"dmg-code-files"}\n')},
    ]);
    await until(()=>page.locator('#dmgFilesStatus').textContent().then(value=>/Added 2/.test(value)),'module and data imports');
    await page.locator('#synthInputKeyboardTab').click();await selectFile(page,'/data.json');
    assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'keyboard','Files selection preserves Keyboard');
    await page.locator('#synthInputCodeTab').click();assert.match(await page.locator('#synthCodeEditor').inputValue(),/dmg-code-files/);
    assert(await page.locator('#synthCodeRunButton').isDisabled());assert(await page.locator('#synthCodeApplyButton').isDisabled());
    assert.equal((await page.evaluate(()=>__dmgCodeAudit.graph())).contexts,0,'JSON editing never starts audio');

    step('Real Code addresses both Pulse channels, Wave RAM and Noise on the existing APU');
    await page.locator('#synthInputKeyboardTab').click();await page.locator('#startAudio').click();
    await until(async()=>{try{return Boolean((await read(page)).preset);}catch{return false;}},'editor APU ready');
    await page.locator('#pitchBend').evaluate(input=>{input.value='1.5';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await until(async()=>Math.abs((await read(page)).pitch-1.5)<1e-8,'stored keyboard Pitch before Code');
    const author=await read(page);measurements.preRunPitch=author.pitch;
    await source(page,HOLD);await execute(page);await pcm(page);
    await until(()=>page.locator('#synthCodeLog').textContent().then(value=>/apply-count 1/.test(value)),'first prepared Code');
    const observed=await read(page,'observeCode');assert(observed&&observed.initialized);assert.equal(observed.activeMask,null);
    assert.deepEqual(observed.observation,{registers:'sent',voice:'configured',hardwareEnvelope:false,hardwareSweep:false});
    assert.equal(observed.voice[1]>>6,1);assert.equal(observed.voice[6]>>6,2);assert.equal(observed.voice[18]&8,8);
    assert.deepEqual(observed.registers.slice(32,48),Array.from({length:16},(_,index)=>(wave[index*2]<<4)|wave[index*2+1]));
    assert.deepEqual((await read(page)).preset,author.preset,'Code leaves the authored preset separate');
    assert.equal((await read(page)).pitch,0,'fresh Code resets the stored keyboard Pitch before checkpointing');
    measurements.fourChannels=await pcm(page);
    const graph=await page.evaluate(()=>__dmgCodeAudit.graph());assert.equal(graph.contexts,1);assert.equal(graph.editorWorklets,1);assert.equal(graph.destinationConnections,1);assert(graph.muted);

    step('Live uses editable controls for each physical channel without applying untouched fields');
    await until(()=>page.locator('#voiceEditor').getAttribute('data-readonly').then(value=>value==='false'),'Live editable');
    const startCommands=await page.evaluate(()=>__dmgCodeAudit.drain());
    assert.equal(await page.locator('#instrumentName').evaluate(input=>input.readOnly),true);
    await page.locator('#instrumentName').focus();await page.keyboard.press('Enter');
    assert(await read(page,'observeCode'),'Enter in the read-only instrument name keeps the Code lease');
    assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);
    for(const [channel,kind]of [[0,'Pulse'],[1,'Pulse'],[2,'Wave'],[3,'Noise']]){
      await page.locator('#dmgLiveChannel').selectOption(String(channel));
      await until(()=>page.locator('#dmgLiveReadout').textContent().then(value=>value.includes(`CH ${channel+1} · ${kind}`)),'Live '+kind);
      assert.equal(await page.locator('#voiceEditor').evaluate(node=>node.inert),false);
      assert(await page.locator('[data-choice-for="source"][data-choice-value="pulse"]').isDisabled(),'Physical source is chosen by CH');
      if(channel===2){await fs.mkdir(config.screenshots,{recursive:true});await page.locator('#dmgCodeLiveTools').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(config.screenshots,name+'-live-ch3.png')});}
    }
    const afterViews=await page.evaluate(()=>__dmgCodeAudit.drain());
    assert(!afterViews.some(command=>['setPreset','loadPreset','noteOn','noteOff','stop','beginCode','code'].includes(command.method)),'view changes only observe, never mutate the APU');
    assert.deepEqual((await read(page,'observeCode')).registers,observed.registers);assert.deepEqual((await read(page)).preset,author.preset);
    measurements.observationCommands=startCommands.filter(command=>command.method==='observeCode').length;

    step('Apply retains one Code lease and prepared state; Stop invalidates saved nested clients and restores author Wave RAM');
    await page.locator('#synthCodeEditor').fill(HOLD+"\nawait gb.pulse.setDuty(0,.75);\n");await execute(page,true);
    await until(()=>page.locator('#synthCodeLog').textContent().then(value=>/apply-count 2/.test(value)),'Apply retains context');
    const applied=await read(page,'observeCode');assert.equal(applied.voice[1]>>6,3);
    const applyCommands=await page.evaluate(()=>__dmgCodeAudit.drain());assert(!applyCommands.some(command=>command.method==='beginCode'||command.method==='code'&&command.args[1]==='initialize'));
    await stop(page);const restored=await read(page);assert.deepEqual(restored.preset,author.preset);assert.deepEqual(restored.registers.slice(32,48),author.registers.slice(32,48));
    assert.equal(restored.pitch,0,'Stop restores the zero-Pitch authored checkpoint chosen at fresh Run');
    assert.equal(await read(page,'observeCode'),null);
    assert.equal(await page.evaluate(async()=>{try{await __dmgSaved.pulse.noteOn(0,'C5');return 'allowed';}catch(error){return error.name;}}),'AbortError');
    assert.equal(await page.locator('#voiceEditor').getAttribute('data-readonly'),'false');

    step('Save sound preserves running Code and focus, while a JSON selection remains non-runnable');
    await source(page,HOLD);await execute(page);await pcm(page);await page.locator('#synthCodeEditor').focus();
    const beforeSave=await read(page,'observeCode'),focus=await page.evaluate(()=>document.activeElement.id);
    await page.locator('#dmgFileSaveSoundButton').click();await until(()=>page.locator('#dmgFilesStatus').textContent().then(value=>/Current DMG instrument saved/.test(value)),'Save sound');
    assert.equal(await page.evaluate(()=>document.activeElement.id),focus);assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'code');
    const sound=JSON.parse(await page.locator('#synthCodeEditor').inputValue());assert.deepEqual(sound,author.preset);
    assert(await page.locator('#synthCodeRunButton').isDisabled());assert(await page.locator('#synthCodeApplyButton').isDisabled());
    assert.deepEqual((await read(page,'observeCode')).registers,beforeSave.registers);assert(await page.locator('#synthCodeStopButton').isEnabled());
    const projectDownload=await download(page,'#dmgProjectExportButton'),project=await loadCassette(projectDownload.bytes);
    assert(project.files.has('index.js')&&project.files.has('notes.mjs')&&project.files.has('data.json'));
    assert(project.files.has('dmg-synth.project.json'));measurements.projectBytes=projectDownload.bytes.length;
    await stop(page);

    step('Selecting Pulse / Wave / Noise presets keeps Run, context, prepared state, FX and the same Code client');
    const sounds=['pulse','wave','noise'].map(source=>{const value=structuredClone(author.preset);value.source=source;value.name='Live '+source;
      if(source==='wave')value.wave.samples=Array.from({length:32},(_,i)=>i<16?3:12);
      return {name:'Live '+source+'.dmg.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))};});
    sounds.push({name:'Invalid.dmg.json',mimeType:'application/json',buffer:Buffer.from('{"kind":"invalid"}')});
    await page.locator('#dmgFilesInput').setInputFiles(sounds);
    await until(()=>page.locator('#dmgFilesStatus').textContent().then(value=>/Added 4/.test(value)),'live preset imports');
    await source(page,`const gb=await useSoundChip('gameboy');
context.boots=(context.boots??0)+1;
const prepared=await livePrepare('preset-check',()=>({visits:0}));
globalThis.__livePreset={gb,context,prepared,ticks:0,source:null};
liveFx('preset-level',{context:{gain:.25},process(input,output,state,context){for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i]*context.gain;}});
liveLoop('preset-melody',async()=>{const p=globalThis.__livePreset,source=(await gb.getState()).editorSource;p.source=source;p.ticks++;prepared.visits++;
if(source==='noise')await gb.noise.keyOn();else if(source==='wave')await gb.wave.noteOn('A3');else await gb.pulse.noteOn(0,'A3');
await sleep(.12);if(source==='noise')await gb.noise.keyOff();else if(source==='wave')await gb.wave.keyOff();else await gb.pulse.keyOff(0);await sleep(.04);});`);
    await execute(page);await pcm(page);await page.evaluate(()=>{window.__liveIdentity=__livePreset;__dmgCodeAudit.drain();});
    const presetSignals=[];
    for(const expected of ['pulse','wave','noise']){
      const before=await page.evaluate(()=>__livePreset.ticks);
      await selectFile(page,'/Live '+expected+'.dmg.json');
      await until(()=>page.evaluate(({expected,before})=>__livePreset.source===expected&&__livePreset.ticks>before,{expected,before}),'loop follows '+expected);
      assert.match(await page.locator('#synthCodeState').textContent(),/Playing|Running/);assert(await page.locator('#synthCodeStopButton').isEnabled());
      assert(await page.evaluate(()=>__livePreset===__liveIdentity&&__livePreset.context.boots===1&&__livePreset.prepared.visits===__livePreset.ticks&&__livePreset.gb.isCurrent()));
      assert.equal((await read(page)).preset.source,expected);presetSignals.push({source:expected,signal:await pcm(page)});
    }
    await selectFile(page,'/Invalid.dmg.json');const beforeInvalid=await page.evaluate(()=>__livePreset.ticks);
    await until(()=>page.evaluate(before=>__livePreset.ticks>before,beforeInvalid),'invalid JSON keeps loop');assert.equal((await read(page)).preset.source,'noise');
    const liveCommands=await page.evaluate(()=>__dmgCodeAudit.drain());
    assert.equal(liveCommands.filter(command=>command.method==='applyCodePreset').length,3);
    assert(!liveCommands.some(command=>['stop','beginCode','loadPreset','setPreset'].includes(command.method)),'Preset selection must not replace Code ownership');
    await stop(page);assert.equal((await read(page)).preset.source,'noise');assert.equal(await read(page,'observeCode'),null);
    measurements.livePresets=presetSignals;

    step('Code melody survives direct edits to CH2 Duty, Envelope and pan, CH3 Wave RAM and CH4 Noise clock');
    await selectFile(page,'/Live pulse.dmg.json');
    await source(page,`const gb=await useSoundChip('gameboy');
await gb.pulse.setVoice(0,{duty:.25,volume:5,envelope:{direction:'down',period:0}});
await gb.pulse.setVoice(1,{duty:.5,volume:6,envelope:{direction:'down',period:0}});
await gb.pulse.noteOn(1,'A3');await gb.setPan(0,true,true);await gb.setPan(1,true,true);
context.boots=(context.boots??0)+1;const prepared=await livePrepare('direct-edit',()=>({ticks:0}));
globalThis.__dmgEditProbe={gb,context,prepared};
liveFx('edit-level',{context:{gain:.5},process(input,output,state,context){for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i]*context.gain;}});
liveLoop('melody',async()=>{prepared.ticks++;await gb.pulse.noteOn(0,prepared.ticks%2?'C4':'E4');await sleep(.12);await gb.pulse.keyOff(0);await sleep(.03);});`);
    await execute(page);await pcm(page);await page.locator('#dmgLiveChannel').selectOption('1');
    await until(()=>page.locator('#pulseVolume').textContent().then(value=>value==='6'),'CH2 volume view');
    const beforeEdit=await read(page,'observeCode');await page.evaluate(()=>{window.__dmgEditIdentity=__dmgEditProbe;__dmgCodeAudit.drain();});
    await page.locator('[data-choice-for="pulseDuty"][data-choice-value="0.75"]').click();
    await page.locator('[data-stepper-for="pulseVolume"][data-stepper-delta="1"]').click();
    await page.locator('#panLeft').uncheck();
    await until(async()=>{const value=await read(page,'observeCode');return value.voice[6]>>6===3&&value.voice[7]>>4===7&&!(value.registers[21]&32);},'direct CH2 edits');
    const afterEdit=await read(page,'observeCode');assert.equal(afterEdit.voice[1],beforeEdit.voice[1]);assert.equal(afterEdit.voice[2],beforeEdit.voice[2]);
    assert.deepEqual(afterEdit.registers.slice(8,10),beforeEdit.registers.slice(8,10),'CH2 keeps its held pitch');assert.equal(afterEdit.registers[21]&16,beforeEdit.registers[21]&16,'CH1 pan is kept');
    assert(await page.locator('#sweepEnabled').isDisabled(),'CH2 cannot acquire CH1 Sweep');
    await page.locator('#dmgLiveChannel').selectOption('2');await until(()=>page.locator('#waveCanvas').isVisible(),'CH3 editor');
    await page.locator('[data-wave-shape="triangle"]').click();
    await until(async()=>{const value=await read(page);return value.preset.wave.samples[0]===0&&value.preset.wave.samples[16]===15;},'CH3 wave applied');
    await page.locator('#dmgLiveChannel').selectOption('3');await until(()=>page.locator('#noiseShift').isVisible(),'CH4 editor');
    const noiseShift=Number(await page.locator('#noiseShift').textContent());await page.locator('[data-stepper-for="noiseShift"][data-stepper-delta="1"]').click();
    await until(async()=>((await read(page,'observeCode')).voice[18]>>4)===noiseShift+1,'CH4 Noise clock applied');
    await until(()=>page.evaluate(()=>__dmgEditProbe.prepared.ticks>2),'Code melody continues after edits');
    assert(await page.evaluate(()=>__dmgEditProbe===__dmgEditIdentity&&__dmgEditProbe.context.boots===1&&__dmgEditProbe.gb.isCurrent()));
    const editCommands=await page.evaluate(()=>__dmgCodeAudit.drain());assert(editCommands.filter(item=>item.method==='applyCodeEdit').length>=5);
    assert(!editCommands.some(item=>['stop','beginCode','loadPreset','setPreset'].includes(item.method)));
    measurements.directEdits={before:beforeEdit.voice.slice(0,10),after:afterEdit.voice.slice(0,10),signal:await pcm(page)};
    await stop(page);const editedAuthor=await read(page);assert.equal(editedAuthor.preset.pulse.duty,.75);assert.equal(editedAuthor.preset.pulse.volume,7);assert.equal(editedAuthor.preset.noise.shift,noiseShift+1);

    step('Keyboard and Code are views: parameter-only Code keeps running while real keys own and release notes');
    await source(page,`const gb=await useSoundChip('gameboy');await gb.pulse.setVoice(0,{volume:7,envelope:{direction:'down',period:0}});await gb.setPan(0,true,true);
const prepared=await livePrepare('keyboard-motion',()=>({ticks:0}));context.boots=(context.boots??0)+1;
globalThis.__dmgParamProbe={gb,prepared,context};
liveLoop('motion',async()=>{prepared.ticks++;await gb.pulse.setDuty(0,prepared.ticks%2?.25:.5);await sleep(.04);});`);
    await execute(page);await pcm(page,false);await page.locator('#dmgLiveChannel').selectOption('0');
    const tabBefore=await read(page,'observeCode'),ticks=await page.evaluate(()=>__dmgParamProbe.prepared.ticks);
    await page.locator('#synthInputKeyboardTab').click();await until(()=>page.locator('#synthInputSection').getAttribute('data-input-mode').then(value=>value==='keyboard'),'Keyboard view');assert(await page.locator('#synthCodeStopButton').isVisible());
    assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);
    await page.keyboard.down('z');await pcm(page);await until(async()=>(await read(page)).voices.length===1,'Keyboard borrows Code-owned APU');
    const heldId=(await read(page)).voices[0].id;await wait(150);assert.equal((await read(page)).voices[0].id,heldId,'Parameter automation does not steal the keyboard gate');
    assert(await page.evaluate(before=>__dmgParamProbe.prepared.ticks>before,ticks));
    assert((await read(page,'observeCode')).positionFrames>tabBefore.positionFrames);
    await page.locator('#synthInputCodeTab').click();await pcm(page);await page.keyboard.up('z');await pcm(page,false);
    assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);
    await page.locator('#synthInputKeyboardTab').click();await until(()=>page.locator('#synthInputSection').getAttribute('data-input-mode').then(value=>value==='keyboard'),'Keyboard view again');await page.keyboard.down('z');await pcm(page);
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await pcm(page,false);await page.keyboard.up('z');
    assert(await read(page,'observeCode'),'Blur releases only Keyboard notes');
    await stop(page);assert.equal(await read(page,'observeCode'),null);
    await page.keyboard.down('z');await pcm(page);await page.keyboard.up('z');await pcm(page,false);
    assert.equal(await read(page,'observeCode'),null,'Keyboard resumes after the shared Code Stop');

    step('Software Stop fades the real output to silence and reaches the physical restore fence');
    await source(page,FADE);await execute(page);await pcm(page);await wait(130);
    await page.evaluate(()=>__dmgCodeAudit.beginCapture());await wait(100);
    await page.locator('#synthCodeStopButton').evaluate(button=>button.addEventListener('click',()=>__dmgCodeAudit.markStop(),{once:true,capture:true}));
    await stop(page);await wait(180);measurements.stopFade=await page.evaluate(()=>__dmgCodeAudit.finishCapture());
    assert(measurements.stopFade.beforePeak>.001);assert(measurements.stopFade.tailPeak<1e-7);assert(measurements.stopFade.normalizedJump<1,'a smooth Wave is not cut at one full-scale sample');assert(measurements.stopFade.muted);

    step('Files restore preserves text and selection without creating audio or executing saved Code');
    await page.locator('#dmgProjectFileInput').setInputFiles({name:'dmg-project.zip',mimeType:'application/zip',buffer:projectDownload.bytes});
    await until(()=>page.locator('#dmgFilesStatus').textContent().then(value=>/Imported|imported|Project loaded|Project imported/.test(value)),'project import');
    assert.equal(await read(page,'observeCode'),null);await selectFile(page,'/index.js',{code:true});assert.match(await page.locator('#synthCodeEditor').inputValue(),/livePrepare/);
    await until(()=>page.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('tetorica-dmg-synth-files',1);request.onsuccess=()=>{const db=request.result,get=db.transaction('projects','readonly').objectStore('projects').get('current');get.onsuccess=()=>{db.close();resolve(get.result?.codeState?.path==='/index.js'&&get.result?.codeState?.mode==='code');};get.onerror=()=>resolve(false);};request.onerror=()=>resolve(false);})), 'persisted editor selection');
    await page.reload();await files(page);await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    assert.match(await page.locator('#synthCodeEditor').inputValue(),/livePrepare/);assert.equal((await page.evaluate(()=>__dmgCodeAudit.graph())).contexts,0);
    assert.match(await page.locator('#synthCodeState').textContent(),/Idle|Stopped/);

    step('Maximize and 390px keep one visible Code editor beside Files without horizontal overflow');
    for(const width of [1240,390]){
      await page.setViewportSize({width,height:1050});await page.locator('#synthCodeExpandButton').click();
      assert(await page.locator('#synthExpandedCodeSlot #synthCodeEditor').isVisible());assert(await page.locator('#dmgFilesPanel').isVisible());
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'expanded layout fits '+width);
      await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-'+width+'.png'),fullPage:true});
      await page.locator('#synthCodeExpandButton').click();assert(await page.locator('#synthCodeEditor').isVisible());
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'normal layout fits '+width);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    return {browser:name,passed:true,checks,measurements,graph:await page.evaluate(()=>__dmgCodeAudit.graph()),pageErrors:errors,consoleErrors};
  }catch(error){
    const diagnostic={stage,codeState:await page.locator('#synthCodeState').textContent().catch(()=>''),codeError:await page.locator('#synthCodeError').textContent().catch(()=>''),status:await page.locator('#audioStatus').textContent().catch(()=>''),live:await page.locator('#dmgLiveStatus').textContent().catch(()=>''),commands:await page.evaluate(()=>__dmgCodeAudit.drain()).catch(()=>[])};
    await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});
    error.receipt={browser:name,passed:false,error:error.stack,checks,measurements,diagnostic,pageErrors:errors,consoleErrors};throw error;
  }finally{await page.close();}
}

const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),metadata,'Asset changed during check');served.set(key,metadata);
  res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  const {loadPlaygroundCassette}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')).href);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;
  let failure=null;
  try{
    for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
      try{results.push(await check(browser,name,origin,loadPlaygroundCassette));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert(blockedMonaco.length,'fallback was exercised');
  }catch(error){failure=error;}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results,missing,external,expectedBlockedMonaco:blockedMonaco,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');
  if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
