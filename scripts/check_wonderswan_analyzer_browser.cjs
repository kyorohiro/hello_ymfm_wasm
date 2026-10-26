// Actual Analyzer UI, WASM core, VGM player and output AudioWorklet.
// A test-only downstream AudioWorklet measures actual rendered PCM and emits
// zeros, so this check never sends the generated tone to the physical output.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const repository=path.resolve(__dirname,'..'),args=process.argv.slice(2);
if(args.includes('--help')){console.log('Usage: node scripts/check_wonderswan_analyzer_browser.cjs [--root=docs-or-flat-analyzer] [--chromium-only] [--out=REPORT.json]');process.exit(0);}
for(const argument of args)if(!argument.startsWith('--root=')&&!argument.startsWith('--out=')&&argument!=='--chromium-only')throw Error(`Unknown argument: ${argument}`);
const docs=path.resolve(repository,args.find(v=>v.startsWith('--root='))?.slice(7)??'docs');
const reportPath=args.find(v=>v.startsWith('--out='))?.slice(6);
let analyzerPath;
const servedSources=new Map(),sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const captureSource=`class WonderSwanAnalyzerCapture extends AudioWorkletProcessor {
  process(inputs,outputs) {
    for(const output of outputs)for(const side of output)side.fill(0);
    const pcm=inputs[0];if(!pcm?.length)return true;
    let count=0,sum=0,square=0,peak=0,bad=0;
    for(const side of pcm)for(const value of side){if(!Number.isFinite(value))bad++;else {count++;sum+=value;square+=value*value;peak=Math.max(peak,Math.abs(value));}}
    this.port.postMessage({count,sum,square,peak,bad});return true;
  }
}registerProcessor('wonderswan-analyzer-test-capture',WonderSwanAnalyzerCapture);`;
const hook=`
// Test-only observation: all actual parsing, rendering and UI handlers remain.
const __wsCapture=new WeakMap();let __wsFrames=0,__wsWorklets=0;
const __wsAttach=mixerUi.attach;mixerUi.attach=mixer=>{
  if(engine&&!engine.__wsTestObserved){engine.__wsTestObserved=true;const process=engine.processFrames.bind(engine);engine.processFrames=count=>{const pcm=process(count);__wsFrames+=count;return pcm;};}
  return __wsAttach(mixer);
};
const __wsRewire=rewireAudioGraph;rewireAudioGraph=()=>{
  __wsRewire();const node=effectSettings.enabled?effectsChain?.output:activeStream?.node;
  const capture=__wsCapture.get(audioContext);if(node&&capture){node.disconnect();node.connect(capture.node);}
};
const __wsStart=startWorkletStream;startWorkletStream=async(...args)=>{
  if(!__wsCapture.has(audioContext)){
    await audioContext.audioWorklet.addModule('/__wonderswan-capture-worklet.js');
    const capture={node:new AudioWorkletNode(audioContext,'wonderswan-analyzer-test-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]}),count:0,sum:0,square:0,peak:0,bad:0};
    capture.node.port.onmessage=({data})=>{capture.count+=data.count;capture.sum+=data.sum;capture.square+=data.square;capture.peak=Math.max(capture.peak,data.peak);capture.bad+=data.bad;};
    capture.node.connect(audioContext.destination);__wsCapture.set(audioContext,capture);
  }
  const result=await __wsStart(...args);if(result)__wsWorklets++;return result;
};
window.__wsAnalyzerTest={
  captureReset(){const c=__wsCapture.get(audioContext);if(!c)throw Error('No actual Worklet capture');Object.assign(c,{count:0,sum:0,square:0,peak:0,bad:0});},
  capture(){const c=__wsCapture.get(audioContext);return c?{count:c.count,peak:c.peak,bad:c.bad,mean:c.count?c.sum/c.count:0,acRms:c.count?Math.sqrt(Math.max(0,c.square/c.count-(c.sum/c.count)**2)):0}:null;},
  snapshot(){return {kind:currentChipKind,file:lastLoadedFileName,header:noteishHeader,stats:player?.stats(),frames:__wsFrames,worklets:__wsWorklets,
    mode:activeStream?.mode??null,context:audioContext?.state,registers:engine?.chip?Array.from({length:32},(_,i)=>engine.chip.readRegister(0x80+i)):null,
    memory:engine?.chip?Array.from({length:16},(_,i)=>engine.chip.readMemory(0x1200+i)):null,
    notes:noteishChannels().map(ch=>({channel:ch.channel,keyOn:ch.keyOn,midi:ch.toneMidi,kind:ch.apuType,reason:ch.reason})),
    mixer:engine?.playbackMixer?.get('wonderswan')??null};}
};
`;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm'};
const server=http.createServer(async(request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://local').pathname);
    if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    if(pathname==='/__wonderswan-capture-worklet.js'){response.setHeader('Content-Type','text/javascript');response.end(captureSource);return;}
    let file=path.resolve(docs,'.'+pathname);
    if(file!==docs&&!file.startsWith(docs+path.sep))throw Error('Outside test root');
    if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
    let body=await fs.readFile(file);
    servedSources.set(path.relative(docs,file).replaceAll(path.sep,'/'),{bytes:body.length,sha256:sha256(body)});
    if(file===path.join(docs,analyzerPath,'vgm_analyzer.js'))body=Buffer.concat([body,Buffer.from(hook)]);
    response.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');response.end(body);
  } catch(error){response.writeHead(404).end(error.message);}
});
const snapshot=page=>page.evaluate(()=>window.__wsAnalyzerTest.snapshot());
async function signal(page) {
  await page.evaluate(()=>window.__wsAnalyzerTest.captureReset());
  await page.waitForFunction(()=>window.__wsAnalyzerTest.capture()?.count>=12000);
  const result=await page.evaluate(()=>window.__wsAnalyzerTest.capture());
  assert.equal(result.bad,0,'Worklet output must contain only finite PCM');return result;
}
async function stop(page) {
  await page.locator('#inlineStopButton').evaluate(button=>{if(!button.disabled)button.click();});
  await page.waitForFunction(()=>window.__wsAnalyzerTest.snapshot().mode===null);
}
async function runBrowser(name,type,origin,createFixture) {
  const browser=await type.launch({headless:true,args:name==='chromium'?['--autoplay-policy=no-user-gesture-required']:[]});
  try {
    const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1440,height:1000}}),errors=[];
    page.setDefaultTimeout(35000);page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+analyzerPath+'/index.html');await page.waitForFunction(()=>window.__wsAnalyzerTest);
    const load=async(channel,mode='wave')=>{
      const filename=`original-wonderswan-${mode}-ch${channel+1}.vgm`;
      await page.locator('#fileInput').setInputFiles({name:filename,mimeType:'application/octet-stream',buffer:Buffer.from(createFixture({channel,mode}))});
      await page.waitForFunction(filename=>window.__wsAnalyzerTest.snapshot().file===filename&&document.getElementById('status').textContent.startsWith('Parsed '+filename+' ')&&!document.getElementById('inlinePlayButton').disabled,filename);
      const state=await snapshot(page);assert.equal(state.kind,'wonderswan');assert.equal(state.header.wonderswanClock,3072000);
      assert.match(await page.locator('#detectedChips').innerText(),/WonderSwan/i);
      assert.equal(await page.locator('#inlineMonitorToggles [data-monitor-toggle-kind="opm-channel"]').count(),4);
      assert.equal(await page.locator('#noteishTab').isDisabled(),false,'Wave base-pitch Note-ish must be available');
      for(const selector of ['#operatorInfoTab','#tfiInfoTab','#sampleExplorerTab'])assert.equal(await page.locator(selector).isDisabled(),true,selector+' should not promise unsupported instrument extraction');
      return state;
    };
    const play=async()=>{const before=await snapshot(page);await page.locator('#inlinePlayButton').click();await page.waitForFunction(before=>{const s=window.__wsAnalyzerTest.snapshot();return s.mode==='worklet'&&s.worklets>before.worklets&&s.frames>before.frames;},{worklets:before.worklets,frames:before.frames});};
    const scenes=[];
    for(let channel=0;channel<4;channel++) {
      await load(channel);await play();await page.waitForTimeout(200);
      const audible=await signal(page);assert(audible.acRms>.001,`CH${channel+1} real Worklet is silent: ${JSON.stringify(audible)}`);
      let state=await snapshot(page);assert.equal(state.registers[0x10]&15,1<<channel);assert.deepEqual(state.memory,[255,255,255,255,255,255,255,255,0,0,0,0,0,0,0,0],'C6 must reach nonzero physical wave RAM bank');
      assert.equal(state.mixer.gain,1,'Unmeasured WonderSwan default remains unity');
      assert.equal(state.notes.length,4);assert.equal(state.notes[channel].keyOn,true);assert.equal(state.notes[channel].kind,'Wave');
      assert(Number.isFinite(state.notes[channel].midi),'A waveform note must expose its base pitch');
      const button=page.locator(`#inlineMonitorToggles [data-monitor-toggle-kind="opm-channel"][data-channel-index="${channel}"]`);
      await button.click();assert.equal(await button.getAttribute('aria-pressed'),'false');await page.waitForTimeout(250);
      const muted=await signal(page);assert(muted.peak<1e-7,`CH${channel+1} channel mute leaked audio: ${JSON.stringify(muted)}`);
      await button.click();await page.waitForTimeout(200);const resumed=await signal(page);assert(resumed.acRms>.001,'Unmute must restore actual audio');
      scenes.push({channel:channel+1,audible,muted,resumed});await stop(page);
    }
    await load(0);await play();await page.waitForTimeout(150);
    await page.locator('#inlinePauseButton').click();await page.waitForFunction(()=>window.__wsAnalyzerTest.snapshot().stats.paused&&window.__wsAnalyzerTest.snapshot().context==='suspended');
    const paused=(await snapshot(page)).stats.processedWaitSamples;await page.waitForTimeout(120);assert.equal((await snapshot(page)).stats.processedWaitSamples,paused,'Pause must not advance VGM commands');
    await page.locator('#inlinePlayButton').click();await page.waitForFunction(()=>window.__wsAnalyzerTest.snapshot().stats.playing&&window.__wsAnalyzerTest.snapshot().context==='running');assert((await signal(page)).acRms>.001);
    const workletsBefore=(await snapshot(page)).worklets;
    await page.locator('#inlinePlaybackSeek').evaluate(input=>{input.value='88200';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.waitForFunction(before=>{const s=window.__wsAnalyzerTest.snapshot();return s.worklets>before&&s.stats.processedWaitSamples>=88200;},workletsBefore);
    const sought=await signal(page);assert(sought.acRms>.001,'Seek must reconstruct wave RAM and enable registers');await stop(page);
    assert.equal((await snapshot(page)).stats.playing,false);await play();assert((await signal(page)).acRms>.001,'Play after Stop must reproduce the instrument');await stop(page);
    const modeResults=[];
    for(const mode of ['noise','sweep','voice']){
      await load(0,mode);await play();await page.waitForTimeout(150);const pcm=await signal(page);assert(pcm.acRms>.001,`${mode} must produce finite changing audio`);
      const notes=(await snapshot(page)).notes,channel={voice:1,sweep:2,noise:3}[mode];
      assert.equal(notes[channel].keyOn,false,mode+' should not invent a pitched note');assert.equal(notes[channel].midi,null);
      assert.equal(notes[channel].reason,{voice:'Voice PCM',sweep:'Sweep',noise:'Noise'}[mode]);
      modeResults.push({mode,pcm,notes});await stop(page);
    }
    assert.deepEqual(errors,[],'Analyzer page errors');
    await page.screenshot({path:`/private/tmp/wonderswan-analyzer-${name}.png`,fullPage:true});
    return {browser:name,version:browser.version(),scenes,modes:modeResults,transport:{pause:true,resume:true,seekSamples:88200,stopReplay:true},pageErrors:errors};
  } finally {await browser.close();}
}
(async()=>{
  try{await fs.access(path.join(docs,'vgm_analyzer','vgm_analyzer.js'));analyzerPath='/vgm_analyzer';}catch{await fs.access(path.join(docs,'vgm_analyzer.js'));analyzerPath='';}
  const {createWonderSwanVgm}=await import(pathToFileURL(path.join(repository,'test/helpers/wonderswan_vgm_fixture.mjs')).href);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const results=[];
  const engines=[['chromium',chromium],...(args.includes('--chromium-only')?[]:[['webkit',webkit]])];
  try{for(const [name,type] of engines){results.push(await runBrowser(name,type,`http://127.0.0.1:${server.address().port}`,createWonderSwanVgm));console.log(`WonderSwan Analyzer ${name}: four channel mutes, wave/noise/sweep/Voice PCM, pause/seek/resume/Stop passed with actual silent-output AudioWorklet capture.`);}}
  finally{await new Promise(resolve=>server.close(resolve));}
  const sourceFiles=Object.fromEntries([...servedSources].sort(([a],[b])=>a.localeCompare(b)));
  const testSources=Object.fromEntries(await Promise.all(['scripts/check_wonderswan_analyzer_browser.cjs','test/helpers/wonderswan_vgm_fixture.mjs'].map(async file=>[file,sha256(await fs.readFile(path.join(repository,file)))])));
  const report={format:'tetorica-wonderswan-analyzer-browser-1',root:docs,physicalOutput:'zeroed by downstream measurement AudioWorklet',sourceFiles,testSources,results};
  if(reportPath)await fs.writeFile(path.resolve(reportPath),JSON.stringify(report,null,2)+'\n');
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
