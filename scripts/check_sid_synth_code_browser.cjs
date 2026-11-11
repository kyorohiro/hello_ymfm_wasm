// Real SID Synth Code/Files integration, headless and physically silent.
// Every destination connection is intercepted before application code loads
// and passes through gain zero. Chromium also starts with --mute-audio.
// node scripts/check_sid_synth_code_browser.cjs --root=docs --entry=/synth-sid/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-sid/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'sid-synth-code-browser.json'),screenshots:path.join(tmpdir(),'sid-synth-code-browser')};
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
  async function read(){
    const node=nodes.findLast(item=>item.name==='tetorica-sid-synth')?.node;if(!node)throw Error('SID editor Worklet missing');
    const id=--sequence;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('SID audit read timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timeout);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method:'read',args:[]});
    });
  }
  async function beginCapture(){
    if(capture)throw Error('Capture already active');
    const source=meters.filter(item=>item.source.context.state==='running').sort((a,b)=>sample(b).rms-sample(a).rms)[0]?.source;
    if(!source)throw Error('No post-Master source');
    const name='sid-code-fade-audit-'+Math.abs(--sequence),url=URL.createObjectURL(new Blob([
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
  window.__sidCodeAudit={read,output:readOutput,beginCapture,finishCapture,markStop(){if(!capture)throw Error('Capture missing');capture.mark=Math.round(capture.source.context.currentTime*capture.source.context.sampleRate);},
    graph(){return{contexts:contexts.length,runningContexts:contexts.filter(item=>item.state==='running').length,editorWorklets:nodes.filter(item=>item.name==='tetorica-sid-synth').length,
      destinationConnections:meters.length,captureBranches:captureMutes.length,muted:muted()};},drain(){return commands.splice(0);}};
}

async function snapshot(page){return page.evaluate(()=>__sidCodeAudit.read());}
async function stateIs(page,predicate,label){let current;await until(async()=>{current=await snapshot(page);return predicate(current);},label);return current;}
async function output(page){await wait(130);const value=await page.evaluate(()=>__sidCodeAudit.output());assert(value.finite&&value.muted,'finite output behind physical gain zero');return value;}
async function sounding(page){let value;await until(async()=>{value=await page.evaluate(()=>__sidCodeAudit.output());return value.finite&&value.muted&&value.rms>.0001;},'actual SID PCM');return output(page);}
async function silent(page){await wait(150);await until(async()=>{const value=await page.evaluate(()=>__sidCodeAudit.output());return value.finite&&value.muted&&value.peak<1e-7;},'SID output silence');}
async function source(page,text){await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(text);}
async function execute(page,apply=false){await page.locator(apply?'#synthCodeApplyButton':'#synthCodeRunButton').click();await until(async()=>{
  const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);
  return /Running|Playing/.test(await page.locator('#synthCodeState').textContent());
},apply?'Apply completes':'Run completes');}
async function stopped(page){await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'Code stopped');await silent(page);}
async function stop(page){await page.locator('#synthCodeStopButton').click();await stopped(page);}
async function range(page,id,value){await page.locator('#'+id).evaluate((input,next)=>{input.value=String(next);input.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function files(page){if(await page.locator('#sidFilesPanel').isHidden())await page.locator('#sidFilesToggle').click();await until(()=>page.locator('#sidFileImportButton').isEnabled(),'Files ready');}
async function selectFile(page,filename){
  await files(page);for(let i=0;i<10;i++){const closed=page.locator('#sidFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}
  await page.locator('#sidFilesTree button.file-entry').locator(`xpath=self::*[@data-file-path=${JSON.stringify(filename)}]`).click();
  await until(()=>page.locator('#sidFilesSelected').textContent().then(value=>value===filename),'select '+filename);
}
async function download(page,id){const task=page.waitForEvent('download');await page.locator(id).click();const item=await task,chunks=[];for await(const chunk of await item.createReadStream())chunks.push(chunk);return{bytes:Buffer.concat(chunks),name:item.suggestedFilename()};}
async function savedSound(page){await files(page);await page.locator('#sidFileSaveSoundButton').click();await until(()=>page.locator('#sidFilesStatus').textContent().then(value=>/Current three-channel setup saved/.test(value)),'Save sound');return JSON.parse(await page.locator('#sidFileTextEditor').inputValue());}
const gate=(state,channel)=>Boolean(state.registers[channel*7+4]&1);
const frequency=(state,channel)=>state.registers[channel*7]|state.registers[channel*7+1]<<8;
const HOLD=`const sid=await useSoundChip('sid');
await sid.setVoice(CH1,{waveform:'triangle',attack:0,decay:2,sustain:10,release:4});
await sid.setFilter({mode:'off',routing:0,voice3off:false,volume:8});
await sid.noteOn(CH1,'A4');
globalThis.__sidSaved=sid;
log('held-a4');
`;

async function check(browser,name,origin,loadCassette,tune){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'});
  const errors=[],consoleErrors=[],ignoredConsole=[],requestFailures=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()!=='error')return;const text=message.text(),url=message.location().url;
    if(/cdnjs\.cloudflare\.com/.test(text+' '+url)||/^Failed to load resource/.test(text)&&blockedMonaco.length)ignoredConsole.push(text);else consoleErrors.push(text);});
  page.on('requestfailed',request=>requestFailures.push({url:request.url(),error:request.failure()?.errorText}));
  page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>{const url=new URL(route.request().url());
    if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installSilentAudit);
  const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);await files(page);
    // Configure song-follow while no Code session owns the shared checkbox.
    // Code has a separate, default-On Live choice and does not change this.
    if(await page.locator('#sidLiveEnabled').isChecked())await page.locator('#sidLiveEnabled').uncheck();
    step('Code and Files mount without audio or autorun; local editor fallback and modules/data share the project');
    assert.equal((await page.evaluate(()=>__sidCodeAudit.graph())).contexts,0);
    await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    assert.match(await page.locator('#synthCodeEditor').inputValue(),/useSoundChip\("sid"\)/);
    const notes='export const notes=["A4","C5","E5"];\n',data='{"marker":"sid-code-files"}\n';
    await page.locator('#sidFilesInput').setInputFiles([{name:'notes.js',mimeType:'text/javascript',buffer:Buffer.from(notes)},{name:'notes.json',mimeType:'application/json',buffer:Buffer.from(data)}]);
    await until(()=>page.locator('#sidFilesStatus').textContent().then(value=>/Added 2 file/.test(value)),'module/data imports');
    assert.equal((await page.evaluate(()=>__sidCodeAudit.graph())).contexts,0);
    const initialSound=await savedSound(page);await selectFile(page,'/index.js');
    await source(page,`const {notes}=await import('./notes.js');const data=await file('./notes.json',{type:'json'});
const sid=await useSoundChip('sid');context.marker=data.marker;
for(let channel=0;channel<3;channel++)await sid.noteOn(channel,notes[channel]);
log('files-ready',context.marker);`);
    await execute(page);await sounding(page);let state=await stateIs(page,value=>[0,1,2].every(ch=>gate(value,ch)),'three explicit SID gates');
    for(const[channel,midi]of [69,72,76].entries())assert.equal(frequency(state,channel),Math.round(440*2**((midi-69)/12)*16777216/985248));
    assert.deepEqual(await savedSound(page),initialSound,'Code gates do not overwrite the authored sound');
    assert.match(await page.locator('#synthCodeLog').textContent(),/files-ready sid-code-files/);
    const graph=await page.evaluate(()=>__sidCodeAudit.graph());assert.equal(graph.contexts,1);assert.equal(graph.editorWorklets,1);assert(graph.muted);
    await stop(page);state=await snapshot(page);assert([0,1,2].every(ch=>!gate(state,ch)));assert.deepEqual(state.channelSettings,initialSound);

    step('liveFx processes actual shared SID PCM, and Apply removal restores the direct signal');
    const fxHold=HOLD.replace("await sid.noteOn(CH1,'A4');","if(!context.fxHeld){await sid.noteOn(CH1,'A4');context.fxHeld=true;}");
    await source(page,fxHold);await execute(page);await sounding(page);await wait(200);const fxFull=await output(page);
    const halfFx=`liveFx('half',{process(input,output){for(let ch=0;ch<output.length;ch++)for(let i=0;i<output[ch].length;i++)output[ch][i]=(input[ch]?.[i]??0)*.5;}});`;
    await page.locator('#synthCodeEditor').fill(fxHold+halfFx);await execute(page,true);await wait(200);const fxHalf=await output(page);
    assert(Math.abs(fxHalf.rms/fxFull.rms-.5)<.08,'liveFx halves real PCM once: '+JSON.stringify({fxFull,fxHalf}));
    await page.locator('#synthCodeEditor').fill(fxHold);await execute(page,true);await wait(200);const fxRestored=await output(page);
    assert(Math.abs(fxRestored.rms/fxFull.rms-1)<.1,'removing liveFx restores the held signal');
    assert.equal((await page.evaluate(()=>__sidCodeAudit.graph())).contexts,1);measurements.liveFx={full:fxFull,half:fxHalf,restored:fxRestored};await stop(page);

    step('temporary Code registers keep authored presets; upper Filter and Master control the same SID output once');
    await source(page,HOLD+`await sid.setVoice(CH2,{waveform:'pulse',pulseWidth:777});await sid.setFilter({cutoff:321,resonance:7});`);await execute(page);await sounding(page);
    state=await snapshot(page);assert.equal(state.registers[4]&0xf0,0x10);assert.equal(state.registers[9]|(state.registers[10]&15)<<8,777);
    assert.deepEqual(await savedSound(page),initialSound,'temporary voice/filter edits stay outside authoring JSON');
    await range(page,'masterVolume',1);const full=await output(page);await range(page,'masterVolume',.5);const half=await output(page);
    assert(Math.abs(half.rms/full.rms-.5)<.08,'Master applies once');await range(page,'masterVolume',1);
    // Live uses the same controls read-only. Turn it off before deliberately
    // editing the authored sound, keeping the running Code session unchanged.
    if(await page.locator('#sidLiveEnabled').isChecked())await page.locator('#sidLiveEnabled').uncheck();
    await until(()=>page.locator('#voiceEditor').getAttribute('data-observing').then(value=>value==='false'),'Code Live returns to authoring');
    if(!await page.locator('#filterEnabled').isChecked())await page.locator('#filterEnabled').check();
    await range(page,'filterCutoffRange',1234);state=await stateIs(page,value=>(value.registers[21]&7|value.registers[22]<<3)===1234,'upper cutoff reaches Code SID');
    assert(gate(state,0),'upper non-topology edits preserve the Code gate');assert.match(await page.locator('#synthCodeState').textContent(),/Running/);
    const sameGraph=await page.evaluate(()=>__sidCodeAudit.graph());assert.equal(sameGraph.contexts,1);assert.equal(sameGraph.editorWorklets,1);
    measurements.master={full,half};await stop(page);const authored=await savedSound(page);assert.equal(authored.channels[0].filter.cutoff,1234);

    step('Apply preserves context and named loops; Stop fades actual PCM and restores authoring data');
    const loop=`const sid=await useSoundChip('sid');context.applies=(context.applies??0)+1;log('applies',context.applies);
globalThis.__sidLoop??={active:0,max:0,ticks:0};liveLoop('phrase',async()=>{const p=globalThis.__sidLoop;p.active++;p.max=Math.max(p.max,p.active);
try{await sid.noteOn(CH1,'A4');await sleep(.04);await sid.noteOff(CH1);p.ticks++;await beat(.25);}finally{p.active--;}});`;
    await source(page,loop);await execute(page);await until(()=>page.evaluate(()=>__sidLoop.ticks>=1),'first loop iteration');
    await page.locator('#synthCodeEditor').fill(loop);await execute(page,true);await until(()=>page.evaluate(()=>__sidLoop.ticks>=3),'retained loop iterations');
    const loopState=await page.evaluate(()=>({...__sidLoop}));assert.equal(loopState.max,1);assert.match(await page.locator('#synthCodeLog').textContent(),/applies 2/);
    await page.locator('#synthCodeEditor').fill('log("removed",context.applies);');await execute(page,true);await silent(page);assert(!/loop/.test(await page.locator('#synthCodeState').textContent()));
    await source(page,HOLD);await execute(page);await sounding(page);await page.evaluate(()=>__sidCodeAudit.beginCapture());await wait(110);
    await page.evaluate(()=>{__sidCodeAudit.markStop();document.getElementById('synthCodeStopButton').click();});await stopped(page);await wait(120);
    const fade=await page.evaluate(()=>__sidCodeAudit.finishCapture());assert(fade.muted&&fade.beforePeak>.0001&&fade.tailPeak<1e-7);
    assert(fade.normalizedJump<.25,'Stop avoids a full-scale discontinuity: '+JSON.stringify(fade));assert(fade.lastNonzeroAfterStopMs<40,'Stop fade is bounded');
    measurements.fade=fade;state=await snapshot(page);assert.deepEqual(state.channelSettings,authored);assert([0,1,2].every(ch=>!gate(state,ch)));
    const stale=await page.evaluate(()=>{try{__sidSaved.noteOn(0,'C6');return false;}catch(error){return error.name==='AbortError';}});assert(stale);await silent(page);

    step('a stopped awaited Run cannot revive; model switches and Keyboard return retain a reusable single graph');
    await source(page,`const sid=await useSoundChip('sid');globalThis.__sidLateBlocked=false;log('late-ready');
await new Promise(resolve=>globalThis.__sidLateRelease=resolve);try{await sid.noteOn(CH1,'C6');}catch(error){globalThis.__sidLateBlocked=error.name==='AbortError';}`);
    await page.locator('#synthCodeRunButton').click();await until(()=>page.locator('#synthCodeLog').textContent().then(value=>/late-ready/.test(value)),'awaited Run begins');
    await stop(page);await page.evaluate(()=>__sidLateRelease());await until(()=>page.evaluate(()=>__sidLateBlocked),'late handle blocked');await silent(page);
    for(const model of ['8580','6581']){
      await source(page,HOLD);await execute(page);await sounding(page);
      if(await page.locator('#sidLiveEnabled').isChecked())await page.locator('#sidLiveEnabled').uncheck();
      await until(()=>page.locator('#voiceEditor').getAttribute('data-observing').then(value=>value==='false'),'authoring before model change');
      await page.locator(`[data-choice-for="sidModel"][data-value="${model}"]`).click();await stateIs(page,value=>value.model===model&&!gate(value,0),'model change '+model);await stopped(page);
      assert.equal((await page.evaluate(()=>__sidCodeAudit.graph())).contexts,1);
    }
    await source(page,HOLD);await execute(page);await page.locator('#synthInputKeyboardTab').click();await silent(page);
    const key=await page.locator('#keyboard .key:not([disabled])').first().getAttribute('data-key');assert(key);
    await page.keyboard.down(key);await stateIs(page,value=>value.voices.length>0,'keyboard after Code');await sounding(page);await page.keyboard.up(key);await page.locator('#stopAudio').click();await silent(page);
    await page.keyboard.down(key);await stateIs(page,value=>value.voices.length>0,'keyboard reopens output after header Stop');
    await sounding(page);await page.keyboard.up(key);await page.locator('#stopAudio').click();await silent(page);
    measurements.keyboardAfterHeaderStop=true;

    step('project ZIP retains source, modules, data and saved sounds; import/reload never runs Code');
    await source(page,'globalThis.__sidProjectRan=(globalThis.__sidProjectRan??0)+1;\n');
    const archive=await download(page,'#sidProjectExportButton'),contents=await loadCassette(archive.bytes);
    for(const[file,expected]of [['notes.js',notes],['notes.json',data],['index.js','globalThis.__sidProjectRan=(globalThis.__sidProjectRan??0)+1;\n']])assert.equal(Buffer.from(contents.files.get(file)).toString(),expected);
    assert(contents.files.has('sid-synth.project.json'));assert(contents.files.has('presets/current.sid-channels.json'));
    await page.locator('#sidProjectFileInput').setInputFiles({name:'roundtrip.cassette.zip',mimeType:'application/zip',buffer:archive.bytes});
    await until(()=>page.locator('#sidFilesStatus').textContent().then(value=>/project imported/.test(value)),'project imported');await silent(page);
    assert.equal(await page.evaluate(()=>typeof __sidProjectRan),'undefined');
    await page.reload();await files(page);await until(()=>page.locator('#synthCodeEditor').inputValue().then(value=>value.includes('__sidProjectRan')),'restored Code source');
    if(await page.locator('#sidLiveEnabled').isChecked())await page.locator('#sidLiveEnabled').uncheck();
    assert.equal(await page.evaluate(()=>typeof __sidProjectRan),'undefined');assert.equal((await page.evaluate(()=>__sidCodeAudit.graph())).contexts,0);
    await selectFile(page,'/notes.json');assert.equal(await page.locator('#sidFileTextEditor').inputValue(),data);await selectFile(page,'/index.js');
    const restored=await savedSound(page);assert.deepEqual(restored,authored);

    step('SID song and Code exchange playback ownership; pagehide stops Code; 1240/390 layouts remain bounded');
    await source(page,HOLD);await execute(page);await sounding(page);
    await page.locator('#sidImportTools').evaluate(node=>{node.open=true;});
    if(await page.locator('#sidLiveEnabled').isChecked())await page.locator('#sidLiveEnabled').uncheck();
    await page.locator('#sidSoundFileInput').setInputFiles({name:'authored-tone.sid',mimeType:'application/octet-stream',buffer:Buffer.from(tune)});
    await until(()=>page.locator('#sidImportPlay').isEnabled(),'SID fixture ready');await page.locator('#sidImportPlay').click();
    await until(()=>page.locator('#sidImportPause').isEnabled(),'SID preview started');
    // Song output is expected here; only Code state is stopped.
    await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped/.test(value)),'song stops Code');
    state=await snapshot(page);assert([0,1,2].every(ch=>!gate(state,ch)));await sounding(page);
    await source(page,HOLD);await execute(page);await until(()=>page.locator('#sidImportPause').isDisabled(),'Code stopped SID preview');await sounding(page);
    await page.locator('#synthCodeExpandButton').click();assert.equal(await page.locator('#synthCodeExpandButton').getAttribute('aria-pressed'),'true');
    await fs.mkdir(config.screenshots,{recursive:true});
    for(const width of [1240,390]){await page.setViewportSize({width,height:1050});await wait(100);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page horizontal overflow');await page.screenshot({path:path.join(config.screenshots,`${name}-sid-code-${width}.png`),fullPage:true});}
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await stopped(page);
    assert.equal(await page.locator('#synthCodeError').textContent(),'');assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    const finalGraph=await page.evaluate(()=>__sidCodeAudit.graph());assert(finalGraph.muted);measurements.graph=finalGraph;
    return{browser:name,passed:true,checks,measurements,errors,consoleErrors,expectedFallbackConsole:ignoredConsole,requestFailures};
  }catch(error){
    await fs.mkdir(config.screenshots,{recursive:true});try{await page.screenshot({path:path.join(config.screenshots,`${name}-sid-code-failure.png`),fullPage:true});}catch{}
    let diagnostic=null;try{diagnostic=await page.evaluate(async()=>({state:await __sidCodeAudit.read(),output:__sidCodeAudit.output(),graph:__sidCodeAudit.graph(),
      label:document.getElementById('synthCodeState').textContent,error:document.getElementById('synthCodeError').textContent,
      log:document.getElementById('synthCodeLog').textContent,commands:__sidCodeAudit.drain().slice(-35)}));}catch{}
    error.receipt={browser:name,passed:false,stage,error:error.stack??String(error),checks,measurements,diagnostic,errors,consoleErrors,expectedFallbackConsole:ignoredConsole,requestFailures};throw error;
  }finally{await page.close();}
}

const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),metadata,'Asset changed during browser check');served.set(key,metadata);
  res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  const {loadPlaygroundCassette}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')).href);
  const {createSidReferenceFixture}=await import(pathToFileURL(path.join(repo,'test/fixtures/sid-reference/fixture.mjs')).href);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;
  let failure=null;
  try{
    for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
      try{results.push(await check(browser,name,origin,loadPlaygroundCassette,createSidReferenceFixture('tone').bytes));}
      catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}
      finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);assert(blockedMonaco.length,'Monaco fallback was exercised');
  }catch(error){failure=error;}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,
    results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');
  if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
