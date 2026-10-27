// Real PCE CD-ROM2 Browser/Worker integration. Only generated audio fixtures;
// capture measures the actual host sum before a zeroed physical output.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const {createHash} = require('node:crypto');
const {chromium, webkit} = require('playwright');
const root = path.resolve(__dirname, '..'), args = process.argv.slice(2), served = new Map();
const selected = args.includes('--chromium') ? ['chromium'] : args.includes('--webkit') ? ['webkit'] : ['chromium', 'webkit'];
const out = args.find(arg => arg.startsWith('--out='))?.slice(6);
if (args.some(arg => !['--chromium', '--webkit', '--endpoint-only', '--playground-only'].includes(arg) && !arg.startsWith('--out=')) ||
    args.includes('--endpoint-only') && args.includes('--playground-only')) {
  throw Error('Usage: node scripts/check_pcengine_cd_browser.cjs [--chromium|--webkit] [--endpoint-only|--playground-only] [--out=REPORT.json]');
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const captureSource = `class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.pending = null; this.port.onmessage = ({data}) => {
    if (this.pending) throw Error('Concurrent PCE capture');
    this.pending = {id:data.id,left:new Float32Array(data.frames),right:new Float32Array(data.frames),offset:0,start:null};
  }; }
  process(inputs, outputs) {
    for (const channel of outputs[0]) channel.fill(0);
    const p = this.pending; if (!p) return true;
    if (p.start === null) { p.start = currentFrame; this.port.postMessage({id:p.id,type:'started',firstFrame:p.start}); }
    const input = inputs[0], count = Math.min(128, p.left.length - p.offset);
    for (let i=0;i<count;i++) { p.left[p.offset+i]=input[0]?.[i]??0; p.right[p.offset+i]=input[1]?.[i]??0; }
    p.offset += count;
    if (p.offset === p.left.length) { this.pending=null; this.port.postMessage({id:p.id,type:'done',firstFrame:p.start,left:p.left,right:p.right},[p.left.buffer,p.right.buffer]); }
    return true;
  }
} registerProcessor('pce-cd-capture',Capture);`;
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/') { res.writeHead(200, {'Content-Type':'text/html'}).end('<button id="run">Check PCE CD</button>'); return; }
    if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (pathname === '/__pce_capture.js') { res.writeHead(200, {'Content-Type':'text/javascript'}).end(captureSource); return; }
    const file = path.resolve(root, '.' + pathname); if (!file.startsWith(root + path.sep)) throw Error('Invalid path');
    let bytes = await fs.readFile(file); const name = path.relative(root, file), hash = sha(bytes);
    if (served.has(name) && served.get(name).sha256 !== hash) throw Error('Source changed during Browser check: ' + name);
    served.set(name, {bytes:bytes.length,sha256:hash});
    if (pathname === '/docs/playground/playground.js') bytes = Buffer.from(bytes.toString() +
      '\nwindow.__pceCD={runtime,megaDrive,virtualFiles,setSource:value=>editorAdapter.setValue(value)};');
    const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'};
    res.writeHead(200, {'Content-Type':mime[path.extname(file)] ?? 'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
  } catch (error) { res.writeHead(404).end(error.message); }
});

