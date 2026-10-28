// Actual Playground Main/Worker -> shipped POKEY WASM and AudioWorklet.
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
const options={out:path.resolve(option('--out')??'/private/tmp/pokey-calibration.json'),
  root:path.resolve(option('--root')??path.join(root,'docs')),
  engines:(option('--engines')??'chromium,webkit').split(','),
  rates:(option('--sample-rates')??'44100,48000').split(',').map(Number),
  executions:(option('--executions')??'main,worker').split(','),
  roles:(option('--roles')??'primary,dual-first,dual-second,extra').split(','),
  frequencies:(option('--frequencies')??'220,440,880').split(',').map(Number),
  dualChecks:!process.argv.includes('--no-dual-checks'),
  verify:process.argv.includes('--verify'),baseline:option('--baseline')};
const historicalPath=path.join(root,'docs/issues/playground_chip_levels_01.json');
const generatedPolicyAssets=new Set(['playground/playground_mixer_defaults.js','js/soundchip_mixer_presets.js']);
const accessor='\nwindow.__pokeyCalibration={runtime,selectedMode};\n';
// Existing public listening policy. The square-to-square RMS target is
// explicitly independent of the immutable historical sine-amplitude target.
const PSG_LISTENING_GAIN=.35;

// Mute independently of Playground settings, including any newly made context.
function instrument(requestedSampleRate){
  const state=window.__pokeyCalibrationCapture={contexts:[],sinks:new Map(),processorErrors:[]};
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
    const audio=window.__pokeyCalibration.runtime.megaDrive.audio,context=audio.audioContext;
    const audit=window.__pokeyCalibrationCapture,sink=audit.sinks.get(context);
    if(!sink)throw Error('No permanently muted audio destination');
    if(!sink.capture){
      await context.audioWorklet.addModule('/__pokey_calibration_capture.js');
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
    const pilot=window.__pokeyCalibrationAnalysis.pilot(data.pilot,{expectedFrames:warmupFrames+measuredFrames,pilotInputFrames:data.pilotInputFrames});
    const clock=window.__pokeyCalibrationAnalysis.clock(data.rows);
    const channels=[];
    for(const values of [data.left,data.right]){
      const pcm=values.subarray(warmupFrames);let minimum=Infinity,maximum=-Infinity,sum=0,square=0,nonfinite=0,nonzero=0,overrange=0;
      for(const value of pcm){if(!Number.isFinite(value)){nonfinite++;continue;}minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);sum+=value;square+=value*value;if(value!==0)nonzero++;if(Math.abs(value)>1)overrange++;}
      const dc=sum/pcm.length,rms=Math.sqrt(square/pcm.length),crossings=[];
      const segmentAcRms=(start,end)=>{let sum=0,square=0;for(let index=start;index<end;index++){sum+=pcm[index];square+=pcm[index]*pcm[index];}return Math.sqrt(Math.max(0,square/(end-start)-(sum/(end-start))**2));};
      const half=Math.floor(pcm.length/2),firstHalfAcRms=segmentAcRms(0,half),secondHalfAcRms=segmentAcRms(half,pcm.length);
      for(let i=1;i<pcm.length;i++)if(pcm[i-1]<dc&&pcm[i]>=dc)crossings.push(i-1+(dc-pcm[i-1])/(pcm[i]-pcm[i-1]));
      const digest=await crypto.subtle.digest('SHA-256',pcm.buffer.slice(pcm.byteOffset,pcm.byteOffset+pcm.byteLength));
      channels.push({minimum,maximum,halfPeakToPeak:(maximum-minimum)/2,peak:Math.max(Math.abs(minimum),Math.abs(maximum)),dc,rms,acRms:Math.sqrt(Math.max(0,rms*rms-dc*dc)),firstHalfAcRms,secondHalfAcRms,nonfinite,nonzero,overrange,
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
  for(const [values,allowed,label]of [[options.engines,['chromium','webkit'],'engines'],[options.rates,[44100,48000],'sample rates'],[options.executions,['main','worker'],'executions'],[options.roles,['primary','dual-first','dual-second','extra'],'roles'],[options.frequencies,[220,440,880],'frequencies']])assert(values.length&&new Set(values).size===values.length&&values.every(value=>allowed.includes(value)),'Invalid '+label);
  const referencePath=path.join(__dirname,'soundchip_calibration_pokey.mjs'),fmPath=path.join(__dirname,'soundchip_calibration_fm.mjs'),helperPath=require.resolve('./audio_clock_audit.cjs');
  const files=[__filename,referencePath,fmPath,helperPath,historicalPath],initialHashes=Object.fromEntries(await Promise.all(files.map(async file=>[path.relative(root,file),sha(await fs.readFile(file))])));
  const historical=JSON.parse(await fs.readFile(historicalPath,'utf8'));
  assert.equal(historical.rows.length,153,'Immutable complete historical baseline');assert.equal(historical.calibration.targetAmplitude,0.12881777435541153,'Unchanged common target');
  const baseline=options.baseline?JSON.parse(await fs.readFile(path.resolve(options.baseline),'utf8')):null;
  if(options.verify)assert(baseline?.passed&&baseline.verify===false&&baseline.calibration?.targetAmplitude===historical.calibration.targetAmplitude,'Verification requires a successful POKEY baseline');
  const {buildPokeyCalibrationReference,buildPokeyPsgBalanceReference}=await import('./soundchip_calibration_pokey.mjs');
  const {buildFmCalibrationReference}=await import('./soundchip_calibration_fm.mjs');
  const served=new Map(),report={schemaVersion:1,passed:false,verify:options.verify,gainUnits:'source',referenceFrequencyHz:440,engines:options.engines,sampleRates:options.rates,executions:options.executions,roles:options.roles,frequencies:options.frequencies,rows:[],anchors:[],psgAnchors:[],dualChecks:[],
    baseline:{path:path.relative(root,historicalPath),sha256:initialHashes[path.relative(root,historicalPath)],rows:historical.rows.length,referenceAmplitude:historical.calibration.referenceAmplitude,targetAmplitude:historical.calibration.targetAmplitude},
    scripts:initialHashes,physicalOutputMuted:true,listeningPerformed:false,continuityOracle:'independent-24-bit-pilot-PCM',
    limits:['A dedicated single held pure square voice measures digital output units, not subjective loudness, polyphony, or analogue console output.',
      'The independent pilot proves capture-input sample order only; it does not prove every primary POKEY core frame or a physical audio deadline.',
      'CurrentFrame anomalies are retained as diagnostics and do not alone invalidate continuous pilot PCM.',
      'Browser engines use the actual shipped WASM/AudioWorklets; no Native audio device is opened. Native parity is tested separately.',
      'The raw POKEY DAC is unipolar. Capture observes its existing speaker-only10Hz DC blocker; raw core DC is not normalized into gain.',
      'POKEY square AC RMS is matched to the measured current Sega PSG square AC RMS times its unchanged System listening gain0.35. The historical sine half-peak-to-peak target remains a diagnostic anchor only.',
      'The target and 153 historical measurements are immutable; only POKEY gains may be derived from this extension.']};
  const save=async()=>{await fs.mkdir(path.dirname(options.out),{recursive:true});await fs.writeFile(options.out,JSON.stringify(report,null,2)+'\n');};
  const server=http.createServer(async(request,response)=>{
    try{
      const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
      if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
      if(pathname==='/__pokey_calibration_capture.js'){response.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(processorSource);return;}
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
      try{for(const requestedSampleRate of options.rates)for(const execution of options.executions)for(const kind of ['ym2612','segapsg','pokey'])for(const role of kind==='pokey'?options.roles:['primary']){
        const context=await browser.newContext({serviceWorkers:'block'});await context.addInitScript(instrument,requestedSampleRate);
        await context.addInitScript(`window.__pokeyCalibrationAnalysis={pilot:${analyzePilotPcm.toString()},clock:${analyzeClockRows.toString()}};`);
        const page=await context.newPage(),errors=[],badResponses=[];page.setDefaultTimeout(30000);
        page.on('pageerror',error=>errors.push(String(error)));page.on('response',response=>{if(response.status()>=400)badResponses.push({url:response.url(),status:response.status()});});
        await page.route('**/vs/loader*.js',route=>route.abort());
        const mode=kind==='pokey'?buildPokeyCalibrationReference(440,{role}).mode:'genesis';
        try{
          await page.goto(`http://127.0.0.1:${server.address().port}/playground/index.html?mode=${mode}`);
          await page.waitForFunction(()=>Boolean(window.__pokeyCalibration));await page.locator('#startupNotice').waitFor({state:'hidden'});
          for(const frequencyHz of kind==='pokey'?options.frequencies:[440]){
            let reference=kind==='pokey'?buildPokeyCalibrationReference(frequencyHz,{role}):kind==='segapsg'?buildPokeyPsgBalanceReference():buildFmCalibrationReference('ym2612',frequencyHz);
            if(kind==='ym2612')reference={...reference,sourceId:'ym2612',setup:reference.setup.replace(/createSoundChip\(\s*(['"])ym2612\1\s*,\s*\{id:\s*'calibration-source'\}\s*\)/,"useSoundChip('ym2612')")};
            const originalMixerSettings=kind==='segapsg'?await page.evaluate(()=>window.__pokeyCalibration.runtime.megaDrive.mixer.get('segapsg')):undefined;
            if(kind==='segapsg')assert.equal(originalMixerSettings.volume,PSG_LISTENING_GAIN,'Recorded current System Sega PSG listening gain before unity capture');
            const volume=options.verify&&kind==='pokey'?'':',volume:1';
            const beforeUnity=kind==='segapsg'?`\ncontext.calibrationPsgListeningSettings=await mixer.get('segapsg');\nif(context.calibrationPsgListeningSettings.volume!==${PSG_LISTENING_GAIN})throw Error('Sega PSG System listening gain changed');`:'';
            const source=reference.setup+beforeUnity+`\nawait mixer.set(${JSON.stringify(reference.sourceId)},{pan:0,muted:false,solo:true${volume}});\nlog('POKEY_CALIBRATION_READY');`;
            await page.evaluate(async({source,execution})=>{await window.__pokeyCalibration.runtime.playSource(source,{execution});window.__pokeyCalibration.runtime.megaDrive.audio.setListeningVolume(0);},{source,execution});
            await page.waitForFunction(()=>document.querySelector('#consoleOutput')?.textContent.includes('POKEY_CALIBRATION_READY'));
            const mixer=await page.evaluate(sourceId=>{const synth=window.__pokeyCalibration.runtime.megaDrive;return {id:sourceId,entry:synth.mixer.list().find(entry=>entry.id===sourceId),settings:synth.mixer.get(sourceId)};},reference.sourceId);
            assert(mixer.entry?.connected,'Actual connected calibration source');assert.equal(mixer.settings.pan,0);assert.equal(mixer.settings.muted,false);assert.equal(mixer.settings.solo,true);if(!options.verify||kind!=='pokey')assert.equal(mixer.settings.volume,1);
            const pcm=await capture(page),measuredAmplitude=Math.max(...pcm.channels.map(channel=>channel.halfPeakToPeak));
            assert.equal(pcm.sampleRate,requestedSampleRate,'Requested host output rate actually used');
            const referencePeak=reference.decodedReference?.codecHeadroom??1,amplitude=measuredAmplitude/referencePeak;
            assert(amplitude>1e-5,'Nonzero alternating reference');assert(pcm.channels.every(channel=>channel.overrange===0),'Unclipped reference');
            const expectedFrequencyHz=reference.effectiveFrequencyHz??frequencyHz;
            assert(pcm.channels.every(channel=>Math.abs(channel.estimatedFrequencyHz-expectedFrequencyHz)<Math.max(2,expectedFrequencyHz*.015)),'Reference pitch: '+JSON.stringify(pcm.channels));
            if(kind==='pokey'){
              assert.equal(referencePeak,1,'POKEY square requires no codec headroom correction');
              const referenceRms=reference.decodedReference.decodedRms;
              assert.equal(referenceRms,1,'An ideal unit square has RMS1');
              // The existing10Hz DC blocker creates expected droop across each
              // square plateau. Preserve it: require a held square rather than
              // correcting the core, filtering the capture, or normalizing it.
              assert(pcm.channels.every(channel=>channel.nonzero>pcm.frames*.99&&Math.abs(channel.dc)<channel.peak*.02&&channel.acRms/channel.halfPeakToPeak>.90&&channel.acRms/channel.halfPeakToPeak<1.01),'POKEY held square must be centered and settled before capture, including Worker scheduling');
              assert(pcm.channels.every(channel=>Math.abs(channel.firstHalfAcRms/channel.secondHalfAcRms-1)<.01),'POKEY held square must have stable AC RMS across both capture halves');
            }
            const acRms=Math.max(...pcm.channels.map(channel=>channel.acRms));
            const row={engine,browserVersion:browser.version(),requestedSampleRate,actualSampleRate:pcm.sampleRate,execution,role,mode,kind,frequencyHz,expectedFrequencyHz,sourceId:reference.sourceId,sourceSha256:sha(source),source,waveform:reference.waveform??'sine',referencePeak,decodedReference:reference.decodedReference??null,noteInfo:reference.noteInfo,limitations:reference.limitations,mixer,pcm,measuredAmplitude,amplitude,acRms};
            if(kind==='segapsg')row.listeningReference={gain:PSG_LISTENING_GAIN,originalMixerSettings,policy:'Existing System Sega PSG listening gain',measurementMetric:'acRms',acRms:acRms*PSG_LISTENING_GAIN};
            if(options.verify&&kind!=='pokey'){
              const previous=(kind==='segapsg'?baseline.psgAnchors:baseline.anchors).find(row=>row.engine===engine&&row.requestedSampleRate===requestedSampleRate&&row.execution===execution);
              assert(previous,'Matching unchanged live anchor');row.anchorRmsRelativeError=Math.abs(acRms/previous.acRms-1);assert(row.anchorRmsRelativeError<.025,'Unchanged live anchor AC RMS within2.5%');
            }
            if(options.verify&&kind==='pokey'){
              const original=baseline.rows.find(candidate=>candidate.kind==='pokey'&&candidate.engine===engine&&candidate.requestedSampleRate===requestedSampleRate&&candidate.execution===execution&&candidate.role===role&&candidate.frequencyHz===frequencyHz);
              assert(original,'Matching uncalibrated POKEY route');const expectedGain=baseline.calibration.routes.find(candidate=>candidate.kind==='pokey'&&candidate.role===role)?.volume;assert(Number.isFinite(expectedGain)&&expectedGain>0,'Explicit derived POKEY policy');
              assert.equal(mixer.settings.volume,expectedGain,'Generated default POKEY gain');
              row.expectedAmplitude=original.amplitude*expectedGain;row.relativeError=Math.abs(amplitude/row.expectedAmplitude-1);assert(row.relativeError<.025,'POKEY generated gain output within2.5%');
              row.channelRmsRelativeErrors=pcm.channels.map((channel,index)=>Math.abs(channel.acRms/(original.pcm.channels[index].acRms*expectedGain)-1));
              assert(row.channelRmsRelativeErrors.every(error=>error<.025),'POKEY generated gain RMS output within2.5%');
            }
            await page.evaluate(()=>window.__pokeyCalibration.runtime.stopWithFade());row.stopped=await capture(page,{seconds:.15,warmup:.25});
            assert(row.stopped.channels.every(channel=>channel.nonzero===0),'Exact zero after Stop');
            assert.deepEqual(errors,[],'No Browser exceptions');assert.deepEqual(badResponses,[],'No missing runtime assets');
            (kind==='pokey'?report.rows:kind==='segapsg'?report.psgAnchors:report.anchors).push(row);await save();
            console.log(`PASS ${engine}/${requestedSampleRate}/${execution}/${role}/${kind}/${frequencyHz}: halfP2P=${measuredAmplitude}; normalized=${amplitude}; clock=${pcm.clock.continuous?'continuous':'diagnostic anomaly retained'}`);
          }
        }finally{await page.evaluate(()=>window.__pokeyCalibration?.runtime.finalize()).catch(()=>{});await context.close();}
      }
      if(options.dualChecks&&options.roles.includes('dual-first')&&options.roles.includes('dual-second')&&options.frequencies.includes(440)&&options.frequencies.includes(880)){
        for(const requestedSampleRate of options.rates)for(const execution of options.executions){
          const context=await browser.newContext({serviceWorkers:'block'});await context.addInitScript(instrument,requestedSampleRate);
          await context.addInitScript(`window.__pokeyCalibrationAnalysis={pilot:${analyzePilotPcm.toString()},clock:${analyzeClockRows.toString()}};`);
          const page=await context.newPage(),errors=[],badResponses=[];page.setDefaultTimeout(30000);
          page.on('pageerror',error=>errors.push(String(error)));page.on('response',response=>{if(response.status()>=400)badResponses.push({url:response.url(),status:response.status()});});
          await page.route('**/vs/loader*.js',route=>route.abort());
          try{
            await page.goto(`http://127.0.0.1:${server.address().port}/playground/index.html?mode=pokey-dual`);
            await page.waitForFunction(()=>Boolean(window.__pokeyCalibration));await page.locator('#startupNotice').waitFor({state:'hidden'});
            const references=[buildPokeyCalibrationReference(440,{role:'dual-first'}),buildPokeyCalibrationReference(880,{role:'dual-second'})];
            const isolated=references.map(reference=>{
              const row=report.rows.find(row=>row.engine===engine&&row.requestedSampleRate===requestedSampleRate&&row.execution===execution&&row.role===reference.role&&row.frequencyHz===reference.frequencyHz);
              assert(row,'Individual dual-chip reference must precede combination checks');return row;
            });
            const row={engine,browserVersion:browser.version(),requestedSampleRate,actualSampleRate:requestedSampleRate,execution,role:'dual-pair',mode:'pokey-dual',kind:'pokey',sources:references.map(reference=>({role:reference.role,id:reference.sourceId,frequencyHz:reference.frequencyHz,expectedFrequencyHz:reference.effectiveFrequencyHz}))};
            for(const phase of ['split','sum']){
              const pans=phase==='split'?[-1,1]:[0,0];
              const source=references.map((reference,index)=>`{\n${reference.setup}\n}\nawait mixer.set(${JSON.stringify(reference.sourceId)},{pan:${pans[index]},muted:false,solo:true${options.verify?'':',volume:1'}});`).join('\n')+"\nlog('POKEY_DUAL_CALIBRATION_READY');";
              await page.evaluate(async({source,execution})=>{await window.__pokeyCalibration.runtime.playSource(source,{execution});window.__pokeyCalibration.runtime.megaDrive.audio.setListeningVolume(0);},{source,execution});
              await page.waitForFunction(()=>document.querySelector('#consoleOutput')?.textContent.includes('POKEY_DUAL_CALIBRATION_READY'));
              const mixers=await page.evaluate(ids=>{const synth=window.__pokeyCalibration.runtime.megaDrive;return ids.map(id=>({id,entry:synth.mixer.list().find(entry=>entry.id===id),settings:synth.mixer.get(id)}));},references.map(reference=>reference.sourceId));
              for(let index=0;index<mixers.length;index++){
                const mixer=mixers[index];assert(mixer.entry?.connected,'Both independent POKEY sources connected');assert.equal(mixer.settings.pan,pans[index]);assert.equal(mixer.settings.muted,false);assert.equal(mixer.settings.solo,true);
                const expectedGain=options.verify?baseline.calibration.routes.find(route=>route.role===references[index].role)?.volume:1;
                assert(Number.isFinite(expectedGain)&&expectedGain>0,'Explicit dual chip expected gain');assert.equal(mixer.settings.volume,expectedGain,'Each dual chip uses its expected source gain exactly once');
              }
              const pcm=await capture(page);assert.equal(pcm.sampleRate,requestedSampleRate);assert(pcm.channels.every(channel=>channel.overrange===0),'Unclipped dual-chip combination');
              const expectedRms=phase==='split'?isolated.map((row,index)=>row.pcm.channels[index].acRms):[0,1].map(index=>Math.hypot(...isolated.map(row=>row.pcm.channels[index].acRms)));
              const rmsRelativeErrors=pcm.channels.map((channel,index)=>Math.abs(channel.acRms/expectedRms[index]-1));
              assert(rmsRelativeErrors.every(error=>error<.025),'Independent dual-chip source RMS, with no extra combined normalization: '+JSON.stringify(rmsRelativeErrors));
              if(phase==='split')assert(pcm.channels.every((channel,index)=>Math.abs(channel.estimatedFrequencyHz-references[index].effectiveFrequencyHz)<Math.max(2,references[index].effectiveFrequencyHz*.015)),'Split left/right resolve distinct independent POKEY tones');
              else assert(Math.abs(pcm.channels[0].acRms/pcm.channels[1].acRms-1)<1e-6,'Centered dual-chip sum has identical stereo levels');
              row[phase]={sourceSha256:sha(source),source,mixers,pcm,expectedRms,rmsRelativeErrors};
              console.log(`PASS ${engine}/${requestedSampleRate}/${execution}/dual-${phase}: AC RMS errors=${rmsRelativeErrors.join(',')}; clock=${pcm.clock.continuous?'continuous':'diagnostic anomaly retained'}`);
            }
            await page.evaluate(()=>window.__pokeyCalibration.runtime.stopWithFade());row.stopped=await capture(page,{seconds:.15,warmup:.25});assert(row.stopped.channels.every(channel=>channel.nonzero===0),'Exact zero after dual-chip Stop');
            assert.deepEqual(errors,[],'No dual Browser exceptions');assert.deepEqual(badResponses,[],'No missing dual runtime assets');report.dualChecks.push(row);await save();
          }finally{await page.evaluate(()=>window.__pokeyCalibration?.runtime.finalize()).catch(()=>{});await context.close();}
        }
      }
      }finally{await browser.close();}
    }
    const completeCoverage=report.rows.length===96&&report.anchors.length===8&&report.psgAnchors.length===8&&report.dualChecks.length===8&&options.engines.length===2&&options.rates.length===2&&options.executions.length===2&&options.roles.length===4&&options.frequencies.length===3;
    const psgAnchor=report.psgAnchors.find(row=>row.engine==='chromium'&&row.requestedSampleRate===48000&&row.execution==='main')??report.psgAnchors[0];assert(psgAnchor,'Live440Hz Sega PSG anchor required');
    const targetAcRms=psgAnchor.acRms*PSG_LISTENING_GAIN;
    const routeGains=options.roles.map(role=>{
      const candidates=report.rows.filter(row=>row.role===role&&row.frequencyHz===440),reference=candidates.find(row=>row.engine==='chromium'&&row.requestedSampleRate===48000&&row.execution==='main')??candidates[0];assert(reference,'440Hz POKEY measurement required to derive gain');
      const volume=Number((targetAcRms/reference.acRms).toFixed(6));assert(volume>0&&volume<=2,'POKEY gain exceeds Mixer range; do not clamp the square-family target');
      return {kind:'pokey',role,mode:reference.mode,name:reference.sourceId,measurementMetric:'acRms',rawAcRms:reference.acRms,amplitude:reference.amplitude,volume,reference:{engine:reference.engine,sampleRate:reference.actualSampleRate,execution:reference.execution,frequencyHz:440}};
    });
    report.completeCoverage=completeCoverage;report.calibration=options.verify?baseline.calibration:{referenceAmplitude:historical.calibration.referenceAmplitude,targetAmplitude:historical.calibration.targetAmplitude,measurementMetric:'acRms',targetAcRms,listeningReference:{kind:'segapsg',mode:'genesis',name:psgAnchor.sourceId,gain:PSG_LISTENING_GAIN,rawAcRms:psgAnchor.acRms,targetAcRms,reference:{engine:psgAnchor.engine,sampleRate:psgAnchor.actualSampleRate,execution:psgAnchor.execution,frequencyHz:440}},maxGain:2,targetChanged:false,routes:routeGains};
    const allRows=[...report.rows,...report.anchors,...report.psgAnchors,...report.dualChecks];
    const capturesFor=row=>row.role==='dual-pair'?[['split',row.split.pcm],['sum',row.sum.pcm],['stopped',row.stopped]]:[['pcm',row.pcm],['stopped',row.stopped]];
    report.pcmContinuous=allRows.every(row=>capturesFor(row).every(([,pcm])=>pcm.pilot.continuous));
    report.clockAnomalies=allRows.flatMap(row=>capturesFor(row).filter(([,pcm])=>!pcm.clock.continuous).map(([label,pcm])=>({engine:row.engine,sampleRate:row.actualSampleRate,execution:row.execution,role:row.role,kind:row.kind,frequencyHz:row.frequencyHz,capture:label,clock:pcm.clock})));
    for(const [name,record]of served)assert.equal(sha(await fs.readFile(path.join(options.root,name))),record.sha256,'Frozen served source: '+name);
    for(const [file,hash]of Object.entries(initialHashes))assert.equal(sha(await fs.readFile(path.join(root,file))),hash,'Frozen script/baseline: '+file);
    // Generated policy assets depend on this calibration extension: exclude
    // their hashes to avoid a report -> policy -> report dependency cycle.
    report.sourceHashExclusions=[...generatedPolicyAssets];
    report.sources=Object.fromEntries([...served].filter(([name])=>!generatedPolicyAssets.has(name)).sort(([a],[b])=>a.localeCompare(b)));report.passed=true;await save();
    console.log(`PASS POKEY ${options.verify?'policy verification':'unit calibration'}: ${report.rows.length} POKEY +${report.anchors.length} YM2612 +${report.psgAnchors.length} Sega PSG +${report.dualChecks.length} dual-combination captures; completeCoverage=${completeCoverage}; ${options.out}`);
  }catch(error){report.error=String(error.stack??error);await save();throw error;}
  finally{await new Promise(resolve=>server.close(resolve));}
}
if(process.argv.includes('--help'))console.log('node scripts/calibrate_pokey_levels.cjs [--out REPORT] [--engines chromium,webkit] [--sample-rates 44100,48000] [--executions main,worker] [--roles primary,dual-first,dual-second,extra] [--frequencies 220,440,880] [--no-dual-checks] [--verify --baseline REPORT]');
else main().catch(error=>{console.error(error);process.exitCode=1;});
