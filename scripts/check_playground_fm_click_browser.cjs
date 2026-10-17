// Diagnostic capture: raw YM2612 and final PCM at the same audio frames, plus
// actual applied key/pitch writes. Never changes production files or smooths sound.
// Run both engines, or --chromium / --webkit. Optional --seconds=5 --stall-ms=60
// and --case=worker-distortion-ui for a narrow timing probe.
// --lookahead-ms=500 configures the real Worker performance transport (default).
// Use --lookahead-ms=0 for a comparison without transport lead.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {chromium,webkit} = require('playwright');
const docs = path.resolve(__dirname,'../docs');
const argument = (name,fallback) => process.argv.find(value => value.startsWith(name + '='))?.slice(name.length + 1) ?? fallback;
const seconds = Number(argument('--seconds',5)),stallMs = Number(argument('--stall-ms',60));
const lookaheadMs = Number(argument('--lookahead-ms',500));
assert(Number.isFinite(seconds) && seconds >= 2 && seconds <= 60);
assert(Number.isFinite(stallMs) && stallMs >= 0 && stallMs <= 250);
assert(Number.isFinite(lookaheadMs) && lookaheadMs >= 0 && lookaheadMs <= 1000);
const artifacts = process.env.PANEL_TEST_ARTIFACT_DIR || os.tmpdir();
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};

const traceCommand = `
    if (command.type === 'fm-click-diag') {
      if (command.action === 'start') {
        this.__clickTrace = new Float64Array(65536); this.__clickTraceN = 0;
        this.__clickStats = {calls:0,totalMs:0,maxMs:0,maxWallGapMs:0,lastWall:null};
        this.__clickLastSentWall = null; this.__clickLastDue = -Infinity;
        this.port.postMessage({type:'fm-click-diag-ready'});
      } else {
        const trace = this.__clickTrace?.subarray(0,this.__clickTraceN) ?? new Float64Array(0);
        this.port.postMessage({type:'fm-click-diag-result',trace,stats:this.__clickStats,performanceStats:this.performanceQueue.getStats()},[trace.buffer]);
        this.__clickTrace = null; this.__clickStats = null;
      }
      return;
    }
    this.__clickRecord(command,commandFrame);
`;
const traceRecord = `
YM2612Processor.prototype.__clickRecord = function(command,appliedFrame) {
    if (this.__clickTrace && this.__clickTraceN + 7 <= this.__clickTrace.length) {
      let code = 0, value = 0, port = 0;
      if (command.type === 'write' && (command.register === 0x28 || (command.register >= 0xa0 && command.register <= 0xa6))) {
        code = command.register; value = command.value; port = command.port;
      } else if (command.type === 'audition-note-on' || command.type === 'audition-note-off') {
        code = command.type === 'audition-note-on' ? 1000 : 1001; value = command.fnum ?? 0; port = command.channel;
      }
      if (code) { const n = this.__clickTraceN; this.__clickTrace[n] = appliedFrame;
        this.__clickTrace[n+1] = code; this.__clickTrace[n+2] = value; this.__clickTrace[n+3] = port;
        this.__clickTrace[n+4] = Date.now(); this.__clickTrace[n+5] = command._clickSentWall ?? 0;
        this.__clickTrace[n+6] = command._clickSentPerf ?? 0; this.__clickTraceN += 7; }
    }
};
`;
const traceProcess = `
function __clickNow() { return globalThis.performance?.now?.() ?? Date.now(); }
const __clickProcess = YM2612Processor.prototype.process;
YM2612Processor.prototype.process = function(inputs,outputs) {
  const stats = this.__clickStats;
  if (!stats) return __clickProcess.call(this,inputs,outputs);
  const start = __clickNow();
  if (stats.lastWall !== null) stats.maxWallGapMs = Math.max(stats.maxWallGapMs,start-stats.lastWall);
  stats.lastWall = start;
  try { return __clickProcess.call(this,inputs,outputs); }
  finally { const elapsed = __clickNow()-start; stats.calls++; stats.totalMs += elapsed; stats.maxMs = Math.max(stats.maxMs,elapsed); }
};
`;
const server = http.createServer(async (request,response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    let file = path.resolve(docs,'.' + pathname);
    if (!file.startsWith(docs + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file,'index.html');
    let body = await fs.readFile(file);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString() +
      '\nwindow.__fmClick={runtime,megaDrive,get editor(){return editorAdapter;}};');
    if (pathname.endsWith('/ym2612-worklet.js')) {
      const source = body.toString(),command = '  applyCommand(command, reply = message => this.port.postMessage(message), commandFrame = currentFrame, performance) {',register = 'registerProcessor("ym2612-processor", YM2612Processor);',
        scheduled = '        this.pcmDac.observeWrite(scheduled.port, scheduled.register, scheduled.value);';
      assert(source.includes(command) && source.includes(register) && source.includes(scheduled),'YM2612 diagnostic anchors changed');
      body = Buffer.from(source.replace(command,command + traceCommand)
        .replace(scheduled,'        this.__clickRecord(scheduled,currentFrame + eventOffset);\n' + scheduled)
        .replace(register,traceRecord + traceProcess + register));
    }
    if (pathname.endsWith('/playground_worker_chip.js')) {
      const source=body.toString(),start=' let enabled=false,batch=null;',single='else port.postMessage([command]);',batch='if(commands.length)port.postMessage(commands);';
      assert(source.includes(start)&&source.includes(single)&&source.includes(batch),'Worker chip send anchors changed');
      body=Buffer.from(source.replace(start,start+`
 const __clickSend=commands=>{const wall=Date.now(),perf=performance.now();
  for(const command of commands){command._clickSentWall=wall;command._clickSentPerf=perf;command._clickSource='worker';}port.postMessage(commands);};`)
        .replace(single,'else __clickSend([command]);').replace(batch,'if(commands.length)__clickSend(commands);'));
    }
    if (pathname.endsWith('/ym2612synth.js')) {
      const source=body.toString(),write='    this.node.port.postMessage({\n      type: "write",\n      port,';
      assert(source.includes(write),'Main WorkletTransport write anchor changed');
      body=Buffer.from(source.replace(write,'    this.node.port.postMessage({\n      type: "write",\n      _clickSentWall: Date.now(),\n      _clickSentPerf: performance.now(),\n      _clickSource: "main",\n      port,'));
    }
    response.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream'); response.end(body);
  } catch (error) {console.error('SERVE:',request.url,error.message);response.writeHead(404).end(String(error));}
});

