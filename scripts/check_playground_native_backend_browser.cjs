// Real shared Playground/settings, real Web Audio regression, mocked native IPC.
// No native audio device is opened. Native PCM is covered by Rust/C++ offline tests.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {chromium, webkit} = require('playwright');
const rootOption = process.argv.find(value => value.startsWith('--root='));
const docs = rootOption ? path.resolve(rootOption.slice(7)) : path.resolve(__dirname, '../docs');
const entryPath = rootOption ? '/index.html' : '/playground/index.html';
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};
const accessor = '\nwindow.__nativeBackendTest={runtime,selectedMode,get editor(){return editorAdapter}};';
const source = `// Native/Web Audio project handoff regression.
setBpm(120);
fm.setPreset(CH1, FM_PRESETS['one-op-basic']);
liveLoop('shared-phrase', async () => {
  for (const note of ['E3','G3','A3','B3','D4']) {
    await play(note, {channel:CH1, duration:0.8});
    await beat(cycle([0.04,0.04,0.08]));
  }
});`;
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = path.resolve(docs, '.' + pathname);
    if (!file.startsWith(docs + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    let body = await fs.readFile(file);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString() + accessor);
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(body);
  } catch (error) {response.writeHead(404).end(String(error));}
});

class FakeNative {
  constructor() {
    this.calls = []; this.sessions = 0; this.current = null; this.failStart = false;
    this.monitor = {pending:0,maxPending:0,reads:[],gate:null};
  }
  holdNextMonitor(mode) {
    let release,arrive;
    const gate={mode,promise:new Promise(done=>{release=done;}),arrived:new Promise(done=>{arrive=done;}),release:()=>release(),arrive};
    gate.arrive=value=>{gate.request=value;arrive(value);};
    this.monitor.gate=gate;return gate;
  }
  monitorSnapshot(args) {
    const amplitude=args.channel===1?.1:.4;
    const result={session:args.session,frame:this.status().frame,sampleRate:48000,frames:4096,rms:amplitude/Math.SQRT2,peak:amplitude};
    const bin=args.channel===1?96:32;
    if(args.mode==='waveform')result.samples=Array.from({length:4096},(_,i)=>amplitude*Math.sin(2*Math.PI*bin*i/4096));
    if(args.mode==='spectrum'){result.bins=Array(2048).fill(-100);result.bins[bin]=args.channel===1?-30:-12;}
    return result;
  }
  status() {
    if (!this.current) throw Error('No native session');
    return {session:this.current.session,sampleRate:48000,frame:Math.floor((performance.now() - this.current.began) * 48),
      ymClock:7670454,psgClock:3579545,running:true,queued:0,lateCommands:0,queueOverflows:0,error:null};
  }
  async invoke(command, args = {}) {
    this.calls.push({command,args});
    if (command === 'native_genesis_start') {
      if (this.failStart) {this.failStart = false; throw Error('Simulated native device unavailable');}
      this.current = {session:++this.sessions,began:performance.now()};
      return this.status();
    }
    if (!command.startsWith('native_genesis_')) return null;
    if (command === 'native_genesis_shutdown') {
      if (this.current?.session === args.session) this.current = null;
      return null;
    }
    if (!this.current || this.current.session !== args.session) throw Error('Stale native audio session');
    if(command==='native_genesis_monitor') {
      assert(['off','envelope','waveform','spectrum'].includes(args.mode));assert([0,1].includes(args.channel));
      if(args.mode==='off')return null;
      const observation={...args,time:performance.now()};this.monitor.reads.push(observation);
      this.monitor.pending++;this.monitor.maxPending=Math.max(this.monitor.maxPending,this.monitor.pending);
      const result=this.monitorSnapshot(args),gate=this.monitor.gate;
      try {
        if(gate&&gate.mode===args.mode){this.monitor.gate=null;gate.arrive(observation);await gate.promise;}
        return result;
      } finally {this.monitor.pending--;}
    }
    if (command === 'native_genesis_status' || command === 'native_genesis_stop') return this.status();
    if (command === 'native_genesis_commands') {
      assert(Array.isArray(args.commands) && args.commands.length > 0 && args.commands.length <= 4096);
      assert(args.commands.every(entry => Number.isSafeInteger(entry.frame) && entry.frame >= 0));
      return this.status();
    }
    if (['native_genesis_performance','native_genesis_fx','native_genesis_media_load','native_genesis_media_remove','native_genesis_record_start'].includes(command)) return this.status();
    if (command === 'native_genesis_record_stop') return {sampleRate:48000,firstFrame:0,frames:16,complete:false,channels:[Array(16).fill(.1),Array(16).fill(-.1)]};
    throw Error('Unexpected native command: ' + command);
  }
  count(command) {return this.calls.filter(call => call.command === command).length;}
}

