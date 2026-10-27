// Actual Analyzer UI, POKEY WASM cores, VGM player and output AudioWorklet.
// A downstream test AudioWorklet measures real rendered PCM and emits zeros.
// Synthetic fixtures contain no game music and never reach the speakers.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const repository=path.resolve(__dirname,'..'),args=process.argv.slice(2);
if(args.includes('--help')){console.log('Usage: node scripts/check_pokey_analyzer_browser.cjs [--root=docs-or-flat-analyzer] [--docs-dir=docs-or-flat-analyzer] [--chromium-only] [--out=REPORT.json]');process.exit(0);}
for(const argument of args)if(!argument.startsWith('--root=')&&!argument.startsWith('--docs-dir=')&&!argument.startsWith('--out=')&&argument!=='--chromium-only')throw Error(`Unknown argument: ${argument}`);
const rootArgument=args.find(v=>v.startsWith('--root=')||v.startsWith('--docs-dir='));
const docs=path.resolve(repository,rootArgument?.slice(rootArgument.indexOf('=')+1)??'docs');
const reportPath=args.find(v=>v.startsWith('--out='))?.slice(6);
let analyzerPath;
const servedSources=new Map(),sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const captureSource=`class PokeyAnalyzerCapture extends AudioWorkletProcessor {
  process(inputs,outputs) {
    for(const output of outputs)for(const side of output)side.fill(0);
    const pcm=inputs[0];if(!pcm?.length)return true;
    const sides=pcm.map(side=>{let count=0,sum=0,square=0,peak=0,bad=0;
      for(const value of side){if(!Number.isFinite(value))bad++;else {count++;sum+=value;square+=value*value;peak=Math.max(peak,Math.abs(value));}}
      return {count,sum,square,peak,bad};});
    this.port.postMessage({sides});return true;
  }
}registerProcessor('pokey-analyzer-test-capture',PokeyAnalyzerCapture);`;
const hook=`
// Test-only observation: parsing, synthesis, timing and UI handlers remain.
const __pokeyCapture=new WeakMap(),__pokeyObserved=new WeakSet();
let __pokeyFrames=0,__pokeyWorklets=0,__pokeyConfiguration=null;
const __pokeyLoad=mixerUi.load;mixerUi.load=configuration=>{__pokeyConfiguration=configuration;return __pokeyLoad(configuration);};
const __pokeyAttach=mixerUi.attach;mixerUi.attach=mixer=>{
  if(engine&&!__pokeyObserved.has(engine)){__pokeyObserved.add(engine);const process=engine.processFrames.bind(engine);engine.processFrames=count=>{const pcm=process(count);__pokeyFrames+=count;return pcm;};}
  return __pokeyAttach(mixer);
};
const __pokeyRewire=rewireAudioGraph;rewireAudioGraph=()=>{
  __pokeyRewire();const node=effectSettings.enabled?effectsChain?.output:activeStream?.node;
  const capture=__pokeyCapture.get(audioContext);if(node&&capture){node.disconnect();node.connect(capture.node);}
};
const __pokeyStart=startWorkletStream;startWorkletStream=async(...args)=>{
  if(!__pokeyCapture.has(audioContext)){
    await audioContext.audioWorklet.addModule('/__pokey-capture-worklet.js');
    const capture={node:new AudioWorkletNode(audioContext,'pokey-analyzer-test-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]}),sides:[]};
    capture.node.port.onmessage=({data})=>{for(let i=0;i<data.sides.length;i++){const source=data.sides[i],side=capture.sides[i]??={count:0,sum:0,square:0,peak:0,bad:0};side.count+=source.count;side.sum+=source.sum;side.square+=source.square;side.peak=Math.max(side.peak,source.peak);side.bad+=source.bad;}};
    capture.node.connect(audioContext.destination);__pokeyCapture.set(audioContext,capture);
  }
  const result=await __pokeyStart(...args);if(result)__pokeyWorklets++;return result;
};
window.__pokeyAnalyzerTest={
  captureReset(){const c=__pokeyCapture.get(audioContext);if(!c)throw Error('No actual Worklet capture');c.sides=[];},
  capture(){const c=__pokeyCapture.get(audioContext);if(!c)return null;const summarize=side=>({...side,mean:side.count?side.sum/side.count:0,acRms:side.count?Math.sqrt(Math.max(0,side.square/side.count-(side.sum/side.count)**2)):0});
    const sides=c.sides.map(summarize);return {count:sides.reduce((n,s)=>n+s.count,0),peak:Math.max(0,...sides.map(s=>s.peak)),bad:sides.reduce((n,s)=>n+s.bad,0),sides,acRms:Math.sqrt(sides.reduce((n,s)=>n+s.acRms**2,0)/Math.max(1,sides.length))};},
  snapshot(){return {kind:currentChipKind,file:lastLoadedFileName,header:noteishHeader,stats:player?.stats(),frames:__pokeyFrames,worklets:__pokeyWorklets,configuration:__pokeyConfiguration,
    mode:activeStream?.mode??null,context:audioContext?.state,outputRate:audioContext?.sampleRate,
    stream:activeStream?{queuedFrames:activeStream.workletQueuedFrames,underruns:activeStream.underruns,renderMs:activeStream.renderMs,maxRenderMs:activeStream.maxRenderMs}:null,
    channels:pokeyMonitor?.describe()??[],registers:pokeyMonitor?.state?.chips?.map(chip=>Array.from(chip.registers))??[],
    mixer:engine?.playbackMixer?Object.fromEntries([...engine.playbackMixer.strips.keys()].map(id=>[id,engine.playbackMixer.get(id)])):null};}
};
`;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm'};
const server=http.createServer(async(request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://local').pathname);
    if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    if(pathname==='/__pokey-capture-worklet.js'){response.setHeader('Content-Type','text/javascript');response.end(captureSource);return;}
    let file=path.resolve(docs,'.'+pathname);
    if(file!==docs&&!file.startsWith(docs+path.sep))throw Error('Outside test root');
    if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
    let body=await fs.readFile(file);
    const name=path.relative(docs,file).replaceAll(path.sep,'/'),hash={bytes:body.length,sha256:sha256(body)};
    const before=servedSources.get(name);assert(!before||before.sha256===hash.sha256,'Served source changed during browser check: '+name);servedSources.set(name,hash);
    if(file===path.join(docs,analyzerPath,'vgm_analyzer.js'))body=Buffer.concat([body,Buffer.from(hook)]);
    response.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');response.end(body);
  } catch(error){response.writeHead(404).end(error.message);}
});
const snapshot=page=>page.evaluate(()=>window.__pokeyAnalyzerTest.snapshot());
async function signal(page) {
  await page.evaluate(()=>window.__pokeyAnalyzerTest.captureReset());
  await page.waitForFunction(()=>window.__pokeyAnalyzerTest.capture()?.count>=16000);
  const result=await page.evaluate(()=>window.__pokeyAnalyzerTest.capture());
  assert.equal(result.bad,0,'Worklet output must contain only finite PCM');return result;
}
async function stop(page) {
  await page.locator('#inlineStopButton').evaluate(button=>{if(!button.disabled)button.click();});
  await page.waitForFunction(()=>window.__pokeyAnalyzerTest.snapshot().mode===null);
}
async function chipRange(page,id,index,value) {
  await page.locator(`#mixerStrips [data-chip="${id}"] input[type=range]`).nth(index).evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);
}
async function runBrowser(name,type,origin,createFixture,createStreamFixture) {
  const browser=await type.launch({headless:true,args:name==='chromium'?['--autoplay-policy=no-user-gesture-required']:[]});
  try {
    const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1440,height:1000}}),errors=[];
    page.setDefaultTimeout(35000);page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+analyzerPath+'/index.html');await page.waitForFunction(()=>window.__pokeyAnalyzerTest);
    const load=async(options={})=>{
      const {dual=false,chip=0,channel=0,stream=false}=options,filename=`original-${dual?'dual-':''}pokey-${stream?'stream-':''}${chip+1}-ch${channel+1}.vgm`;
      await page.locator('#fileInput').setInputFiles({name:filename,mimeType:'application/octet-stream',buffer:Buffer.from((stream?createStreamFixture:createFixture)(options))});
      await page.waitForFunction(filename=>window.__pokeyAnalyzerTest.snapshot().file===filename&&document.getElementById('status').textContent.startsWith('Parsed '+filename+' ')&&!document.getElementById('inlinePlayButton').disabled,filename);
      const state=await snapshot(page);assert.equal(state.kind,'pokey');assert.equal(state.header.pokeyClock>>>0,(1789790|(dual?0x40000000:0))>>>0);
      assert.match(await page.locator('#detectedChips').innerText(),/POKEY/i);
      assert.equal(await page.locator('#inlineMonitorToggles [data-monitor-toggle-kind="opm-channel"]').count(),dual?8:4);
      assert.equal(state.channels.length,dual?8:4,'Every physical POKEY channel must have a live state');
      assert.deepEqual(Object.keys(state.configuration.chips.reduce((all,{id})=>(all[id]=true,all),{})),dual?['pokey','pokey:2']:['pokey']);
      assert.equal(await page.locator('#operatorInfoTab').isDisabled(),false,'POKEY register/channel monitor must be available');
      for(const selector of ['#noteishTab','#tfiInfoTab'])assert.equal(await page.locator(selector).isDisabled(),true,selector+' should not promise unsupported note/instrument extraction');
      await page.locator('#operatorInfoTab').click();assert.equal(await page.locator('#pokeyMonitor').isVisible(),true,'Operator Info must show the POKEY monitor');
      assert.equal(await page.locator('#pokeyMonitor > section').count(),dual?2:1,'One visible state section per physical chip');
      for(let index=0;index<(dual?2:1);index++)assert.equal(await page.locator('#pokeyMonitor > section').nth(index).locator('p').count(),5,'Shared control plus four physical channel rows');
      return state;
    };
    const play=async()=>{const before=await snapshot(page);await page.locator('#inlinePlayButton').click();await page.waitForFunction(before=>{const s=window.__pokeyAnalyzerTest.snapshot();return s.mode==='worklet'&&s.worklets>before.worklets&&s.frames>before.frames;},{worklets:before.worklets,frames:before.frames});};
    const scenes=[];
    for(const dual of [false,true])for(let chip=0;chip<(dual?2:1);chip++)for(let channel=0;channel<4;channel++) {
      await load({dual,chip,channel});await play();await page.waitForTimeout(180);
      const audible=await signal(page);assert(audible.acRms>.001,`POKEY${chip+1} CH${channel+1} real Worklet is silent: ${JSON.stringify(audible)}`);
      let state=await snapshot(page);assert.equal(state.mixer.pokey.gain,1,'Unmeasured POKEY default remains unity');
      if(dual)assert.equal(state.mixer['pokey:2'].gain,1);
      const active=chip*4+channel;assert.equal(state.channels[active].volume,12,'BB address chip bit must reach the matching register monitor');
      assert.equal(state.channels[active].chipIndex,chip);assert.equal(state.channels[active].channel,channel);
      for(let index=0;index<state.channels.length;index++)if(index!==active)assert.equal(state.channels[index].volume,0,`Inactive physical channel ${index} must remain off`);
      await page.waitForFunction(({chip,channel})=>document.querySelectorAll('#pokeyMonitor > section')[chip]?.querySelectorAll('p')[channel+1]?.textContent.includes('Volume 12/15'),{chip,channel});
      const button=page.locator(`#inlineMonitorToggles [data-monitor-toggle-kind="opm-channel"][data-channel-index="${active}"]`);
      await button.click();assert.equal(await button.getAttribute('aria-pressed'),'false');await page.waitForTimeout(250);
      const muted=await signal(page);assert(muted.peak<1e-7,`POKEY${chip+1} CH${channel+1} channel mute leaked audio: ${JSON.stringify(muted)}`);
      await button.click();await page.waitForTimeout(180);const resumed=await signal(page);assert(resumed.acRms>.001,'Unmute must restore actual audio');
      scenes.push({dual,chip:chip+1,channel:channel+1,audible,muted,resumed,outputRate:state.outputRate,stream:(await snapshot(page)).stream});await stop(page);
    }
    // Two distinct pitches keep independent chip routing visible in real PCM.
    await load({dual:true,seconds:20,voices:[{chip:0,channel:0,frequency:440},{chip:1,channel:0,frequency:660}]});await play();await page.waitForTimeout(180);
    const both=await signal(page);assert(both.acRms>.001);
    await page.locator('#dockMixerTab').click();
    const mute=id=>page.locator(`#mixerStrips [data-chip="${id}"] button.channel-toggle`);
    await mute('pokey').click();await page.waitForTimeout(250);const secondOnly=await signal(page);assert(secondOnly.acRms>.001);
    assert.equal((await snapshot(page)).mixer.pokey.muted,true);assert.equal((await snapshot(page)).mixer['pokey:2'].muted,false);
    await chipRange(page,'pokey:2',0,50);await page.waitForTimeout(250);const halfSecond=await signal(page);
    assert(Math.abs(halfSecond.acRms/secondOnly.acRms-.5)<.06,'POKEY2 volume must scale its actual source independently');
    await chipRange(page,'pokey:2',0,100);await mute('pokey:2').click();await page.waitForTimeout(250);const bothMuted=await signal(page);assert(bothMuted.peak<1e-7,'Both Mixer mutes must silence the rack');
    await mute('pokey').click();await page.waitForTimeout(250);const firstOnly=await signal(page);assert(firstOnly.acRms>.001,'POKEY1 must survive a POKEY2 mute');
    await chipRange(page,'pokey',1,-100);await page.waitForTimeout(250);const panLeft=await signal(page);assert(panLeft.sides[0].acRms>.001);assert(panLeft.sides[1].peak<1e-7,'POKEY1 full-left pan must silence only the right side');
    await chipRange(page,'pokey',1,0);await mute('pokey:2').click();await page.waitForTimeout(200);
    const restored=await signal(page);assert(restored.acRms>Math.max(firstOnly.acRms,secondOnly.acRms)*1.15,'Restoring both chips must restore their summed output');
    await page.locator('#inlinePauseButton').click();await page.waitForFunction(()=>window.__pokeyAnalyzerTest.snapshot().stats.paused&&window.__pokeyAnalyzerTest.snapshot().context==='suspended');
    const paused=(await snapshot(page)).stats.processedWaitSamples;await page.waitForTimeout(120);assert.equal((await snapshot(page)).stats.processedWaitSamples,paused,'Pause must not advance VGM commands');
    await page.locator('#inlinePlayButton').click();await page.waitForFunction(()=>window.__pokeyAnalyzerTest.snapshot().stats.playing&&window.__pokeyAnalyzerTest.snapshot().context==='running');assert((await signal(page)).acRms>.001);
    const workletsBefore=(await snapshot(page)).worklets;
    await page.locator('#inlinePlaybackSeek').evaluate(input=>{input.value='88200';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.waitForFunction(before=>{const s=window.__pokeyAnalyzerTest.snapshot();return s.worklets>before&&s.stats.processedWaitSamples>=88200;},workletsBefore);
    const sought=await signal(page);assert(sought.acRms>.001,'Seek must reconstruct both chips');
    let state=await snapshot(page);assert.equal(state.channels[0].volume,12);assert.equal(state.channels[4].volume,12,'Seek must retain both independent channel monitors');
    await stop(page);assert.equal((await snapshot(page)).stats.playing,false);await play();const replay=await signal(page);assert(replay.acRms>.001,'Play after Stop must reconstruct both instruments');await stop(page);
    await load({dual:true,chip:1,channel:2,stream:true});await play();await page.waitForTimeout(180);
    const streamAudible=await signal(page);assert(streamAudible.acRms>.001,'Generic DAC stream 0x9e must reach POKEY2 AUDC3');
    state=await snapshot(page);assert.equal(state.channels[6].type,'Volume-only DAC');assert.equal(state.channels[6].midi,null,'Timed DAC values must not invent a note');
    const streamMute=page.locator('#inlineMonitorToggles [data-monitor-toggle-kind="opm-channel"][data-channel-index="6"]');
    await streamMute.click();await page.waitForTimeout(250);const streamMuted=await signal(page);assert(streamMuted.peak<1e-7,'Timed DAC stream channel mute must silence its output');
    await streamMute.click();await page.waitForTimeout(180);assert((await signal(page)).acRms>.001,'Timed DAC stream must survive mute/unmute');
    const streamWorklets=(await snapshot(page)).worklets;
    await page.locator('#inlinePlaybackSeek').evaluate(input=>{input.value='88200';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.waitForFunction(before=>{const s=window.__pokeyAnalyzerTest.snapshot();return s.worklets>before&&s.stats.processedWaitSamples>=88200;},streamWorklets);
    const streamSought=await signal(page);assert(streamSought.acRms>.001,'Seek must reconstruct timed DAC stream setup and phase');
    await stop(page);await play();const streamReplay=await signal(page);assert(streamReplay.acRms>.001,'Stop/replay must restart timed DAC stream');await stop(page);
    assert.deepEqual(errors,[],'Analyzer page errors');
    await page.screenshot({path:`/private/tmp/pokey-analyzer-${name}.png`,fullPage:true});
    return {browser:name,version:browser.version(),scenes,mixer:{both,secondOnly,halfSecond,bothMuted,firstOnly,panLeft,restored},transport:{pause:true,resume:true,seekSamples:88200,sought,stopReplay:replay},dacStream:{target:1,channel:2,rate:11025,audible:streamAudible,muted:streamMuted,sought:streamSought,replay:streamReplay},pageErrors:errors};
  } finally {await browser.close();}
}
(async()=>{
  try{await fs.access(path.join(docs,'vgm_analyzer','vgm_analyzer.js'));analyzerPath='/vgm_analyzer';}catch{await fs.access(path.join(docs,'vgm_analyzer.js'));analyzerPath='';}
  const {createPokeyVgm,createPokeyStreamVgm}=await import(pathToFileURL(path.join(repository,'test/helpers/pokey_vgm_fixture.mjs')).href);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const results=[];
  const engines=[['chromium',chromium],...(args.includes('--chromium-only')?[]:[['webkit',webkit]])];
  try{for(const [name,type] of engines){results.push(await runBrowser(name,type,`http://127.0.0.1:${server.address().port}`,createPokeyVgm,createPokeyStreamVgm));console.log(`POKEY Analyzer ${name}: single/dual four/eight channels, independent Mixer, generic DAC stream, pause/seek/resume/Stop passed with actual silent-output AudioWorklet capture.`);}}
  finally{await new Promise(resolve=>server.close(resolve));}
  const sourceFiles=Object.fromEntries([...servedSources].sort(([a],[b])=>a.localeCompare(b)));
  const testSources=Object.fromEntries(await Promise.all(['scripts/check_pokey_analyzer_browser.cjs','test/helpers/pokey_vgm_fixture.mjs'].map(async file=>[file,sha256(await fs.readFile(path.join(repository,file)))])));
  const report={format:'tetorica-pokey-analyzer-browser-1',root:docs,physicalOutput:'zeroed by downstream measurement AudioWorklet',sourceFiles,testSources,results};
  if(reportPath)await fs.writeFile(path.resolve(reportPath),JSON.stringify(report,null,2)+'\n');
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
