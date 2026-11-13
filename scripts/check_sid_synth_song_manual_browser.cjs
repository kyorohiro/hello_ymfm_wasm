// SPDX-License-Identifier: BSD-3-Clause
// Real SID song + manual interaction. Physical destination connections pass
// through gain zero before application code runs; Chromium is also muted.
// node scripts/check_sid_synth_song_manual_browser.cjs --root=docs --entry=/synth-sid/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-sid/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'sid-synth-song-manual-browser.json'),screenshots:path.join(tmpdir(),'sid-synth-song-manual-browser')};
for(const arg of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(value=>['chromium','webkit'].includes(value)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=value=>createHash('sha256').update(value).digest('hex');
const served=new Map(),missing=[],external=[],blockedMonaco=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json',
  '.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
async function until(predicate,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await wait(25);}throw Error('Timeout: '+label);}

function installSilentAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,
    connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  const contexts=[],nodes=[],ports=new WeakMap(),sinks=[],commands=[],replies=[];let sequence=0;
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){
    super(context,name,...args);const item={node:this,name,index:nodes.length,pending:new Map()};nodes.push(item);ports.set(this.port,item);
    this.port.addEventListener('message',({data})=>{
      const request=item.pending.get(data?.id);if(!request)return;item.pending.delete(data.id);
      if(request.method.startsWith('manual'))replies.push({...request,state:data.value,error:data.error??null});
    });this.port.start();
  }};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);sinks.push({source:this,analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...args){
    const item=ports.get(this);if(item&&data?.method){
      const request={kind:item.name,index:item.index,id:data.id,method:data.method,args:data.args??[]};commands.push(request);
      if(data.id!==undefined)item.pending.set(data.id,request);
    }
    return post.call(this,data,...args);
  };
  const active=kind=>nodes.filter(item=>item.name===kind&&item.node.context.state!=='closed');
  async function command(kind,method='read',args=[]){
    const item=active(kind).at(-1);if(!item)throw Error('No active '+kind+' Worklet');const id=--sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{item.node.port.removeEventListener('message',receive);reject(Error('SID audit command timed out: '+method));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);item.node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      item.node.port.addEventListener('message',receive);item.node.port.postMessage({id,method,args});
    });
  }
  const graph=()=>({contexts:contexts.length,editorWorklets:active('tetorica-sid-synth').length,playerWorklets:active('tetorica-sid-player').length,
    playerIndex:active('tetorica-sid-player').at(-1)?.index??null,destinationConnections:sinks.length,muted:sinks.every(item=>item.mute.gain.value===0)});
  window.__sidSongManualAudit={command,graph,commands:()=>commands.slice(),replies:()=>replies.slice(),
    drain(){const value={commands:commands.splice(0),replies:replies.splice(0)};return value;},
    output(){let rms=0,peak=0,finite=true;for(const sink of sinks.filter(item=>item.source.context.state==='running')){
      const pcm=new Float32Array(sink.analyser.fftSize);sink.analyser.getFloatTimeDomainData(pcm);let square=0;
      for(const value of pcm){finite&&=Number.isFinite(value);square+=value*value;peak=Math.max(peak,Math.abs(value));}rms=Math.max(rms,Math.sqrt(square/pcm.length));
    }return {rms,peak,finite,muted:graph().muted};}};
}
const player=page=>page.evaluate(()=>__sidSongManualAudit.command('tetorica-sid-player'));
const editor=page=>page.evaluate(()=>__sidSongManualAudit.command('tetorica-sid-synth'));
const graph=page=>page.evaluate(()=>__sidSongManualAudit.graph());
const gate=(state,ch)=>Boolean(state.registers[ch*7+4]&1),freq=(state,ch)=>state.registers[ch*7]|state.registers[ch*7+1]<<8;
async function parameter(page,id,value){await page.locator('#'+id).evaluate((node,next)=>{node.value=String(next);node.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function stepper(page,id,delta=1){await page.locator(`[data-stepper-for="${id}"][data-stepper-delta="${delta}"]`).click();}
async function selectChannel(page,channel){await page.locator(`[data-sid-live-voice="${channel}"]`).click();}
async function stateIs(page,predicate,label){let state;await until(async()=>{state=await player(page);return predicate(state);},label);return state;}
async function continued(page,before){return stateIs(page,state=>state.playing&&state.positionFrames>before,'song position advances');}
async function key(page,down=true){const value=await page.locator('#keyboard .key:not([disabled])').first().getAttribute('data-key');assert(value);await page.keyboard[down?'down':'up'](value);return value;}
async function savedSetup(page){
  await page.locator('#presetTools').evaluate(node=>{node.open=true;});const task=page.waitForEvent('download');await page.locator('#saveChannelSettings').click();
  const item=await task,chunks=[];for await(const chunk of await item.createReadStream())chunks.push(chunk);return JSON.parse(Buffer.concat(chunks));
}
async function openFiles(page){if(await page.locator('#sidFilesPanel').isHidden())await page.locator('#sidFilesToggle').click();await until(()=>page.locator('#sidFileImportButton').isEnabled(),'Files ready');}
async function selectFile(page,name){await openFiles(page);for(let i=0;i<10;i++){const closed=page.locator('#sidFilesTree details:not([open])>summary');if(!await closed.count())break;await closed.first().click();}
  await page.locator(`#sidFilesTree button.file-entry[data-file-path="${name}"]`).click();await until(()=>page.locator('#sidFilesSelected').textContent().then(value=>value===name),'selected '+name);}
async function source(page,text){await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(text);}

async function check(browser,name,origin,fixtures){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'}),checks=[],models=[],errors=[];let stage='startup';page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(error.stack??error.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installSilentAudit);
  const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  async function load(profile,model){
    await page.evaluate(()=>__sidSongManualAudit.drain());
    await page.locator('#sidImportTools').evaluate(node=>{node.open=true;});
    await page.locator('[data-sid-import-model="auto"]').click();
    await until(()=>page.locator('[data-sid-import-model="auto"]').getAttribute('aria-pressed').then(value=>value==='true'),'automatic model choice');
    const bytes=Buffer.from(fixtures[profile]);bytes.writeUInt16BE(model==='8580'?0x24:0x14,0x76);
    await page.locator('#sidSoundFileInput').setInputFiles({name:profile+'.sid',mimeType:'application/octet-stream',buffer:bytes});
    await until(()=>page.locator('#sidImportPlay').isEnabled(),'SID imported');
    if(model){await page.locator(`[data-sid-import-model="${model}"]`).click();await until(()=>page.locator('#sidImportInfo').textContent().then(value=>value.includes('PAL / '+model)),'model selected');}
    await page.locator('#sidImportPlay').click();await until(async()=>{if((await graph(page)).playerWorklets!==1)return false;return(await player(page)).positionFrames>0;},'song playing');
    if(!await page.locator('#sidLiveEnabled').isChecked())await page.locator('#sidLiveEnabled').check();
    await selectChannel(page,0);await until(()=>page.locator('#voiceEditor').getAttribute('data-observing').then(value=>value==='true'),'song observed');
    await until(()=>page.locator('#voiceEditor').getAttribute('data-live-editable').then(value=>value==='true'),'song controls editable');
  }
  async function manualReply(method,after=0){let reply;await until(async()=>{const values=await page.evaluate(()=>__sidSongManualAudit.replies());reply=values.slice(after).findLast(item=>item.method===method);return Boolean(reply);},method+' ACK');assert.equal(reply.error,null);return reply;}
  try{
    await page.goto(origin+config.entry);await openFiles(page);assert.equal((await graph(page)).contexts,0);const baseline=await savedSetup(page);
    for(const model of ['6581','8580']){
      step(model+': song keys use the same player CH without opening an author SID');
      await load('tone',model);const originalGraph=await graph(page);assert.equal(originalGraph.editorWorklets,0);
      await selectChannel(page,1);await page.locator('#voiceCard').evaluate(node=>{node.open=true;});
      await page.locator('[data-choice-for="waveform"][data-value="pulse"]').click();
      const wave=await manualReply('manualEdit');assert.equal(wave.args[0],1);assert.equal(wave.state.registers[11]&0xf0,0x40);
      const before=await player(page),held=await key(page);const note=await manualReply('manualNoteOn');
      assert.equal(note.args[1],1);assert(gate(note.state,1));assert.equal(note.state.manualVoices.at(-1).channel,1);assert.equal((await graph(page)).editorWorklets,0);
      const running=await continued(page,before.positionFrames);assert.equal((await graph(page)).playerIndex,originalGraph.playerIndex);
      let pcm;await until(async()=>{pcm=await page.evaluate(()=>__sidSongManualAudit.output());return pcm.finite&&pcm.muted&&pcm.rms>.00001;},'finite nonzero real song PCM behind gain zero');
      await page.keyboard.up(held);await manualReply('manualNoteOff');assert.equal(gate(await player(page),1),false);

      step(model+': sparse voice, shared filter and waveform edits preserve unrelated hardware fields');
      await page.locator('#sidLiveEnabled').uncheck();const sampled=await player(page),attack=sampled.registers[12]>>4,decay=sampled.registers[12]&15;
      const count=(await page.evaluate(()=>__sidSongManualAudit.replies())).length;await stepper(page,'attack');
      const adsr=await manualReply('manualEdit',count);assert.equal(adsr.state.registers[12]>>4,attack+1);assert.equal(adsr.state.registers[12]&15,decay);
      assert.deepEqual(adsr.state.registers.slice(14,21),sampled.registers.slice(14,21));assert.equal(adsr.state.registers[11],sampled.registers[11]);
      const routes=adsr.state.registers[23]&7;await page.locator('#filterEnabled').check();
      const routed=await manualReply('manualEdit',count+1);assert.equal(routed.state.registers[23]&7,routes|2);
      const resonance=routed.state.registers[23]>>4;await parameter(page,'filterCutoffRange',777);
      const cutoff=await manualReply('manualEdit',count+2);assert.equal(cutoff.state.registers[22]<<3|cutoff.state.registers[21]&7,777);assert.equal(cutoff.state.registers[23]>>4,resonance);assert.equal(cutoff.state.registers[23]&7,routes|2);
      // A controlled physical mutation after the frozen display simulates a
      // later writer. UI toggles must update changed subbits, not stale masks.
      await page.evaluate(()=>__sidSongManualAudit.command('tetorica-sid-player','manualEdit',[1,{voice:{waveform:'saw+pulse'}}]));
      const maskCount=(await page.evaluate(()=>__sidSongManualAudit.replies())).length;await page.locator('[data-choice-for="waveform"][data-value="triangle"]').click();
      const combined=await manualReply('manualEdit',maskCount);assert.equal(combined.state.registers[11]&0xf0,0x70,'the physical Saw bit survives the stale displayed toggle');
      assert.equal(combined.args[2].waveformBits,1);assert((await player(page)).playing);assert.equal((await graph(page)).editorWorklets,0);
      await page.evaluate(()=>__sidSongManualAudit.command('tetorica-sid-player','manualEdit',[1,{filter:{mode:'notch'}}]));
      const filterMaskCount=(await page.evaluate(()=>__sidSongManualAudit.replies())).length;await page.locator('#filterBandpass').click();
      const filtered=await manualReply('manualEdit',filterMaskCount);assert.equal(filtered.state.registers[24]>>4&7,7,'physical HP survives the stale displayed BP toggle');assert.equal(filtered.args[2].filterModeBits,2);

      step(model+': later CPU Gate/frequency writes win and stale key-up does not silence the source');
      await selectChannel(page,0);const sourceCount=(await page.evaluate(()=>__sidSongManualAudit.replies())).length,sourceKey=await key(page),sourceNote=await manualReply('manualNoteOn',sourceCount);
      const source=await stateIs(page,value=>!value.manualVoices.some(voice=>voice.id===sourceNote.args[0]&&voice.gateOwned),'later CPU Gate write retires manual ownership');
      assert.equal(gate(source,0),true);const sourceFrequency=freq(source,0);await page.keyboard.up(sourceKey);await wait(80);
      const afterRelease=await player(page);assert.equal(gate(afterRelease,0),true);assert.equal(freq(afterRelease,0),sourceFrequency);assert.equal((await graph(page)).editorWorklets,0);
      models.push({model,playerIndex:originalGraph.playerIndex,positionBefore:before.positionFrames,positionAfter:running.positionFrames,samePlayerManual:true,sourceWritesWin:true,pcm});
      await page.locator('#sidImportStop').click();await until(async()=>(await graph(page)).playerWorklets===0,'player closed');
    }

    step('Pause keys audition selected settings separately while keeping the exact song position for Resume');
    await load('tone','6581');await page.locator('#sidImportPause').click();await until(()=>page.locator('#sidImportPause').textContent().then(value=>/Resume/.test(value)),'paused');
    const paused=await player(page),pausedIndex=(await graph(page)).playerIndex;const pausedKey=await key(page);
    await until(async()=>(await graph(page)).editorWorklets===1,'paused author audition prepared');await until(async()=>(await editor(page)).voices.length===1,'paused key sounding');
    assert.equal((await player(page)).positionFrames,paused.positionFrames);assert((await player(page)).paused);await page.keyboard.up(pausedKey);
    await page.locator('#sidImportPause').click();const resumed=await continued(page,paused.positionFrames);assert.equal((await graph(page)).playerIndex,pausedIndex);
    assert.equal((await editor(page)).voices.length,0,'Resume retires temporary paused notes');

    step('Round robin and Files preset selection keep the accepted song and its source RAM independent');
    await selectChannel(page,'round-robin');const beforeRound=await player(page),roundKey=await key(page);await until(async()=>(await editor(page)).voices.length>0,'author Round robin note');
    await continued(page,beforeRound.positionFrames);assert.equal((await graph(page)).playerIndex,pausedIndex);await page.keyboard.up(roundKey);
    const preset=structuredClone(baseline);for(const p of preset.channels){p.name='Manual browser sound';Object.assign(p.voice,{waveform:'pulse',pulseWidth:789,attack:0,decay:0,sustain:15,release:4});}
    await openFiles(page);await page.locator('#sidFilesInput').setInputFiles({name:'song-manual.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(preset))});
    await until(()=>page.locator('#sidFilesStatus').textContent().then(value=>/Added 1/.test(value)),'sound added');await selectFile(page,'/song-manual.json');
    await until(async()=>(await editor(page)).preset.name==='Manual browser sound','author sound loaded');await continued(page,resumed.positionFrames);assert.equal((await graph(page)).playerIndex,pausedIndex);

    step('Code view alone keeps the song; Run owns the editor and stops song playback; Keyboard view keeps Code');
    await source(page,`const sid=await useSoundChip('sid');await sid.noteOn(CH1,'A3');globalThis.__sidSongManualCode=sid;`);
    const viewFrame=(await player(page)).positionFrames;await continued(page,viewFrame);await page.locator('#synthCodeRunButton').click();
    await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Running|Playing/.test(value)),'Code running');
    await until(async()=>(await graph(page)).playerWorklets===0,'Code closed song');assert.equal(await page.locator('#synthCodeError').textContent(),'');
    await page.locator('#synthInputKeyboardTab').click();assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);
    await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'Code stopped');
    await page.locator('#synthInputKeyboardTab').click();

    step('melody/filter source observations remain live and Capture explicitly imports a fixed sound');
    await load('melody-filter','6581');const start=await player(page);await wait(180);const moving=await continued(page,start.positionFrames);assert(moving.positionFrames>start.positionFrames);
    await page.locator('#sidImportCapture').click();await until(()=>page.locator('[data-sid-import-voice="0"]').isEnabled(),'capture ready');
    await page.locator('[data-sid-import-voice="0"]').click();await until(async()=>(await graph(page)).playerWorklets===0,'capture selection closes song');
    await until(()=>page.locator('#sidImportStatus').textContent().then(value=>/loaded|keyboard/i.test(value)),'captured voice applied after player close');
    await fs.mkdir(config.screenshots,{recursive:true});for(const width of [1240,390]){await page.setViewportSize({width,height:1050});await wait(50);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(config.screenshots,`${name}-sid-song-manual-${width}.png`),fullPage:true});}
    const finalGraph=await graph(page),pcm=await page.evaluate(()=>__sidSongManualAudit.output());assert(finalGraph.muted&&pcm.muted&&pcm.finite);assert.deepEqual(errors,[]);
    return {browser:name,passed:true,checks,models,finalGraph,pcm,errors};
  }catch(error){let diagnostic;try{diagnostic=await page.evaluate(async()=>({graph:__sidSongManualAudit.graph(),commands:__sidSongManualAudit.commands().slice(-50),replies:__sidSongManualAudit.replies().slice(-10),status:document.getElementById('audioStatus').textContent,importStatus:document.getElementById('sidImportStatus').textContent,code:document.getElementById('synthCodeState').textContent}));}catch{}
    error.receipt={browser:name,passed:false,stage,error:error.stack??String(error),checks,models,diagnostic,errors};throw error;
  }finally{await page.close();}
}

const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),meta={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),meta,'Asset changed during browser check');served.set(key,meta);res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  const {createSidReferenceFixture}=await import(pathToFileURL(path.join(repo,'test/fixtures/sid-reference/fixture.mjs')).href),fixtures=Object.fromEntries(['tone','melody-filter'].map(name=>[name,createSidReferenceFixture(name).bytes]));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;let failure=null;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
    try{results.push(await check(browser,name,origin,fixtures));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,fixture:'Newly authored BSD-3-Clause tone/melody-filter PSIDs only; no game music or ROM',checkerSha256:hash(await fs.readFile(__filename)),
    results,missing,external,expectedBlockedMonaco:blockedMonaco,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