function observeAudioCreation() {
  window.__audioConstructions = {contexts:0,offline:0,worklets:[]};
  for (const key of ['AudioContext','OfflineAudioContext','webkitOfflineAudioContext','AudioWorkletNode']) {
    const Type = window[key];
    if (!Type) continue;
    window[key] = new Proxy(Type, {construct(Type, args, Target) {
      if (key === 'AudioContext') window.__audioConstructions.contexts++;
      else if (key.endsWith('OfflineAudioContext')) window.__audioConstructions.offline++;
      else window.__audioConstructions.worklets.push(args[1]);
      return Reflect.construct(Type,args,Target);
    }});
  }
}
function observeMonitorDrawing() {
  window.__monitorDrawings={};
  const Type=window.CanvasRenderingContext2D;if(!Type)return;
  const paths=new WeakMap(),proto=Type.prototype;
  const observed=context=>context.canvas?.id?.startsWith('audioMonitor');
  const begin=proto.beginPath;proto.beginPath=function(...args){if(observed(this))paths.set(this,[]);return begin.apply(this,args);};
  for(const key of ['moveTo','lineTo']) {
    const original=proto[key];proto[key]=function(x,y,...args){
      if(observed(this)){const points=paths.get(this);if(points&&points.length<8192)points.push([x,y]);}
      return original.call(this,x,y,...args);
    };
  }
  const stroke=proto.stroke;proto.stroke=function(...args){
    if(observed(this)&&['#69cfff','#ffba69'].includes(this.strokeStyle)) {
      const drawing=window.__monitorDrawings[this.canvas.id]??={revision:0,traces:{}};
      drawing.traces[this.strokeStyle]={revision:++drawing.revision,points:(paths.get(this)??[]).map(point=>point.slice())};
    }
    return stroke.apply(this,args);
  };
}
async function assertNoLiveAudio(page) {
  assert.deepEqual(await page.evaluate(() => ({contexts:window.__audioConstructions.contexts,worklets:window.__audioConstructions.worklets})),{contexts:0,worklets:[]});
}
async function ready(page) {
  await page.waitForFunction(() => Boolean(window.__nativeBackendTest));
  await page.locator('#startupNotice').waitFor({state:'hidden'});
}
async function openSettings(page) {
  await page.locator('#mainMenu > summary').click();
  await page.click('#audioEngineButton');
  await page.locator('#audioEngineDialog').waitFor({state:'visible'});
}
async function selectEngine(page, value) {
  await openSettings(page);
  await page.selectOption('#audioEngineSelect', value);
  await Promise.all([page.waitForURL(url => url.searchParams.get('audioEngine') === (value === 'native' ? 'native' : null)), page.click('#audioEngineApply')]);
  await ready(page);
  assert.equal(await page.evaluate(() => window.__nativeBackendTest.editor.getValue()), source);
}
async function run(page) {
  await page.click('#runButton');
  await page.waitForFunction(() => window.__nativeBackendTest.runtime.getState().playback === 'running');
}
async function until(check) {
  const end = Date.now() + 10000;
  while (!check()) {if (Date.now() > end) throw Error('Native IPC expectation timed out'); await new Promise(resolve => setTimeout(resolve, 10));}
}
async function nativeRun(page, native) {
  const before = native.count('native_genesis_commands');
  await run(page);
  await until(() => native.count('native_genesis_commands') > before && native.calls.some(call => call.command === 'native_genesis_commands' && call.args.commands.some(entry => entry.type === 'write' && entry.register === 0x28 && entry.value & 0xf0)));
  assert.equal(await page.evaluate(() => window.__nativeBackendTest.runtime.megaDrive.backend), 'native-genesis');
  await assertNoLiveAudio(page);
  assert.equal(await page.evaluate(() => window.__nativeBackendTest.runtime.capabilities.worker), true);
}
async function workerMediaRun(page,native) {
  await page.evaluate(() => window.__nativeBackendTest.runtime.stopWithFade());
  const first=native.calls.length;
  await page.evaluate(async () => {
    await window.__nativeBackendTest.runtime.playSource(`
      setBpm(120);
      fm.setPreset(CH1,FM_PRESETS['one-op-basic']);
      const gain=fx.gain({gain:0.5});fx.setChain([gain]);gain.gain.rampTo(0.8,0.1);
      await sample.load('native-test',{sampleRate:22050,channels:[new Float32Array([0,.5,0,-.5])]});
      await sample.play('native-test',{loop:true});
      await fm.dac.setSample('native-dac',new Uint8Array([128,160,128,96]),{sampleRate:8000});
      await fm.dac.playFromSample('native-dac');
      psg.tone(PSG1,{note:'C4',attenuation:8});
      liveLoop('native-worker-phrase',async()=>{await play('E3',{channel:CH1,duration:0.1});await beat(0.1);});
    `,{execution:'worker'});
  });
  const calls=()=>native.calls.slice(first), commands=()=>calls().flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
  await until(()=>commands().some(c=>c.type==='write'&&c.register===0x28&&(c.value&0xf0)&&c.performance&&c.owner));
  assert(calls().some(c=>c.command==='native_genesis_performance'&&c.args.op==='start'));
  assert(calls().some(c=>c.command==='native_genesis_fx'&&c.args.message.op==='chain'&&c.args.performance));
  assert(calls().some(c=>c.command==='native_genesis_media_load'&&c.args.kind==='sample'));
  assert(commands().some(c=>c.type==='sample-play'&&c.performance&&c.frame>0));
  assert(commands().some(c=>c.type==='dac-play'&&c.performance&&c.frame>0));
  await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource('stopLoop("native-worker-phrase");',{execution:'worker'}));
  await until(()=>calls().some(c=>c.command==='native_genesis_performance'&&c.args.op==='cancel-owner'));
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  await until(()=>calls().some(c=>c.command==='native_genesis_performance'&&c.args.op==='stop'));
  // Reuse the existing Worker/ports after Stop with a fresh performance session.
  await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource('await play("G3",{channel:CH1,duration:0});',{execution:'worker'}));
  assert.equal(calls().filter(c=>c.command==='native_genesis_performance'&&c.args.op==='start').length,2);
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  await assertNoLiveAudio(page);
}
async function compressedSampleRuns(page,native) {
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  const beforeOffline=await page.evaluate(()=>window.__audioConstructions.offline);
  for(const [execution,alias,channels,sourceFrames] of [
    ['main','sonic-pi/drum-heavy-kick',1,11913],
    ['worker','sonic-pi/ambi-choir',2,69305],
  ]) {
    const first=native.calls.length;
    await page.evaluate(async({execution,alias})=>{
      await window.__nativeBackendTest.runtime.playSource(`
        await sample.load(${JSON.stringify(alias)});
        await sample.play(${JSON.stringify(alias)},{gain:0});
      `,{execution});
    },{execution,alias});
    const calls=native.calls.slice(first);
    const uploads=calls.filter(call=>call.command==='native_genesis_media_load'&&call.args.kind==='sample'&&call.args.name===alias);
    assert(uploads.length>0,`${execution}: actual FLAC decode must upload a native sample`);
    for(const {args} of uploads) {
      assert.equal(args.channels.length,channels);
      assert(Number.isInteger(args.sampleRate)&&args.sampleRate>=8000&&args.sampleRate<=384000);
      assert(args.channels.every(channel=>channel.length>10000&&channel.length===args.channels[0].length&&channel.every(Number.isFinite)));
      assert(args.channels.every(channel=>channel.some(value=>Math.abs(value)>1e-6)),`${execution}: decoded FLAC must contain audio`);
      assert(Math.abs(args.channels[0].length/args.sampleRate-sourceFrames/44100)<=2/args.sampleRate,`${execution}: decode must preserve FLAC duration`);
    }
    const play=calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]).find(command=>command.type==='sample-play'&&command.name===alias);
    assert(play,`${execution}: prepared FLAC must reach native playback`);
    if(execution==='worker')assert(play.performance&&play.owner&&play.frame>0);
    await assertNoLiveAudio(page);
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  }
  assert(await page.evaluate(before=>window.__audioConstructions.offline>before,beforeOffline),'Compressed samples must use the real offline decoder');
}
async function nativeNoiseRuns(page,native) {
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
  for(const execution of ['main','worker']) {
    const first=native.calls.length;
    const commands=()=>native.calls.slice(first).flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]).filter(command=>command.type==='noise');
    await page.evaluate(async execution=>{
      await window.__nativeBackendTest.runtime.playSource(`
        liveLoop('native-noise',async()=>{
          const voice=noise.create({type:'pink',seed:1234,autoStart:false,gain:0.05,pan:-0.25,attack:0.01,release:0.02});
          voice.filter.set('highpass',400,0.7);
          voice.start();
          control(voice,{gain:0.08,pan:0.5,cutoff:1200,q:0.8,slide:0.1});
          await sleep(60);
        });
      `,{execution});
    },execution);
    await until(()=>commands().some(command=>command.message.action==='parameter'&&command.message.seconds===0.1));
    const created=commands().find(command=>command.message.action==='create');
    assert.equal(created.message.type,1);assert.equal(created.message.seed,1234);
    assert(commands().some(command=>command.message.action==='filter'&&command.message.mode===1));
    assert(commands().some(command=>command.message.action==='start'));
    if(execution==='main') {
      assert(commands().every(command=>command.frame===0&&command.message.namespace===0));
      const before=commands().length;
      await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource('stopLoop("native-noise");',{execution:'main'}));
      await until(()=>commands().slice(before).some(command=>command.message.action==='retire'));
    } else {
      assert(commands().every(command=>command.performance&&command.owner&&command.message.namespace>0));
      assert.equal(created.frame,0,'Silent voice preparation must survive loop cancellation');
      assert(commands().some(command=>command.message.action==='start'&&command.frame>0));
      assert(commands().some(command=>command.message.action==='parameter'&&command.message.seconds===0.1&&command.frame>0));
      const identity=created.message.namespace;
      assert(commands().every(command=>command.message.namespace===identity));
      const cancelled=native.calls.length;
      await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource('stopLoop("native-noise");',{execution:'worker'}));
      await until(()=>native.calls.slice(cancelled).some(call=>call.command==='native_genesis_performance'&&call.args.op==='cancel-owner'));
      await until(()=>commands().some(command=>command.message.action==='retire'));
      const retired=commands().find(command=>command.message.action==='retire');
      assert.equal(retired.message.namespace,identity);
      assert.equal(retired.message.token,created.message.token);
      assert.equal(retired.frame,0);
      assert.equal(retired.performance,undefined);
      assert.equal(retired.owner,undefined);
    }
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    await assertNoLiveAudio(page);
  }
  // Native Stop retires descriptor identities, so a later Run starts again
  // from a free logical slot and a fresh token without reinitializing audio.
  const first=native.calls.length;
  await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource('const v=noise.create({type:"brown",seed:0});v.stop();v.start();v.dispose();',{execution:'main'}));
  await until(()=>native.calls.slice(first).some(call=>call.command==='native_genesis_commands'&&call.args.commands.some(command=>command.type==='noise'&&command.message.action==='dispose')));
  await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
}
async function monitorTrace(page,id,color,after=-1,expected={}) {
  await page.waitForFunction(({id,color,after,expected})=>{
    const trace=window.__monitorDrawings?.[id]?.traces[color];
    if(!trace||trace.revision<=after||!trace.points.length)return false;
    const ys=trace.points.map(point=>point[1]),low=Math.min(...ys),high=Math.max(...ys);
    return (expected.span===undefined||Math.abs(high-low-expected.span)<.05)&&
      (expected.minY===undefined||Math.abs(low-expected.minY)<.01);
  },{id,color,after,expected});
  return page.evaluate(({id,color})=>window.__monitorDrawings[id].traces[color],{id,color});
}
const traceSpan=trace=>Math.max(...trace.points.map(point=>point[1]))-Math.min(...trace.points.map(point=>point[1]));
async function nativeAudioMonitor(page,native,artifacts,name) {
  const reads=native.monitor.reads;
  assert.equal(reads.length,0,'Hidden Audio tab must not request native analysis');
  await page.click('#audioMonitorTab');
  await page.selectOption('#audioMonitorMode','envelope');
  await page.selectOption('#audioMonitorChannel','0');
  await page.selectOption('#audioMonitorScale','1');
  await until(()=>reads.some(read=>read.mode==='envelope'&&read.channel===0));
  await page.waitForFunction(()=>document.getElementById('audioMonitorStatus').textContent.includes('native mixed output'));
  const envelope=await monitorTrace(page,'audioMonitorEnvelope','#69cfff');
  const peak=await monitorTrace(page,'audioMonitorEnvelope','#ffba69');
  assert(Math.abs(envelope.points.at(-1)[1]-(130-.4/Math.SQRT2*112))<.01,'Native envelope must draw the reported RMS');
  assert(Math.abs(peak.points.at(-1)[1]-(130-.4*112))<.01,'Native envelope must draw the reported peak');

  await page.selectOption('#audioMonitorMode','waveform');
  await until(()=>reads.some(read=>read.mode==='waveform'&&read.channel===0));
  const left=await monitorTrace(page,'audioMonitorWave','#69cfff',-1,{span:.4*112});
  assert(Math.abs(traceSpan(left)-.4*112)<.05,'Left native PCM must reach the oscilloscope');
  await page.selectOption('#audioMonitorChannel','1');
  await until(()=>reads.some(read=>read.mode==='waveform'&&read.channel===1));
  await page.waitForFunction(()=>document.getElementById('audioMonitorStatus').textContent.includes('Right · native'));
  const right=await monitorTrace(page,'audioMonitorWave','#69cfff',left.revision,{span:.1*112});
  assert(Math.abs(traceSpan(right)-.1*112)<.05,'Channel switch must use the right native PCM');

  await page.selectOption('#audioMonitorMode','spectrum');
  await until(()=>reads.some(read=>read.mode==='spectrum'&&read.channel===1));
  const spectrumRight=await monitorTrace(page,'audioMonitorSpectrum','#ffba69',-1,{minY:18+.3*112});
  assert(Math.abs(Math.min(...spectrumRight.points.map(point=>point[1]))-(18+.3*112))<.01,'Spectrum must draw the native -30 dBFS peak');
  await page.selectOption('#audioMonitorChannel','0');
  await until(()=>reads.some(read=>read.mode==='spectrum'&&read.channel===0));
  await page.waitForFunction(()=>document.getElementById('audioMonitorStatus').textContent.includes('Left · native'));
  const spectrumLeft=await monitorTrace(page,'audioMonitorSpectrum','#ffba69',spectrumRight.revision,{minY:18+.12*112});
  assert(Math.abs(Math.min(...spectrumLeft.points.map(point=>point[1]))-(18+.12*112))<.01,'Spectrum channel switch must draw the native -12 dBFS peak');

  const waitStopped=async(action,label)=>{
    const offBefore=native.calls.filter(call=>call.command==='native_genesis_monitor'&&call.args.mode==='off').length;
    await action();
    await until(()=>native.calls.filter(call=>call.command==='native_genesis_monitor'&&call.args.mode==='off').length>offBefore);
    const count=reads.length;
    await page.waitForTimeout(250);
    assert.equal(reads.length,count,`${label} must stop native analysis requests`);
  };
  const clockBefore=await page.evaluate(()=>window.__nativeBackendTest.runtime.megaDrive.clock.currentTime);
  await waitStopped(()=>page.click('#audioMonitorPause'),'Pause');
  assert.equal(await page.locator('#audioMonitorPause').textContent(),'Resume');
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.runtime.getState().playback),'running');
  assert(await page.evaluate(before=>window.__nativeBackendTest.runtime.megaDrive.clock.currentTime>before+.15,clockBefore));
  const commandsBefore=native.count('native_genesis_commands');
  await page.evaluate(async()=>{
    const synth=window.__nativeBackendTest.runtime.megaDrive;synth.fm.write(0,0x22,0);await synth.flush();
  });
  assert(native.count('native_genesis_commands')>commandsBefore,'Pausing analysis must leave native command processing active');
  let before=reads.length;await page.click('#audioMonitorPause');await until(()=>reads.length>before);
  await waitStopped(()=>page.click('#consoleTab'),'Hiding Audio tab');
  before=reads.length;await page.click('#audioMonitorTab');await until(()=>reads.length>before);

  const originalStyle=await page.locator('#audioMonitorPanel').getAttribute('style');
  await waitStopped(()=>page.locator('#audioMonitorPanel').evaluate(panel=>{
    panel.style.position='fixed';panel.style.top='-10000px';panel.style.left='0';panel.style.width='700px';
  }),'Offscreen Audio panel');
  before=reads.length;
  await page.locator('#audioMonitorPanel').evaluate((panel,value)=>{
    if(value===null)panel.removeAttribute('style');else panel.setAttribute('style',value);
  },originalStyle);
  await until(()=>reads.length>before);

  await page.selectOption('#audioMonitorMode','waveform');
  const gate=native.holdNextMonitor('waveform');
  try {
    await until(()=>Boolean(gate.request));
    await page.selectOption('#audioMonitorMode','spectrum');
    const waveRevision=await page.evaluate(()=>window.__monitorDrawings.audioMonitorWave?.revision??0);
    const heldCount=reads.length;await page.waitForTimeout(120);
    assert.equal(reads.length,heldCount,'A delayed snapshot must not start parallel native reads');
    gate.release();
    await until(()=>reads.length>heldCount&&reads.at(-1).mode==='spectrum');
    await page.waitForFunction(()=>document.getElementById('audioMonitorStatus').textContent.includes('native mixed output'));
    assert.equal(await page.evaluate(()=>window.__monitorDrawings.audioMonitorWave?.revision??0),waveRevision,'A stale mode response must not repaint its canvas');
  } finally {gate.release();}
  const rateStart=performance.now(),rateBefore=reads.length;await page.waitForTimeout(500);
  assert(reads.length-rateBefore<=Math.ceil((performance.now()-rateStart)*15/1000)+2,'Steady native analysis must stay at or below 15 requests/sec');
  assert.equal(native.monitor.maxPending,1,'Only one native observation read may be in flight');
  assert.equal(await page.evaluate(()=>window.__nativeBackendTest.runtime.getState().playback),'running');
  await assertNoLiveAudio(page);
  await page.screenshot({path:path.join(artifacts,name+'-native-audio-monitor.png')});
  await waitStopped(()=>page.click('#consoleTab'),'Closing Audio tab');
}
async function nativeRecording(page,native) {
  await page.locator('#mainMenu > summary').click();
  await page.click('#audioDiagnosticsButton');
  const panel=page.locator('.audio-diagnostics');await panel.waitFor({state:'visible'});
  const before=native.count('native_genesis_record_start');
  await panel.getByRole('button',{name:'Record 30 s',exact:true}).click();
  await until(()=>native.count('native_genesis_record_start')>before);
  await panel.getByRole('button',{name:'Mark noise',exact:true}).click();
  await panel.getByRole('button',{name:'Stop recording',exact:true}).click();
  await panel.getByRole('button',{name:'Save output WAV',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('.audio-diagnostics button')).find(b=>b.textContent==='Save output WAV').disabled);
  assert(await panel.getByRole('button',{name:'Save chip WAV',exact:true}).isDisabled());
  const saving=page.waitForEvent('download');await panel.getByRole('button',{name:'Save output WAV',exact:true}).click();
  const downloaded=await saving,bytes=await fs.readFile(await downloaded.path());
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.readUInt16LE(20),3);assert.equal(bytes.readUInt32LE(40),16*8);
  await panel.getByRole('button',{name:'Close diagnostics',exact:true}).click();
  await assertNoLiveAudio(page);
}
async function keyboard(page, native) {
  await page.click('#keyboardTab');
  for (const [chip, channel] of [['ym2612','fm:0'], ['segapsg','0']]) {
    await page.selectOption('#playgroundKeyboardChip', 'chip:' + chip);
    await page.selectOption('#playgroundKeyboardTargetChannel', channel);
    await page.locator('#keyboardTab').focus();
    const first = native.calls.length;
    const commands = () => native.calls.slice(first).flatMap(call => call.command === 'native_genesis_commands' ? call.args.commands : []);
    await page.keyboard.down('z');
    await until(() => commands().some(entry => chip === 'ym2612'
      ? entry.type === 'write' && entry.register === 0x28 && Boolean(entry.value & 0xf0)
      : entry.type === 'psg-write' && (entry.value & 0xf0) === 0x90 && (entry.value & 15) !== 15));
    await page.keyboard.up('z');
    await until(() => commands().some(entry => chip === 'ym2612'
      ? entry.type === 'write' && entry.register === 0x28 && !(entry.value & 0xf0)
      : entry.type === 'psg-write' && entry.value === 0x9f));
  }
}
async function compareNativeFft(browser,name,fixture) {
  assert.equal(fixture.samples?.length,4096);assert.equal(fixture.bins?.length,2048);
  assert(fixture.samples.every(Number.isFinite)&&fixture.bins.every(Number.isFinite));
  const page=await browser.newPage();
  try {
    const result=await page.evaluate(async({sampleRate,samples})=>{
      const Type=window.OfflineAudioContext??window.webkitOfflineAudioContext;
      const context=new Type(1,8192,sampleRate),analyser=context.createAnalyser();
      analyser.fftSize=4096;analyser.smoothingTimeConstant=0;analyser.minDecibels=-100;analyser.maxDecibels=0;
      // Repeat the exact native period so every analyser window sees the same
      // steady source, regardless of the browser's final render quantum.
      const buffer=context.createBuffer(1,8192,sampleRate),pcm=buffer.getChannelData(0);
      pcm.set(samples);pcm.set(samples,4096);
      const source=context.createBufferSource();source.buffer=buffer;source.connect(analyser);analyser.connect(context.destination);source.start();
      await context.startRendering();
      const bins=new Float32Array(2048),wave=new Float32Array(4096);
      analyser.getFloatFrequencyData(bins);analyser.getFloatTimeDomainData(wave);
      let square=0,peak=0;for(const value of wave){square+=value*value;peak=Math.max(peak,Math.abs(value));}
      return {bins:Array.from(bins),rms:Math.sqrt(square/wave.length),peak};
    },fixture);
    const clamp=value=>Math.max(-100,Math.min(0,value));
    let maxError=0,maxBin=0;
    for(let i=0;i<2048;i++) {
      assert(!Number.isNaN(result.bins[i]));const error=Math.abs(clamp(result.bins[i])-clamp(fixture.bins[i]));
      if(error>maxError){maxError=error;maxBin=i;}
    }
    assert(maxError<.02,`${name}: native FFT differs from OfflineAudioContext by ${maxError} dB at bin ${maxBin}`);
    assert(Math.abs(result.rms-fixture.rms)<1e-6,`${name}: native RMS must match the offline analyser window`);
    assert(Math.abs(result.peak-fixture.peak)<1e-6,`${name}: native peak must match the offline analyser window`);
    console.log(`${name}: PASS actual native 4096-point Blackman FFT/RMS/peak vs offline Web Audio; maximum ${maxError.toExponential(3)} dB at bin ${maxBin}; no output device`);
  } finally {await page.close();}
}