const captureModule = `
class FMClickCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();this.capacity=Math.ceil(sampleRate*(options.processorOptions.seconds+3));
    this.channels=Array.from({length:4},()=>new Float32Array(this.capacity));
    this.active=false;this.frames=0;this.firstFrame=null;this.lastFrame=null;this.frameGaps=0;this.blocks=0;
    this.port.onmessage=({data})=>{
      if(data==='start'){this.active=true;this.port.postMessage({type:'ready'});return;}
      if(data!=='end')return;this.active=false;
      const channels=this.channels.map(channel=>channel.subarray(0,this.frames));
      this.port.postMessage({type:'result',channels,frames:this.frames,rate:sampleRate,firstFrame:this.firstFrame,frameGaps:this.frameGaps,blocks:this.blocks},channels.map(channel=>channel.buffer));
    };
  }
  process(inputs,outputs) {
    if(!this.active)return true;
    const n=Math.min(outputs[0][0].length,this.capacity-this.frames);
    if(this.firstFrame===null)this.firstFrame=currentFrame;
    if(this.lastFrame!==null&&this.lastFrame!==currentFrame)this.frameGaps++;
    this.lastFrame=currentFrame+n;this.blocks++;
    for(let input=0;input<2;input++)for(let ch=0;ch<2;ch++){
      const source=inputs[input]?.[ch]??inputs[input]?.[0];
      if(source){
        if(source.length===n)this.channels[input*2+ch].set(source,this.frames);
        else for(let i=0;i<n;i++)this.channels[input*2+ch][this.frames+i]=source[i];
      }
    }
    this.frames+=n;return true;
  }
}
registerProcessor('fm-click-capture',FMClickCapture);`;

const distortion = `liveFx('distortion',{context:{gain:60,drive:.03},process(input,output,state,context){
  for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=Math.tanh(input[ch][i]*context.gain)*context.drive;
}});`;
const sourceFor = test => `setBpm(120);fm.setPreset(CH1,FM_PRESETS['one-op-basic']);\n${test.fx ? distortion : ''}\n${test.kind === 'script' ?
  "let n=0;liveLoop('lead',async()=>{const notes=scale('E4','minorPentatonic',2);await play(notes[n++%notes.length],{channel:CH1,duration:.08});await beat(cycle([.04,.04,.08]));});" : ''}`;

