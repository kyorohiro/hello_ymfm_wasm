// Run continues across SID preset selection: real Worklet/PCM, physical output gain zero.
// Every destination connection is intercepted before application code loads
// and passes through gain zero. Chromium also starts with --mute-audio.
// node scripts/check_sid_synth_code_browser.cjs --root=docs --entry=/synth-sid/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-sid/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'sid-synth-live-presets-browser.json'),screenshots:path.join(tmpdir(),'sid-synth-live-presets-browser')};
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
  const contexts=[],nodes=[],meters=[],commands=[],captureMutes=[];let rawMeter=null;let sequence=0,capture=null;
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
  window.__sidCodeAudit={read,output:readOutput,
    fxOutput(){
      if(!rawMeter){
        const source=nodes.findLast(item=>item.name==='tetorica-sid-synth')?.node;if(!source)throw Error('SID missing');
        const analyser=source.context.createAnalyser(),mute=source.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
        connect.call(source,analyser);connect.call(analyser,mute);connect.call(mute,source.context.destination);captureMutes.push(mute);rawMeter={analyser,mute};
      }
      return {raw:sample(rawMeter),processed:readOutput(),muted:muted()};
    },beginCapture,finishCapture,markStop(){if(!capture)throw Error('Capture missing');capture.mark=Math.round(capture.source.context.currentTime*capture.source.context.sampleRate);},
    graph(){return{contexts:contexts.length,runningContexts:contexts.filter(item=>item.state==='running').length,editorWorklets:nodes.filter(item=>item.name==='tetorica-sid-synth').length,
      fxWorklets:nodes.filter(item=>item.name==='tetorica-native-fx').length,destinationConnections:meters.length,captureBranches:captureMutes.length,muted:muted()};},drain(){return commands.splice(0);}};
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

