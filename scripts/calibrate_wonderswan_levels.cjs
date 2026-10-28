// Actual Playground Main/Worker -> shipped WonderSwan WASM and AudioWorklet.
// Independent pilot PCM observes capture order; clock anomalies stay diagnostic.
// Every destination is permanently gated to zero. This is not a listening test.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const {PROCESSOR_NAMES,processorSource,analyzePilotPcm,analyzeClockRows}=require('./audio_clock_audit.cjs');
const root=path.resolve(__dirname,'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const option=name=>{const prefix=name+'=';const at=process.argv.indexOf(name);return process.argv.find(value=>value.startsWith(prefix))?.slice(prefix.length)??(at<0?undefined:process.argv[at+1]);};
const options={out:path.resolve(option('--out')??'/private/tmp/wonderswan-calibration.json'),
  root:path.resolve(option('--root')??path.join(root,'docs')),
  engines:(option('--engines')??'chromium,webkit').split(','),
  rates:(option('--sample-rates')??'44100,48000').split(',').map(Number),
  executions:(option('--executions')??'main,worker').split(','),
  roles:(option('--roles')??'primary,extra').split(','),
  frequencies:(option('--frequencies')??'220,440,880').split(',').map(Number),
  verify:process.argv.includes('--verify'),baseline:option('--baseline')};
const historicalPath=path.join(root,'docs/issues/playground_chip_levels_01.json');
const generatedPolicyAssets=new Set(['playground/playground_mixer_defaults.js','js/soundchip_mixer_presets.js']);
const accessor='\nwindow.__wonderswanCalibration={runtime,selectedMode};\n';

// Mute independently of Playground settings, including any newly made context.
function instrument(requestedSampleRate){
  const state=window.__wonderswanCalibrationCapture={contexts:[],sinks:new Map(),processorErrors:[]};
  const Context=window.AudioContext,Worklet=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect,disconnect=AudioNode.prototype.disconnect;state.connect=connect;
  window.AudioContext=class extends Context{constructor(options={}){super({...options,sampleRate:requestedSampleRate});state.contexts.push(this);}};
  if(window.webkitAudioContext===Context)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(...args){super(...args);this.addEventListener('processorerror',()=>state.processorErrors.push(args[1]));}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination===this.context.destination){let sink=state.sinks.get(this.context);
      if(!sink){const gate=this.context.createGain();gate.gain.value=0;connect.call(gate,destination);sink={gate};state.sinks.set(this.context,sink);}
      connect.call(this,sink.gate,...args);return destination;
    }return connect.call(this,destination,...args);
  };
  AudioNode.prototype.disconnect=function(...args){if(args[0]===this.context.destination&&state.sinks.has(this.context))args[0]=state.sinks.get(this.context).gate;return disconnect.apply(this,args);};
}