function analyze(data,trace,test) {
  const [raw,,final] = data.channels,begin = Math.round(data.rate * .3),end = raw.length - 128;
  const transitions = [];
  for (let i = 0; i < trace.length; i += 7) transitions.push({frame:trace[i],code:trace[i+1],value:trace[i+2],port:trace[i+3],
    appliedWall:trace[i+4],sentWall:trace[i+5]||null,sentPerf:trace[i+6]||null,
    queueDelayMs:trace[i+5]?trace[i+4]-trace[i+5]:null});
  const frames = [...new Set(transitions.map(event => event.frame - data.firstFrame))].sort((a,b) => a-b);
  const nearest = sample => {
    let lo=0,hi=frames.length;while(lo<hi){const mid=(lo+hi)>>1;if(frames[mid]<sample)lo=mid+1;else hi=mid;}
    return Math.min(Math.abs(sample-(frames[lo]??Infinity)),Math.abs(sample-(frames[lo-1]??Infinity)));
  };
  const metrics = channel => {
    let energy=0,peak=0,maxDelta=0,nonFinite=0,zeroRun=0,maxZeroRun=0,silentQuanta=0,boundaryEnergy=0,interiorEnergy=0,boundaryN=0,interiorN=0;
    const largest=[];
    for(let i=begin;i<end;i++){
      const value=channel[i],delta=Math.abs(value-channel[i-1]);
      if(!Number.isFinite(value)){nonFinite++;continue;}energy+=value*value;peak=Math.max(peak,Math.abs(value));maxDelta=Math.max(maxDelta,delta);
      zeroRun=value===0?zeroRun+1:0;maxZeroRun=Math.max(maxZeroRun,zeroRun);
      if(i%128===0){boundaryEnergy+=delta*delta;boundaryN++;}else{interiorEnergy+=delta*delta;interiorN++;}
      if(largest.length<20||delta>largest.at(-1).delta){largest.push({sample:i,seconds:i/data.rate,delta,eventDistanceFrames:nearest(i),blockOffset:i%128});largest.sort((a,b)=>b.delta-a.delta);largest.length=Math.min(20,largest.length);}
    }
    for(let start=Math.ceil(begin/128)*128;start+128<end;start+=128){let zero=true;for(let i=start;i<start+128;i++)if(channel[i]!==0){zero=false;break;}if(zero)silentQuanta++;}
    return {peak,rms:Math.sqrt(energy/Math.max(1,end-begin)),maxDelta,nonFinite,maxZeroRun,silentQuanta,
      blockBoundaryDeltaRms:Math.sqrt(boundaryEnergy/Math.max(1,boundaryN)),interiorDeltaRms:Math.sqrt(interiorEnergy/Math.max(1,interiorN)),largest};
  };
  const r=metrics(raw),f=metrics(final);
  // No native FX are active. Fit the expected stateless liveFx transform and
  // master gain to identify extra discontinuities introduced after the chip.
  let xy=0,xx=0;
  for(let i=begin;i<end;i++){const x=test.fx?Math.tanh(raw[i]*60)*.03:raw[i];xy+=x*final[i];xx+=x*x;}
  const gain=xy/Math.max(xx,1e-30);let errorEnergy=0,maxError=0;
  for(let i=begin;i<end;i++){const expected=(test.fx?Math.tanh(raw[i]*60)*.03:raw[i])*gain,e=final[i]-expected;errorEnergy+=e*e;maxError=Math.max(maxError,Math.abs(e));}
  const keys=transitions.filter(event=>event.code===0x28||event.code===1000||event.code===1001),noteTiming=[];
  for(let i=1;i<keys.length;i++){
    const a=keys[i-1],b=keys[i],on=a.code===1000||(a.code===0x28&&(a.value&0xf0)!==0);
    noteTiming.push({kind:on?'hold':'rest',startFrame:a.frame,endFrame:b.frame,appliedDurationMs:(b.frame-a.frame)*1000/data.rate,
      sentDurationMs:a.sentWall&&b.sentWall?b.sentWall-a.sentWall:null,
      sentPerformanceDurationMs:a.sentPerf&&b.sentPerf?b.sentPerf-a.sentPerf:null,
      startQueueMs:a.queueDelayMs,endQueueMs:b.queueDelayMs,startSentWall:a.sentWall,endSentWall:b.sentWall,
      startAppliedWall:a.appliedWall,endAppliedWall:b.appliedWall});
  }
  return {sampleRate:data.rate,frames:data.frames,audioSeconds:data.frames/data.rate,firstFrame:data.firstFrame,
    captureFrameGaps:data.frameGaps,blocks:data.blocks,raw:r,final:f,postFXFit:{gain,rmsError:Math.sqrt(errorEnergy/Math.max(1,end-begin)),maxError},
    noteAndPitchEvents:transitions.length,noteTiming,events:transitions};
}