async function check(browser,name,origin,loadCassette){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'});
  const errors=[],checks=[],measurements={};let stage='startup';page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(error.stack??error.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());
    if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installSilentAudit);
  const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  const proof=()=>page.evaluate(()=>({ticks:__sidLivePreset.prepared.ticks,runs:__sidLivePreset.context.runs,
    prepared:__sidPreparedCount,model:__sidLivePreset.sid.model,
    sameContext:__sidLivePreset.context===__originalSidContext,samePrepared:__sidLivePreset.prepared===__originalSidPrepared,
    sameClient:__sidLivePreset.sid===__originalSidClient}));
  async function continued(after){
    await until(async()=>{const p=await proof();return p.ticks>=after+3;},'continued original liveLoop');
    const p=await proof();assert.equal(p.runs,1);assert.equal(p.prepared,1);assert(p.sameContext&&p.samePrepared&&p.sameClient);
    assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);assert.equal(await page.locator('#synthCodeError').textContent(),'');
    assert.equal((await page.evaluate(()=>__sidCodeAudit.graph())).contexts,1);return p;
  }
  async function fxStillActive(){
    let v;await until(async()=>{v=await page.evaluate(()=>__sidCodeAudit.fxOutput());return v.raw.rms>.001&&Math.abs(v.processed.rms/v.raw.rms-.5)<.08;},'retained half-volume FX processes new PCM');
    assert(v.muted&&v.processed.muted&&v.raw.finite&&v.processed.finite);return v;
  }
  try{
    await page.goto(origin+config.entry);await files(page);assert.equal((await page.evaluate(()=>__sidCodeAudit.graph())).contexts,0);
    const initial=await savedSound(page),pulse=structuredClone(initial),other=structuredClone(initial);
    for(const p of pulse.channels){p.name='Live pulse 6581';Object.assign(p.voice,{waveform:'pulse',pulseWidth:911,attack:0,decay:0,sustain:15,release:4});p.filter.enabled=false;}
    for(const p of other.channels){p.name='Live triangle 8580';p.model='8580';Object.assign(p.voice,{waveform:'triangle',attack:0,decay:0,sustain:15,release:4});p.filter.enabled=false;}
    const invalid=structuredClone(other);invalid.channels[0].voice.attack=99;
    await page.locator('#sidFilesInput').setInputFiles([
      {name:'pulse.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pulse))},
      {name:'triangle-8580.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(other))},
      {name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))}]);
    await until(()=>page.locator('#sidFilesStatus').textContent().then(value=>/Added 3/.test(value)),'sound documents imported');
    assert.equal((await page.evaluate(()=>__sidCodeAudit.graph())).contexts,0);
    await range(page,'masterVolume',1);
    step('one Run installs persistent context, preparation, named loop, SID client and a measurable software FX');
    await source(page,`const sid=await useSoundChip('sid');
context.runs=(context.runs??0)+1;
const prepared=await livePrepare('preset-proof',()=>{globalThis.__sidPreparedCount=(globalThis.__sidPreparedCount??0)+1;return {ticks:0};});
globalThis.__sidLivePreset={sid,context,prepared};
liveFx('retained-half',{process(input,output){for(let ch=0;ch<output.length;ch++)for(let i=0;i<output[ch].length;i++)output[ch][i]=(input[ch]?.[i]??0)*.5;}});
liveLoop('melody',async()=>{prepared.ticks++;await sid.noteOn(CH1,'A3');await sleep(.12);});`);
    await execute(page);await sounding(page);
    await page.evaluate(()=>{window.__originalSidContext=__sidLivePreset.context;window.__originalSidPrepared=__sidLivePreset.prepared;window.__originalSidClient=__sidLivePreset.sid;});
    const first=await continued(0),graph=await page.evaluate(()=>__sidCodeAudit.graph());assert.equal(graph.editorWorklets,1);assert.equal(graph.fxWorklets,1);
    measurements.before={proof:first,graph,fx:await fxStillActive()};await page.evaluate(()=>__sidCodeAudit.drain());

    step('Files sound selection changes the physical SID patch without Run/Stop, context, client or FX replacement');
    let count=(await proof()).ticks;await selectFile(page,'/pulse.json');
    let state=await stateIs(page,value=>(value.registers[4]&0xf0)===0x40&&(value.registers[2]|value.registers[3]<<8)===911,'Pulse reached the shared SID');
    await continued(count);assert.equal((await proof()).model,'6581');measurements.pulseFx=await fxStillActive();
    assert.deepEqual(await savedSound(page),pulse,'Save sound records the latest loaded authored sound');

    step('a preset model handoff preserves the same client, liveLoop phase, context and existing FX graph');
    count=(await proof()).ticks;await selectFile(page,'/triangle-8580.json');
    state=await stateIs(page,value=>value.model==='8580'&&(value.registers[4]&0xf0)===0x10,'8580 Triangle reached the shared graph');
    await continued(count);assert.equal((await proof()).model,'8580');measurements.triangleFx=await fxStillActive();
    count=(await proof()).ticks;await selectFile(page,'/pulse.json');await stateIs(page,value=>value.model==='6581'&&(value.registers[4]&0xf0)===0x40,'6581 returned');
    await continued(count);assert.equal((await proof()).model,'6581');await fxStillActive();
    const commands=await page.evaluate(()=>__sidCodeAudit.drain());
    assert(!commands.some(item=>['stop','beginCode'].includes(item.method)),'sound/model selection is never a new Code lease');
    const stableGraph=await page.evaluate(()=>__sidCodeAudit.graph());assert.equal(stableGraph.fxWorklets,graph.fxWorklets);assert.equal(stableGraph.editorWorklets,graph.editorWorklets);

    step('invalid sound selection retains the actual patch, counters, source and processed output');
    const authored=await savedSound(page);count=(await proof()).ticks;await selectFile(page,'/invalid.json');
    assert.match(await page.locator('#sidFilesStatus').textContent(),/JSON was not applied.*current sound kept/);
    await continued(count);assert.deepEqual(await savedSound(page),authored);await stateIs(page,value=>value.model==='6581'&&(value.registers[4]&0xf0)===0x40,'valid Pulse retained');await fxStillActive();

    step('explicit Stop retires the original client and restores the latest sound, while project replacement still stops Code');
    await stop(page);state=await snapshot(page);assert.equal(state.preset.name,'Live pulse 6581');assert([0,1,2].every(ch=>!gate(state,ch)));
    const frozen=await page.evaluate(()=>__sidLivePreset.prepared.ticks);await wait(180);assert.equal(await page.evaluate(()=>__sidLivePreset.prepared.ticks),frozen);
    assert(await page.evaluate(()=>{try{__originalSidClient.noteOn(0,'C4');return false;}catch(error){return error.name==='AbortError';}}));
    await selectFile(page,'/index.js');await execute(page);await sounding(page);const archive=await download(page,'#sidProjectExportButton');
    await page.locator('#sidProjectFileInput').setInputFiles({name:'live-preset.cassette.zip',mimeType:'application/zip',buffer:archive.bytes});
    await until(()=>page.locator('#sidFilesStatus').textContent().then(value=>/SID project imported/.test(value)),'project replacement');await stopped(page);
    assert.equal(await page.locator('#synthCodeError').textContent(),'');assert.deepEqual(errors,[]);
    await fs.mkdir(config.screenshots,{recursive:true});
    for(const width of [1240,390]){await page.setViewportSize({width,height:1050});await wait(70);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(config.screenshots,`${name}-sid-live-presets-${width}.png`),fullPage:true});}
    measurements.finalGraph=await page.evaluate(()=>__sidCodeAudit.graph());assert(measurements.finalGraph.muted);
    return {browser:name,passed:true,checks,measurements,errors};
  }catch(error){
    let diagnostic;try{diagnostic=await page.evaluate(async()=>({state:await __sidCodeAudit.read(),graph:__sidCodeAudit.graph(),output:__sidCodeAudit.output(),
      code:document.getElementById('synthCodeState').textContent,error:document.getElementById('synthCodeError').textContent,
      status:document.getElementById('sidFilesStatus').textContent,commands:__sidCodeAudit.drain().slice(-40)}));}catch{}
    error.receipt={browser:name,passed:false,stage,error:error.stack??String(error),checks,measurements,diagnostic,errors};throw error;
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
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,checkerSha256:hash(await fs.readFile(__filename)),
    results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');
  if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