async function checkBrowser(name, type, url, artifacts,fftFixture) {
  const browser = await type.launch({headless:true,...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    if(fftFixture)await compareNativeFft(browser,name,fftFixture);
    const plain = await browser.newContext({serviceWorkers:'block'});
    const normal = await plain.newPage();
    // Exercise the real textarea fallback; external Monaco CDN availability is
    // unrelated to native transport/settings and is not required by this check.
    await normal.route('**/vs/loader*.js', route => route.abort());
    await normal.goto(url);
    await ready(normal);
    assert.equal(await normal.locator('#audioEngineButton').count(), 0);
    await plain.close();
    const context = await browser.newContext({serviceWorkers:'block'}), page = await context.newPage();
    const native = new FakeNative(), errors = [];
    await page.exposeBinding('__nativeInvoke', (_event, command, args) => native.invoke(command, args));
    await page.addInitScript(observeAudioCreation);
    await page.addInitScript(observeMonitorDrawing);
    await page.addInitScript(() => {window.__TAURI_INTERNALS__ = {invoke:(command,args) => window.__nativeInvoke(command,args)};});
    await page.route('**/vs/loader*.js', route => route.abort());
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(20000);
    await page.goto(url); await ready(page);
    assert.equal(native.count('native_genesis_start'), 0);
    await openSettings(page);
    assert.equal(await page.locator('#audioEngineSelect').inputValue(), 'webaudio');
    await page.locator('#audioEngineDialog').evaluate(dialog => dialog.close());
    await page.evaluate(source => {window.__nativeBackendTest.editor.setValue(source); document.getElementById('workerExecution').checked = false;}, source);
    await run(page);
    assert(await page.evaluate(() => window.__audioConstructions.contexts > 0 && window.__audioConstructions.worklets.includes('ym2612-processor')));
    assert.equal(native.count('native_genesis_start'), 0);
    await selectEngine(page, 'native');
    assert.equal(native.count('native_genesis_start'), 0, 'Selection alone must not open a device');
    await nativeRun(page, native);
    const firstSession = native.current.session;
    await page.click('#stopButton');
    await until(() => native.count('native_genesis_stop') > 0);
    await page.waitForFunction(() => window.__nativeBackendTest.runtime.getState().playback === 'stopped');
    await keyboard(page, native);
    await workerMediaRun(page,native);
    await compressedSampleRuns(page,native);
    await nativeNoiseRuns(page,native);
    await nativeRun(page, native);
    await nativeAudioMonitor(page,native,artifacts,name);
    await nativeRecording(page,native);
    assert.equal(native.current.session, firstSession, 'Stop/Run should reuse the stream clock');
    await openSettings(page);
    await page.screenshot({path:path.join(artifacts, name + '-native-settings.png')});
    await page.locator('#audioEngineDialog').evaluate(dialog => dialog.close());
    await selectEngine(page, 'webaudio');
    assert(native.count('native_genesis_shutdown') > 0);
    assert.equal(native.current, null);
    // Native failure remains visible and selected, with no silent Web Audio fallback.
    native.failStart = true;
    await selectEngine(page, 'native');
    await page.click('#runButton');
    await page.waitForFunction(() => document.body.textContent.includes('Simulated native device unavailable'));
    assert.equal(await page.evaluate(() => new URL(location.href).searchParams.get('audioEngine')), 'native');
    await assertNoLiveAudio(page);
    await selectEngine(page, 'webaudio'); await run(page);
    assert(await page.evaluate(() => window.__audioConstructions.contexts > 0));
    // Switching machine mode closes native ownership and uses Web Audio explicitly.
    await selectEngine(page, 'native'); await nativeRun(page, native);
    const shutdowns = native.count('native_genesis_shutdown');
    await page.locator('#mainMenu > summary').click();
    await page.selectOption('#playgroundMode', 'gameboy');
    await page.locator('#changeModeDialog').waitFor({state:'visible'});
    await Promise.all([page.waitForURL(url => url.searchParams.get('mode') === 'gameboy'), page.locator('#changeModeDialog').evaluate(dialog => dialog.close('keep'))]);
    await ready(page);
    assert(native.count('native_genesis_shutdown') > shutdowns);
    assert.equal(native.current, null);
    assert.notEqual(await page.evaluate(() => window.__nativeBackendTest.runtime.megaDrive.backend), 'native-genesis');
    await openSettings(page);
    assert.equal(await page.locator('#audioEngineSelect option[value="native"]').isDisabled(), true);
    assert.equal(await page.locator('#audioEngineSelect').inputValue(), 'webaudio');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(artifacts, name + '-native-settings.json'), JSON.stringify({mockedNative:true, calls:native.calls}, null, 2));
    await context.close();
    console.log(`${name}: PASS Web Audio default, project handoff, Native Main/Worker, real FLAC decoding, DAC/sample/FX/noise, Envelope/Wave/Spectrum and observation lifecycle, loop cancellation, recording, Stop/Run, failure/recovery, mode cleanup; no native live AudioContext/Worklet (native IPC mocked)`);
  } finally {await browser.close();}
}

(async () => {
  const option = process.argv.find(value => value.startsWith('--out='));
  const artifacts = option ? path.resolve(option.slice(6)) : await fs.mkdtemp(path.join(os.tmpdir(), 'playground-native-backend-'));
  await fs.mkdir(artifacts, {recursive:true});
  const fftOption=process.argv.find(value=>value.startsWith('--fft-fixture='));
  const fftFixture=fftOption?JSON.parse(await fs.readFile(path.resolve(fftOption.slice(14)),'utf8')):null;
  await new Promise((resolve,reject) => {server.once('error',reject); server.listen(0,'127.0.0.1',resolve);});
  try {
    const url = `http://127.0.0.1:${server.address().port}${entryPath}?mode=genesis`;
    for (const [name,type] of [['chromium',chromium],['webkit',webkit]]) {
      if (!process.argv.includes('--chromium') && !process.argv.includes('--webkit') || process.argv.includes('--' + name)) await checkBrowser(name,type,url,artifacts,fftFixture);
    }
    console.log('Artifacts: ' + artifacts);
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1;});