async function endpointCheck(page, rate) {
  await page.evaluate(rate => {
    document.getElementById('run').onclick = () => { window.result = (async () => {
      const check = (ok, message) => { if (!ok) throw Error(message); };
      const context = new AudioContext({sampleRate:rate}); await context.resume();
      check(context.sampleRate === rate, 'Requested output rate');
      const [{createMsm5205Audio},{createMsm5205Player},{prepareMSM5205Sample},{createMSM5205PCM}] = await Promise.all([
        import('/web/msm5205_audio.js'),import('/web/msm5205_player.js'),import('/web/msm5205_sample.js'),import('/web/msm5205_pcm.js')]);
      await context.audioWorklet.addModule('/__pce_capture.js');
      const capture = new AudioWorkletNode(context, 'pce-cd-capture', {numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
      capture.connect(context.destination); let id = 0; const waiters = new Map();
      capture.port.onmessage = ({data}) => {
        const p = waiters.get(data.id); if (!p) return;
        if (data.type === 'started') p.started(data); else { waiters.delete(data.id); clearTimeout(p.timer); p.done(data); }
      };
      function begin(frames) {
        let started, done, reject;
        const first = new Promise(resolve => started = resolve), result = new Promise((resolve, fail) => {done=resolve;reject=fail;});
        const token=++id,timer=setTimeout(()=>{waiters.delete(token);reject(Error('PCE CD capture timeout'));},10000);
        waiters.set(token,{started,done,timer});capture.port.postMessage({id:token,frames});return {started:first,result};
      }
      const take = (frames=Math.round(rate*.04)) => begin(frames).result;
      const input = Float32Array.from({length:8000},(_,i)=>.35*Math.sin(i*2*Math.PI*440/8000)*Math.min(1,i/200,(8000-i)/200));
      const sample = await prepareMSM5205Sample({channels:[input],sampleRate:8000});
      const oracle = await createMSM5205PCM({sampleRate:rate}); oracle.prepare(sample.data); oracle.play({rate:sample.rate,loop:true});
      const reference = new Float32Array(rate*5), referenceRight = new Float32Array(reference.length);oracle.render(reference,referenceRight);
      const analyze = (data,{origin=0,gain=1,pan=0,zero=false,label}) => {
        let peak=0,error=0,energy=0,active=0;
        for(let i=0;i<data.left.length;i++)for(let channel=0;channel<2;channel++){
          const actual=channel?data.right[i]:data.left[i],position=data.firstFrame+i-origin;
          const level=gain*(channel?1+Math.min(0,pan):1-Math.max(0,pan));
          const expected=zero||position<0?0:reference[position]*level;
          check(Number.isFinite(actual)&&Number.isFinite(expected),label+': finite PCM/reference');
          peak=Math.max(peak,Math.abs(actual));error=Math.max(error,Math.abs(actual-expected));energy+=actual*actual;if(Math.abs(actual)>1e-5)active++;
        }
        check(peak<1,label+': no clipping');check(error<2e-6,label+': sample clock and WASM reference error '+error);
        if(zero)check(peak===0,label+': strict silence');
        return {firstFrame:data.firstFrame,frames:data.left.length,peak,maxError:error,rms:Math.sqrt(energy/data.left.length/2),active};
      };
      let audio, player; const results={};
      try {
        audio=await createMsm5205Audio(context);audio.node.connect(capture);player=createMsm5205Player(audio);
        results.initial=analyze(await take(),{zero:true,label:'unloaded endpoint'});
        await player.reset();results.resetEmpty=analyze(await take(),{zero:true,label:'unloaded reset'});
        const metadata=await player.loadSample({channels:[input],sampleRate:8000});
        check(metadata.rate===12&&metadata.sampleRate===8000&&metadata.frames===8000,'Encoded sample metadata');
        let recording=begin(Math.round(rate*.18)),start=await recording.started;
        const playFrame=start.firstFrame+Math.round(rate*.04),play=await player.play({loop:true,at:playFrame/rate});
        check(play.scheduled&&play.scheduledFrame===playFrame,'Exact scheduled play');
        results.scheduled=analyze(await recording.result,{origin:playFrame,label:'scheduled 8k ADPCM'});
        check(results.scheduled.active>1000,'Real decoded waveform');
        await audio.command({type:'mix',mute:true});results.muted=analyze(await take(),{zero:true,label:'mute'});
        const muted=await player.getState();check(muted.state==='playing','Muted decoder continues');
        await audio.command({type:'mix',mute:false,volume:.5,pan:-1});
        results.left=analyze(await take(),{origin:playFrame,gain:.5,pan:-1,label:'half volume/left pan'});
        await audio.command({type:'mix',pan:1});
        results.right=analyze(await take(),{origin:playFrame,gain:.5,pan:1,label:'right pan'});
        await audio.command({type:'mix',volume:1,pan:0});
        const future=await player.play({loop:true,at:context.currentTime+.1});check(future.scheduled,'Queued future ADPCM');
        await player.stop();results.stopped=analyze(await take(Math.round(rate*.14)),{zero:true,label:'stop cancels future play'});
        const stopped=await player.getState();check(stopped.state==='ready','Stop returns ready');
        await player.play({length:80,rate:12});
        await take(Math.round(rate*.04));results.ended=analyze(await take(),{zero:true,label:'sample end'});
        check((await player.getState()).state==='ended','End reported from audio side');
        await player.play({loop:true,rate:12});const replay=await take();
        check(replay.left.some(value=>Math.abs(value)>.01),'Replay produces PCM');
        player.dispose();player=null;results.disposed=analyze(await take(),{zero:true,label:'dispose'});
        check(context.state!=='closed','Borrowed audio context remains open');
        return {sampleRate:rate,sourceSampleRate:sample.sampleRate,encodedBytes:sample.data.length,physicalOutputMuted:true,results};
      } finally { player?.dispose();audio?.dispose();oracle.dispose();capture.disconnect();capture.port.close();await context.close(); }
    })(); };
  }, rate);
  await page.click('#run');return page.evaluate(()=>window.result);
}

async function playgroundCheck(page, origin, execution) {
  await page.addInitScript(()=>{
    const connect=AudioNode.prototype.connect,gates=new WeakMap();
    AudioNode.prototype.connect=function(destination,...rest){
      if(destination===this.context.destination){let gate=gates.get(this.context);if(!gate){gate=this.context.createGain();gate.gain.value=0;gates.set(this.context,gate);connect.call(gate,destination);}return connect.call(this,gate,...rest);}
      return connect.call(this,destination,...rest);
    };
  });
  await page.goto(`${origin}/docs/playground/index.html?mode=pc-engine-cd&no-sw=1`);
  await page.waitForFunction(()=>window.__pceCD&&window.monaco?.editor?.getEditors().length||document.getElementById('status')?.textContent==='Startup failed.');
  assert(await page.evaluate(()=>!!window.__pceCD),'Playground initializes successfully');
  await page.locator('#startupNotice').waitFor({state:'hidden'});
  await page.evaluate(execution=>{
    const shared=window.__pceCD,rate=44100,frames=rate*12,bytes=new Uint8Array(44+frames*4),view=new DataView(bytes.buffer),enc=new TextEncoder();
    for(const [offset,tag]of [[0,'RIFF'],[8,'WAVEfmt '],[36,'data']])bytes.set(enc.encode(tag),offset);
    view.setUint32(4,bytes.length-8,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,rate,true);view.setUint32(28,rate*4,true);view.setUint16(32,4,true);view.setUint16(34,16,true);view.setUint32(40,frames*4,true);
    for(let i=0;i<frames;i++){view.setInt16(44+i*4,Math.round(3000*Math.sin(i*2*Math.PI*660/rate)),true);view.setInt16(46+i*4,Math.round(3000*Math.sin(i*2*Math.PI*880/rate)),true);}
    shared.virtualFiles.writeBinary('/cdda/pce-cd-test.wav',bytes);
    shared.source=`
await cdda.load('/cdda/pce-cd-test.wav');
const encodedSample = await adpcm.loadSample({channels:[Float32Array.from({length:8000},(_,i)=>.25*Math.sin(i*2*Math.PI*440/8000)*Math.min(1,i/200,(8000-i)/200))],sampleRate:8000},{rate:12});
if(encodedSample.rate!==12||encodedSample.sampleRate!==8000)throw Error('ADPCM sample metadata');
pce.setWaveform(0,Array.from({length:32},(_,i)=>Math.round(15.5+15.5*Math.sin(i*Math.PI/16))));
pce.setVolume(0,22);pce.setPan(0,15,15);pce.noteOn(0,'A3');
await adpcm.play({loop:true});await cdda.play();
await mixer.set('huc6280',{volume:.35,muted:false});
await mixer.set('msm5205',{volume:.35,muted:false});
await mixer.set('cdda',{volume:.35,muted:false});
const stage=async(name,states)=>{for(const [id,muted,pan]of states)await mixer.set(id,{muted,pan:pan??0});console.log('__PCE_CD_STAGE__'+name);await sleep(name==='all'?1.6:.9);};
await stage('all',[['huc6280',false],['msm5205',false],['cdda',false]]);
await stage('psg',[['huc6280',false],['msm5205',true],['cdda',true]]);
await stage('adpcm',[['huc6280',true],['msm5205',false],['cdda',true]]);
await stage('cdda',[['huc6280',true],['msm5205',true],['cdda',false]]);
await stage('adpcm-left',[['huc6280',true],['msm5205',false,-1],['cdda',true]]);
await stage('none',[['huc6280',true],['msm5205',true],['cdda',true]]);
console.log('__PCE_CD_DONE__');
liveLoop('pce-cd-test',async()=>{await sleep(.1);});`;
    shared.setSource(shared.source);document.getElementById('workerExecution').checked=execution==='worker';
  },execution);
  await page.click('#runButton');
  await page.waitForFunction(()=>document.getElementById('consoleOutput')?.textContent.includes('__PCE_CD_STAGE__all'));
  await page.evaluate(async()=>{
    const shared=window.__pceCD,context=shared.megaDrive.audioContext;
    await context.audioWorklet.addModule('/__pce_capture.js');
    const node=new AudioWorkletNode(context,'pce-cd-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});node.connect(context.destination);
    const detach=shared.megaDrive.audio.connectOutputMonitor(node);let current=null,id=0;
    node.port.onmessage=({data})=>{if(data.type==='done'&&current?.id===data.id){const pending=current;current=null;clearTimeout(pending.timer);pending.resolve(data);}};
    shared.take=(frames=10240)=>new Promise((resolve,reject)=>{const token=++id,timer=setTimeout(()=>reject(Error('Host capture timeout')),10000);current={id:token,resolve,timer};node.port.postMessage({id:token,frames});});
    shared.closeCapture=()=>{detach();node.disconnect();node.port.close();};
  });
  const results={};
  try {
    // Worker PSG scripts intentionally have 0.5 s performance lead. Advance
    // real audio frames before the first mixed capture; CD transports need no
    // extra JS lead. Later phases only alter immediate Mixer strips.
    if(execution==='worker')await page.evaluate(async()=>{await window.__pceCD.take(Math.ceil(window.__pceCD.megaDrive.audioContext.sampleRate*.65));});
    for(const stage of ['all','psg','adpcm','cdda','adpcm-left','none']) {
      await page.waitForFunction(stage=>document.getElementById('consoleOutput')?.textContent.includes('__PCE_CD_STAGE__'+stage),stage);
      results[stage]=await page.evaluate(async()=>{
        const shared=window.__pceCD,data=await shared.take(),rate=shared.megaDrive.audioContext.sampleRate,left=data.left.subarray(2048),right=data.right.subarray(2048);
        let peak=0,energy=0,difference=0;for(let i=0;i<left.length;i++){if(!Number.isFinite(left[i])||!Number.isFinite(right[i]))throw Error('Nonfinite host PCM');peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));energy+=left[i]*left[i]+right[i]*right[i];difference=Math.max(difference,Math.abs(left[i]-right[i]));}
        const amplitude=(channel,f)=>{let s=0,c=0;for(let i=0;i<channel.length;i++){const phase=2*Math.PI*f*i/rate;s+=channel[i]*Math.sin(phase);c+=channel[i]*Math.cos(phase);}return 2*Math.hypot(s,c)/channel.length;};
        return {sampleRate:rate,peak,rms:Math.sqrt(energy/left.length/2),difference,leftPeak:Math.max(...left.map(Math.abs)),rightPeak:Math.max(...right.map(Math.abs)),left:[220,440,660,880].map(f=>amplitude(left,f)),right:[220,440,660,880].map(f=>amplitude(right,f)),mix:shared.megaDrive.mixer.list().filter(({id})=>['huc6280','msm5205','cdda'].includes(id)).map(({id,volume})=>({id,volume}))};
      });
      const value=results[stage];assert(value.peak<1,`${execution}/${stage}: finite unclipped sum`);
      assert(value.mix.length===3&&value.mix.every(({volume})=>volume===.35),`${execution}/${stage}: partial Mixer changes retain authored volume`);
      if(stage==='none')assert.equal(value.peak,0,`${execution}: three independent mutes produce exact silence`);
      else assert(value.rms>.001,`${execution}/${stage}: actual waveform`);
      if(stage==='psg')assert(value.left[0]>.003&&value.left[1]<value.left[0]*.08&&value.left[2]<value.left[0]*.08,`${execution}: PSG-only frequency`);
      if(stage==='adpcm')assert(value.left[1]>.01&&value.left[0]<value.left[1]*.08&&value.left[2]<value.left[1]*.08,`${execution}: ADPCM-only frequency`);
      if(stage==='cdda')assert(value.left[2]>.01&&value.right[3]>.01&&value.left[1]<value.left[2]*.08,`${execution}: independent stereo CD-DA`);
      if(stage==='adpcm-left')assert(value.left[1]>.01&&value.rightPeak===0,`${execution}: separate ADPCM pan`);
      if(stage==='all')assert(value.left[0]>.003&&value.left[1]>.01&&value.left[2]>.01&&value.right[3]>.01,`${execution}: PSG + ADPCM + CD-DA all present: ${JSON.stringify(value)}`);
    }
    assert(Math.abs(results.all.left[1]/results.adpcm.left[1]-1)<.15,`${execution}: ADPCM loop amplitude stays stable while sibling strips mute`);
    assert(Math.abs(results['adpcm-left'].left[1]/results.adpcm.left[1]-1)<.15,`${execution}: independent pan retains ADPCM amplitude`);
    await page.waitForFunction(()=>document.getElementById('consoleOutput')?.textContent.includes('__PCE_CD_DONE__'));
    const strips=await page.evaluate(()=>window.__pceCD.megaDrive.mixer.list().map(({id,kind})=>({id,kind})));
    for(const id of ['huc6280','msm5205','cdda'])assert.equal(strips.filter(strip=>strip.id===id).length,1,'independent strip '+id);
    await page.click('#stopButton');await page.waitForFunction(()=>window.__pceCD.runtime.getState().playback==='stopped');
    const stop=await page.evaluate(async()=>{const shared=window.__pceCD,data=await shared.take();return {peak:Math.max(...data.left.map(Math.abs),...data.right.map(Math.abs)),strips:shared.megaDrive.mixer.list().map(({id})=>id)};});
    assert.equal(stop.peak,0,'Stop clears actual PCM');assert(!stop.strips.includes('msm5205')&&!stop.strips.includes('cdda'),'Stop retires lazy inputs');
    await page.evaluate(()=>{const shared=window.__pceCD;shared.setSource(shared.source.slice(0,shared.source.indexOf("const stage="))+"console.log('__PCE_CD_RERUN__');liveLoop('rerun',async()=>{await sleep(.1);});");});
    await page.click('#runButton');await page.waitForFunction(()=>document.getElementById('consoleOutput')?.textContent.includes('__PCE_CD_RERUN__'));
    const rerun=await page.evaluate(async()=>{const shared=window.__pceCD,data=await shared.take();let peak=0;for(const channel of [data.left,data.right])for(const x of channel){if(!Number.isFinite(x))throw Error('Rerun nonfinite');peak=Math.max(peak,Math.abs(x));}return {peak,strips:shared.megaDrive.mixer.list().map(({id})=>id)};});
    assert(rerun.peak>.01&&rerun.peak<1,'Rerun recreates mixed audio');for(const id of ['msm5205','cdda'])assert.equal(rerun.strips.filter(value=>value===id).length,1,'no duplicate re-created strip');
    await page.click('#stopButton');await page.waitForFunction(()=>window.__pceCD.runtime.getState().playback==='stopped');
    await page.evaluate(async()=>{
      const source=await (await fetch('/docs/playground/defaults/pc-engine-cd/index.js')).text();
      window.__pceCD.setSource(source+"\nconsole.log('__PCE_CD_STARTER__',JSON.stringify({adpcm:(await adpcm.getState()).state,cdda:(await cdda.getState()).state}));");
    });
    await page.click('#runButton');await page.waitForFunction(()=>document.getElementById('consoleOutput')?.textContent.includes('__PCE_CD_STARTER__'));
    const starter=await page.evaluate(async()=>{
      const shared=window.__pceCD,data=await shared.take();let peak=0;
      for(const channel of [data.left,data.right])for(const x of channel){if(!Number.isFinite(x))throw Error('Starter nonfinite PCM');peak=Math.max(peak,Math.abs(x));}
      const text=document.getElementById('consoleOutput').textContent,match=text.match(/__PCE_CD_STARTER__\s+(\{[^\n]+\})/);
      return {peak,states:match?JSON.parse(match[1]):null,strips:shared.megaDrive.mixer.list().map(({id})=>id)};
    });
    assert(starter.peak>.01&&starter.peak<1,'Actual mode starter produces finite mixed audio');assert.deepEqual(starter.states,{adpcm:'playing',cdda:'playing'});
    await page.click('#stopButton');await page.waitForFunction(()=>window.__pceCD.runtime.getState().playback==='stopped');
    return {execution,results,strips,stop,rerun,starter,virtualFiles:true,physicalOutputMuted:true};
  } finally {await page.evaluate(()=>window.__pceCD.closeCapture?.());}
}

(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`,results=[],playground=[];
  try {
    for(const name of selected) {
      const browser=await (name==='chromium'?chromium:webkit).launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
      try {
        for(const rate of args.includes('--playground-only')?[]:[44100,48000]) {
          const page=await browser.newPage(),errors=[],bad=[];page.setDefaultTimeout(30000);
          page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)bad.push({url:response.url(),status:response.status()});});
          page.on('console',message=>{if(message.type()==='error')console.error(`${name}/${rate} console: ${message.text()}`);});
          try {await page.goto(origin);const result=await endpointCheck(page,rate);assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);results.push({browser:name,version:browser.version(),...result});console.log(`PASS ${name}/${rate}: real MSM5205 WASM/Worklet, scheduled play, Mixer and lifecycle`);}
          finally {await page.close();}
        }
        for(const execution of args.includes('--endpoint-only')?[]:['main','worker']) {
          const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1280,height:900}}),errors=[],bad=[];page.setDefaultTimeout(30000);
          page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)bad.push({url:response.url(),status:response.status()});});
          page.on('console',message=>{if(message.type()==='error')console.error(`${name}/${execution} console: ${message.text()}`);});
          try {const result=await playgroundCheck(page,origin,execution);assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);playground.push({browser:name,version:browser.version(),...result});console.log(`PASS ${name}/${execution}: PC Engine CD-ROM2 PSG + ADPCM + CD-DA, strips and Stop/Rerun`);}
          catch(error){console.error(`${name}/${execution} diagnostics`,{errors,bad,page:await page.evaluate(()=>({console:document.getElementById('consoleOutput')?.textContent,status:document.getElementById('status')?.textContent,startup:document.getElementById('startupNotice')?.textContent,runtime:window.__pceCD?.runtime.getState()})).catch(()=>null)});throw error;}
          finally {await page.close();}
        }
      } finally {await browser.close();}
    }
    const report={schemaVersion:1,passed:true,physicalOutputMuted:true,results,playground,sources:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),checkerSha256:sha(await fs.readFile(__filename))};
    if(out)await fs.writeFile(path.resolve(out),JSON.stringify(report,null,2)+'\n');
  } finally {await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