async function checkCase(browser,name,test,url) {
  const page = await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'}),errors=[];
  page.on('pageerror',error => errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error')console.error('PAGE:',msg.text());});page.setDefaultTimeout(15000);
  try {
    await page.goto(url);await page.waitForFunction(() => window.__fmClick?.editor.kind === 'monaco');
    await page.evaluate(() => {document.getElementById('workerExecution').checked=false;window.__fmClick.editor.setValue('// initialize audio only');});
    await page.click('#runButton');await page.waitForFunction(() => !document.getElementById('runButton').disabled);
    if(!await page.evaluate(()=>Boolean(window.__fmClick.megaDrive.node))) throw Error('Audio init failed: '+await page.locator('body').innerText());
    const source=sourceFor(test);
    await page.evaluate(async ({captureModule,seconds,source}) => {
      const p=window.__fmClick,c=p.megaDrive.audioContext;
      const u=URL.createObjectURL(new Blob([captureModule],{type:'text/javascript'}));
      try{await c.audioWorklet.addModule(u);}finally{URL.revokeObjectURL(u);}
      p.tap=new AudioWorkletNode(c,'fm-click-capture',{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',processorOptions:{seconds}});
      p.bridge=c.createGain();p.bridge.connect(p.tap,0,1);p.detach=p.megaDrive.audio.connectOutputMonitor(p.bridge);
      p.megaDrive.node.connect(p.tap,0,0);p.tap.connect(c.destination);
      p.traceReady=new Promise(resolve=>{const listener=({data})=>{if(data.type!=='fm-click-diag-ready')return;p.megaDrive.node.port.removeEventListener('message',listener);resolve();};p.megaDrive.node.port.addEventListener('message',listener);});
      p.traceResult=new Promise(resolve=>{const listener=({data})=>{if(data.type!=='fm-click-diag-result')return;p.megaDrive.node.port.removeEventListener('message',listener);resolve(data);};p.megaDrive.node.port.addEventListener('message',listener);});
      p.tapReady=new Promise(resolve=>{p.tap.port.onmessage=({data})=>{if(data.type==='ready')resolve();};});
      p.tapResult=new Promise(resolve=>{p.tap.port.addEventListener('message',({data})=>{if(data.type==='result')resolve(data);});});
      p.ui=[],p.longtasks=[];
      if(typeof PerformanceObserver==='function'&&PerformanceObserver.supportedEntryTypes?.includes('longtask')){
        p.observer=new PerformanceObserver(list=>p.longtasks.push(...list.getEntries().map(entry=>({startTime:entry.startTime,duration:entry.duration}))));p.observer.observe({entryTypes:['longtask']});
      }
      p.editor.setValue(source);p.megaDrive.node.port.postMessage({type:'fm-click-diag',action:'start'});p.tap.port.postMessage('start');
      await Promise.all([p.traceReady,p.tapReady]);
    },{captureModule,seconds,source});
    await page.evaluate(async ({source,test,lead}) => {window.__fmClick.runtime.setTiming({workerLookaheadSeconds:lead / 1000});await window.__fmClick.runtime.playSource(source,{execution:test.execution});},{source,test,lead:lookaheadMs});
    let keyboardKey;
    if(test.kind.startsWith('keyboard')){
      await page.click('#operatorTabButton');
      await page.locator('#operatorKeyboardRoot button').filter({hasText:'Ukulele'}).click();
      keyboardKey=await page.evaluate(()=>[...document.querySelectorAll('#operatorKeyboardRoot .key')]
        .find(button=>button.querySelector('span')?.textContent==='A4')?.dataset.key);
      assert(keyboardKey,'Ukulele layout must expose a physical A4 keyboard mapping');
      if(test.kind==='keyboard-held')await page.keyboard.down(keyboardKey);
    }
    if(test.ui)await page.evaluate(({source,stallMs}) => {
      const p=window.__fmClick;let tick=0;
      p.timer=setInterval(()=>{const start=performance.now(),wallStartEpoch=Date.now(),audio=p.megaDrive.audioContext.currentTime;
        const menu=document.getElementById('mainMenu');menu.open=!menu.open;
        p.editor.setValue(source+'\n'+Array.from({length:300},(_,i)=>'// editor workload '+tick+' '+i).join('\n'));
        const until=performance.now()+stallMs;while(performance.now()<until){};
        p.ui.push({wallStart:start,wallStartEpoch,wallEndEpoch:Date.now(),duration:performance.now()-start,
          audioBefore:audio,audioAfter:p.megaDrive.audioContext.currentTime});tick++;
      },400);
    },{source,stallMs});
    const started=Date.now();
    if(test.kind==='keyboard-retrigger'){
      while(Date.now()-started<seconds*1000){await page.keyboard.down(keyboardKey);await page.waitForTimeout(80);await page.keyboard.up(keyboardKey);await page.waitForTimeout(20);}
    }else await page.waitForTimeout(seconds*1000);
    const captured=await page.evaluate(async () => {
      const p=window.__fmClick;clearInterval(p.timer);p.observer?.disconnect();
      p.tap.port.postMessage('end');p.megaDrive.node.port.postMessage({type:'fm-click-diag',action:'end'});
      const [capture,trace]=await Promise.all([p.tapResult,p.traceResult]);
      // Transport raw bytes out of the page without expanding typed arrays into
      // hundreds of thousands of object properties.
      const encode=values=>{const bytes=new Uint8Array(values.buffer,values.byteOffset,values.byteLength);let out='';for(let n=0;n<bytes.length;n+=16384)out+=String.fromCharCode(...bytes.subarray(n,n+16384));return btoa(out);};
      return {...capture,channels:capture.channels.map(encode),trace:{...trace,trace:Array.from(trace.trace)},ui:p.ui,longtasks:p.longtasks,
        volume:{master:p.megaDrive.audio.masterVolume,listening:p.megaDrive.audio.listeningVolume}};
    });
    const data={...captured,channels:captured.channels.map(value=>{const bytes=Buffer.from(value,'base64');return new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);})};
    const result={browser:name,test,lookaheadMs,...analyze(data,captured.trace.trace,test),processStats:captured.trace.stats,performanceStats:captured.trace.performanceStats,ui:captured.ui,longtasks:captured.longtasks,volume:captured.volume,errors};
    assert.equal(result.raw.nonFinite+result.final.nonFinite,0,'PCM must remain finite');
    assert(result.raw.peak>.0001&&result.final.peak>.00001,'the diagnostic must capture real sound');
    assert.equal(result.captureFrameGaps,0,'capture processor must see a continuous audio frame clock');
    assert.deepEqual(errors,[]);
    if(test.execution==='worker' && lookaheadMs>=150) {
      const holds=result.noteTiming.filter(e=>e.kind==='hold');
      const rests=result.noteTiming.filter(e=>e.kind==='rest');
      assert(holds.length>5 && rests.length>5);
      assert(rests.every(e=>e.appliedDurationMs>0), 'lookahead must preserve every rest');
    }
    const suffix=lookaheadMs>0?`-lookahead${lookaheadMs}`:'';
    await fs.writeFile(path.join(artifacts,`playground-fm-click-${name}-${test.name}${suffix}.json`),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
    if(test.kind==='keyboard-held')await page.keyboard.up(keyboardKey);
    await page.evaluate(()=>{const p=window.__fmClick;p.runtime.stop();p.detach();p.megaDrive.node.disconnect(p.tap);p.bridge.disconnect();p.tap.disconnect();p.tap.port.close();});
    return result;
  }finally{await page.close();}
}

(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{
    const selected=process.argv.includes('--chromium')?[['chromium',chromium]]:process.argv.includes('--webkit')?[['webkit',webkit]]:[['chromium',chromium],['webkit',webkit]];
    const cases=[
      {name:'main-dry-idle',kind:'script',execution:'main',fx:false,ui:false},
      {name:'main-distortion-idle',kind:'script',execution:'main',fx:true,ui:false},
      {name:'main-distortion-ui',kind:'script',execution:'main',fx:true,ui:true},
      {name:'worker-distortion-idle',kind:'script',execution:'worker',fx:true,ui:false},
      {name:'worker-distortion-ui',kind:'script',execution:'worker',fx:true,ui:true},
      {name:'keyboard-held-dry-idle',kind:'keyboard-held',execution:'main',fx:false,ui:false},
      {name:'keyboard-held-dry-ui',kind:'keyboard-held',execution:'main',fx:false,ui:true},
      {name:'keyboard-held-distortion-ui',kind:'keyboard-held',execution:'main',fx:true,ui:true},
      {name:'keyboard-retrigger-distortion-ui',kind:'keyboard-retrigger',execution:'main',fx:true,ui:true},
    ].filter(test=>!argument('--case','')||test.name===argument('--case',''));
    assert(cases.length,'Unknown --case name');
    for(const [name,type]of selected){
      const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
      try{for(const test of cases)await checkCase(browser,name,test,`http://127.0.0.1:${server.address().port}/playground/index.html`);}
      finally{await browser.close();}
    }
    console.log(JSON.stringify({passed:true,seconds,stallMs,lookaheadMs,artifacts,limitation:'Valid captured PCM cannot rule out OS audio-device underruns; coarse worklet wall timing is diagnostic only, not a deadline guarantee. Lookahead uses the production Worker transport and adds the configured latency.'}));
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