// Worker commands are intentionally queued ahead. Wait beyond their scheduling
// horizon so the measured second contains a held tone, not its initial silence.
async function capture(page,{seconds=1,warmup=1}={}){
  const result=await page.evaluate(async({seconds,warmup,names})=>{
    const audio=window.__wonderswanCalibration.runtime.megaDrive.audio,context=audio.audioContext;
    const audit=window.__wonderswanCalibrationCapture,sink=audit.sinks.get(context);
    if(!sink)throw Error('No permanently muted audio destination');
    if(!sink.capture){
      await context.audioWorklet.addModule('/__wonderswan_calibration_capture.js');
      const node=new AudioWorkletNode(context,names.capture,{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{pilotInput:1}});
      const pilot=new AudioWorkletNode(context,names.pilot,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});
      audit.connect.call(pilot,node,0,1);audit.connect.call(node,sink.gate);
      sink.capture=node;sink.pilot=pilot;sink.sequence=0;
      node.port.onmessage=({data})=>{if(sink.pending?.id===data.id){const pending=sink.pending;sink.pending=null;clearTimeout(pending.timer);pending.resolve(data);}};
    }
    // FX rebuilds may disconnect masterInputNode; reconnect this observer for
    // each measurement and detach afterward. Its output is always silence.
    const node=sink.capture;audit.connect.call(audio.masterInputNode,node);
    const warmupFrames=Math.ceil(context.sampleRate*warmup/128)*128;
    const measuredFrames=Math.ceil(context.sampleRate*seconds/128)*128;
    let data;
    try{data=await new Promise((resolve,reject)=>{if(sink.pending)throw Error('Concurrent calibration capture');const id=++sink.sequence;
      const timer=setTimeout(()=>{sink.pending=null;reject(Error('Calibration PCM capture timed out'));},15000);
      sink.pending={id,resolve,timer};node.port.postMessage({id,frames:warmupFrames+measuredFrames});});
    }finally{audio.masterInputNode.disconnect(node);}
    const pilot=window.__wonderswanCalibrationAnalysis.pilot(data.pilot,{expectedFrames:warmupFrames+measuredFrames,pilotInputFrames:data.pilotInputFrames});
    const clock=window.__wonderswanCalibrationAnalysis.clock(data.rows);
    const channels=[];
    for(const values of [data.left,data.right]){
      const pcm=values.subarray(warmupFrames);let minimum=Infinity,maximum=-Infinity,sum=0,square=0,nonfinite=0,nonzero=0,overrange=0;
      for(const value of pcm){if(!Number.isFinite(value)){nonfinite++;continue;}minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);sum+=value;square+=value*value;if(value!==0)nonzero++;if(Math.abs(value)>1)overrange++;}
      const dc=sum/pcm.length,rms=Math.sqrt(square/pcm.length),crossings=[];
      for(let i=1;i<pcm.length;i++)if(pcm[i-1]<dc&&pcm[i]>=dc)crossings.push(i-1+(dc-pcm[i-1])/(pcm[i]-pcm[i-1]));
      const digest=await crypto.subtle.digest('SHA-256',pcm.buffer.slice(pcm.byteOffset,pcm.byteOffset+pcm.byteLength));
      channels.push({minimum,maximum,halfPeakToPeak:(maximum-minimum)/2,peak:Math.max(Math.abs(minimum),Math.abs(maximum)),dc,rms,acRms:Math.sqrt(Math.max(0,rms*rms-dc*dc)),nonfinite,nonzero,overrange,
        estimatedFrequencyHz:crossings.length>2?(crossings.length-1)*context.sampleRate/(crossings.at(-1)-crossings[0]):0,
        sha256:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')});
    }
    if([...audit.sinks.values()].some(({gate})=>gate.gain.value!==0))throw Error('Physical output gate changed');
    return {sampleRate:context.sampleRate,frames:measuredFrames,warmupFrames,capturedFrames:data.left.length,inputFrames:data.inputFrames,pilot,clock,channels,
      tap:'audio.masterInputNode (after source Mixer, before FX/master/listening)',physicalOutputMuted:true,processorErrors:[...audit.processorErrors]};
  },{seconds,warmup,names:PROCESSOR_NAMES});
  assert.equal(result.pilot.continuous,true,'Independent pilot PCM must be continuous');
  assert.equal(result.clock.measurementValid,true,'Complete observer callback sequence');
  assert.equal(result.clock.frames,result.capturedFrames,'Each capture quantum accounted for');
  assert.equal(result.inputFrames,result.capturedFrames,'Actual mix input present for every captured sample');
  assert.deepEqual(result.processorErrors,[],'No AudioWorklet processor errors');
  assert(result.channels.every(channel=>channel.nonfinite===0),'Finite stereo PCM');
  return result;
}

async function main(){
  for(const [values,allowed,label]of [[options.engines,['chromium','webkit'],'engines'],[options.rates,[44100,48000],'sample rates'],[options.executions,['main','worker'],'executions'],[options.roles,['primary','extra'],'roles'],[options.frequencies,[220,440,880],'frequencies']])assert(values.length&&new Set(values).size===values.length&&values.every(value=>allowed.includes(value)),'Invalid '+label);
  const referencePath=path.join(__dirname,'soundchip_calibration_wonderswan.mjs'),fmPath=path.join(__dirname,'soundchip_calibration_fm.mjs'),helperPath=require.resolve('./audio_clock_audit.cjs');
  const files=[__filename,referencePath,fmPath,helperPath,historicalPath],initialHashes=Object.fromEntries(await Promise.all(files.map(async file=>[path.relative(root,file),sha(await fs.readFile(file))])));
  const historical=JSON.parse(await fs.readFile(historicalPath,'utf8'));
  assert.equal(historical.rows.length,153,'Immutable complete historical baseline');assert.equal(historical.calibration.targetAmplitude,0.12881777435541153,'Unchanged common target');
  const baseline=options.baseline?JSON.parse(await fs.readFile(path.resolve(options.baseline),'utf8')):null;
  if(options.verify)assert(baseline?.passed&&baseline.verify===false&&baseline.calibration?.targetAmplitude===historical.calibration.targetAmplitude,'Verification requires a successful WonderSwan baseline');
  const {buildWonderSwanCalibrationReference}=await import('./soundchip_calibration_wonderswan.mjs');
  const {buildFmCalibrationReference}=await import('./soundchip_calibration_fm.mjs');
  const served=new Map(),report={schemaVersion:1,passed:false,verify:options.verify,gainUnits:'source',referenceFrequencyHz:440,engines:options.engines,sampleRates:options.rates,executions:options.executions,roles:options.roles,frequencies:options.frequencies,rows:[],anchors:[],
    baseline:{path:path.relative(root,historicalPath),sha256:initialHashes[path.relative(root,historicalPath)],rows:historical.rows.length,referenceAmplitude:historical.calibration.referenceAmplitude,targetAmplitude:historical.calibration.targetAmplitude},
    scripts:initialHashes,physicalOutputMuted:true,listeningPerformed:false,continuityOracle:'independent-24-bit-pilot-PCM',
    limits:['A dedicated single held reference voice measures digital output units, not subjective loudness, polyphony, or analogue console output.',
      'The independent pilot proves capture-input sample order only; it does not prove every primary WonderSwan core frame or a physical audio deadline.',
      'CurrentFrame anomalies are retained as diagnostics and do not alone invalidate continuous pilot PCM.',
      'Browser engines use the actual shipped WASM/AudioWorklets; no Native audio device is opened. Native parity is tested separately.',
      'The raw WonderSwan headphone DAC is unipolar. Capture observes its existing speaker-centering boundary; raw core DC is not normalized into gain.',
      'The target and 153 historical measurements are immutable; only WonderSwan gains may be derived from this extension.']};
  const save=async()=>{await fs.mkdir(path.dirname(options.out),{recursive:true});await fs.writeFile(options.out,JSON.stringify(report,null,2)+'\n');};
  const server=http.createServer(async(request,response)=>{
    try{
      const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
      if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
      if(pathname==='/__wonderswan_calibration_capture.js'){response.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(processorSource);return;}
      let file=path.resolve(options.root,'.'+pathname);assert(file===options.root||file.startsWith(options.root+path.sep),'Outside host');if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
      let bytes=await fs.readFile(file);const name=path.relative(options.root,file),hash=sha(bytes);if(served.has(name))assert.equal(served.get(name).sha256,hash,'Served source changed: '+name);served.set(name,{bytes:bytes.length,sha256:hash});
      if(pathname.endsWith('/playground.js'))bytes=Buffer.from(bytes.toString()+accessor);
      const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'};
      response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
    }catch(error){response.writeHead(404).end(error.message);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{
    for(const engine of options.engines){
      const browser=await ({chromium,webkit})[engine].launch({headless:true,...(engine==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{})});
      try{for(const requestedSampleRate of options.rates)for(const execution of options.executions)for(const kind of ['ym2612','wonderswan'])for(const role of kind==='ym2612'?['primary']:options.roles){
        const context=await browser.newContext({serviceWorkers:'block'});await context.addInitScript(instrument,requestedSampleRate);
        await context.addInitScript(`window.__wonderswanCalibrationAnalysis={pilot:${analyzePilotPcm.toString()},clock:${analyzeClockRows.toString()}};`);
        const page=await context.newPage(),errors=[],badResponses=[];page.setDefaultTimeout(30000);
        page.on('pageerror',error=>errors.push(String(error)));page.on('response',response=>{if(response.status()>=400)badResponses.push({url:response.url(),status:response.status()});});
        await page.route('**/vs/loader*.js',route=>route.abort());
        const mode=kind==='wonderswan'&&role==='primary'?'wonderswan':'genesis';
        try{
          await page.goto(`http://127.0.0.1:${server.address().port}/playground/index.html?mode=${mode}`);
          await page.waitForFunction(()=>Boolean(window.__wonderswanCalibration));await page.locator('#startupNotice').waitFor({state:'hidden'});
          for(const frequencyHz of kind==='ym2612'?[440]:options.frequencies){
            let reference=kind==='wonderswan'?buildWonderSwanCalibrationReference(frequencyHz,{role}):buildFmCalibrationReference('ym2612',frequencyHz);
            if(kind==='ym2612')reference={...reference,sourceId:'ym2612',setup:reference.setup.replace(/createSoundChip\(\s*(['"])ym2612\1\s*,\s*\{id:\s*'calibration-source'\}\s*\)/,"useSoundChip('ym2612')")};
            const volume=options.verify&&kind==='wonderswan'?'':',volume:1';
            const source=reference.setup+`\nawait mixer.set(${JSON.stringify(reference.sourceId)},{pan:0,muted:false,solo:true${volume}});\nlog('WONDERSWAN_CALIBRATION_READY');`;
            await page.evaluate(async({source,execution})=>{await window.__wonderswanCalibration.runtime.playSource(source,{execution});window.__wonderswanCalibration.runtime.megaDrive.audio.setListeningVolume(0);},{source,execution});
            await page.waitForFunction(()=>document.querySelector('#consoleOutput')?.textContent.includes('WONDERSWAN_CALIBRATION_READY'));
            const mixer=await page.evaluate(sourceId=>{const synth=window.__wonderswanCalibration.runtime.megaDrive;return {id:sourceId,entry:synth.mixer.list().find(entry=>entry.id===sourceId),settings:synth.mixer.get(sourceId)};},reference.sourceId);
            assert(mixer.entry?.connected,'Actual connected calibration source');assert.equal(mixer.settings.pan,0);assert.equal(mixer.settings.muted,false);assert.equal(mixer.settings.solo,true);if(!options.verify||kind==='ym2612')assert.equal(mixer.settings.volume,1);
            const pcm=await capture(page),measuredAmplitude=Math.max(...pcm.channels.map(channel=>channel.halfPeakToPeak));
            assert.equal(pcm.sampleRate,requestedSampleRate,'Requested host output rate actually used');
            const referencePeak=reference.decodedReference?.codecHeadroom??1,amplitude=measuredAmplitude/referencePeak;
            assert(amplitude>1e-5,'Nonzero alternating reference');assert(pcm.channels.every(channel=>channel.overrange===0),'Unclipped reference');
            const expectedFrequencyHz=reference.effectiveFrequencyHz??frequencyHz;
            assert(pcm.channels.every(channel=>Math.abs(channel.estimatedFrequencyHz-expectedFrequencyHz)<Math.max(2,expectedFrequencyHz*.015)),'Reference pitch: '+JSON.stringify(pcm.channels));
            if(kind==='wonderswan'){
              assert.equal(referencePeak,1,'Full-range WonderSwan wave requires no codec headroom correction');
              const referenceRms=reference.decodedReference.decodedRms;
              assert(Number.isFinite(referenceRms)&&referenceRms>0&&referenceRms<1,'Explicit centered reference RMS');
              assert(pcm.channels.every(channel=>channel.nonzero>pcm.frames*.9&&Math.abs(channel.dc)<channel.peak*.01&&Math.abs(channel.acRms/channel.halfPeakToPeak/referenceRms-1)<.03),'WonderSwan held reference must be speaker-centered and settled before capture, including Worker scheduling');
            }
            const row={engine,browserVersion:browser.version(),requestedSampleRate,actualSampleRate:pcm.sampleRate,execution,role,mode,kind,frequencyHz,expectedFrequencyHz,sourceId:reference.sourceId,sourceSha256:sha(source),waveform:reference.waveform??'sine',referencePeak,decodedReference:reference.decodedReference??null,noteInfo:reference.noteInfo,limitations:reference.limitations,mixer,pcm,measuredAmplitude,amplitude};
            if(options.verify&&kind==='wonderswan'){
              const original=baseline.rows.find(candidate=>candidate.kind==='wonderswan'&&candidate.engine===engine&&candidate.requestedSampleRate===requestedSampleRate&&candidate.execution===execution&&candidate.role===role&&candidate.frequencyHz===frequencyHz);
              assert(original,'Matching uncalibrated WonderSwan route');const expectedGain=baseline.calibration.routes.find(candidate=>candidate.kind==='wonderswan'&&candidate.role===role)?.volume;assert(Number.isFinite(expectedGain)&&expectedGain>0,'Explicit derived WonderSwan policy');
              assert.equal(mixer.settings.volume,expectedGain,'Generated default WonderSwan gain');
              row.expectedAmplitude=original.amplitude*expectedGain;row.relativeError=Math.abs(amplitude/row.expectedAmplitude-1);assert(row.relativeError<.025,'WonderSwan generated gain output within2.5%');
              row.channelRmsRelativeErrors=pcm.channels.map((channel,index)=>Math.abs(channel.acRms/(original.pcm.channels[index].acRms*expectedGain)-1));
              assert(row.channelRmsRelativeErrors.every(error=>error<.025),'WonderSwan generated gain RMS output within2.5%');
            }
            await page.evaluate(()=>window.__wonderswanCalibration.runtime.stopWithFade());row.stopped=await capture(page,{seconds:.15,warmup:.25});
            assert(row.stopped.channels.every(channel=>channel.nonzero===0),'Exact zero after Stop');
            assert.deepEqual(errors,[],'No Browser exceptions');assert.deepEqual(badResponses,[],'No missing runtime assets');
            (kind==='wonderswan'?report.rows:report.anchors).push(row);await save();
            console.log(`PASS ${engine}/${requestedSampleRate}/${execution}/${role}/${kind}/${frequencyHz}: halfP2P=${measuredAmplitude}; normalized=${amplitude}; clock=${pcm.clock.continuous?'continuous':'diagnostic anomaly retained'}`);
          }
        }finally{await page.evaluate(()=>window.__wonderswanCalibration?.runtime.finalize()).catch(()=>{});await context.close();}
      }}finally{await browser.close();}
    }
    const completeCoverage=report.rows.length===48&&report.anchors.length===8&&options.engines.length===2&&options.rates.length===2&&options.executions.length===2&&options.roles.length===2&&options.frequencies.length===3;
    const routeGains=options.roles.map(role=>{
      const candidates=report.rows.filter(row=>row.role===role&&row.frequencyHz===440),reference=candidates.find(row=>row.engine==='chromium'&&row.requestedSampleRate===48000&&row.execution==='main')??candidates[0];assert(reference,'440Hz WonderSwan measurement required to derive gain');
      const volume=Number((historical.calibration.targetAmplitude/reference.amplitude).toFixed(6));assert(volume>0&&volume<=2,'WonderSwan gain exceeds Mixer range; do not clamp the shared target');
      return {kind:'wonderswan',role,mode:role==='primary'?'wonderswan':'genesis',name:reference.sourceId,amplitude:reference.amplitude,volume,reference:{engine:reference.engine,sampleRate:reference.actualSampleRate,execution:reference.execution,frequencyHz:440}};
    });
    report.completeCoverage=completeCoverage;report.calibration=options.verify?baseline.calibration:{referenceAmplitude:historical.calibration.referenceAmplitude,targetAmplitude:historical.calibration.targetAmplitude,maxGain:2,targetChanged:false,routes:routeGains};
    report.pcmContinuous=[...report.rows,...report.anchors].every(row=>row.pcm.pilot.continuous&&row.stopped.pilot.continuous);
    report.clockAnomalies=[...report.rows,...report.anchors].flatMap(row=>['pcm','stopped'].filter(label=>!row[label].clock.continuous).map(label=>({engine:row.engine,sampleRate:row.actualSampleRate,execution:row.execution,role:row.role,kind:row.kind,frequencyHz:row.frequencyHz,capture:label,clock:row[label].clock})));
    for(const [name,record]of served)assert.equal(sha(await fs.readFile(path.join(options.root,name))),record.sha256,'Frozen served source: '+name);
    for(const [file,hash]of Object.entries(initialHashes))assert.equal(sha(await fs.readFile(path.join(root,file))),hash,'Frozen script/baseline: '+file);
    // Generated policy assets depend on this calibration extension: exclude
    // their hashes to avoid a report -> policy -> report dependency cycle.
    report.sourceHashExclusions=[...generatedPolicyAssets];
    report.sources=Object.fromEntries([...served].filter(([name])=>!generatedPolicyAssets.has(name)).sort(([a],[b])=>a.localeCompare(b)));report.passed=true;await save();
    console.log(`PASS WonderSwan ${options.verify?'policy verification':'unit calibration'}: ${report.rows.length} WonderSwan +${report.anchors.length} YM2612 captures; completeCoverage=${completeCoverage}; ${options.out}`);
  }catch(error){report.error=String(error.stack??error);await save();throw error;}
  finally{await new Promise(resolve=>server.close(resolve));}
}
if(process.argv.includes('--help'))console.log('node scripts/calibrate_wonderswan_levels.cjs [--out REPORT] [--engines chromium,webkit] [--sample-rates 44100,48000] [--executions main,worker] [--roles primary,extra] [--frequencies 220,440,880] [--verify --baseline REPORT]');
else main().catch(error=>{console.error(error);process.exitCode=1;});
