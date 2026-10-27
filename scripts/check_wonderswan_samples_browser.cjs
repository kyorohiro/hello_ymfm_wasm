// Actual Analyzer Samples UI and real WASM preview. A test-only AnalyserNode
// measures the preview before a zero-gain destination, keeping hardware silent.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {gunzipSync}=require('node:zlib');
const {chromium,webkit}=require('playwright');
const repository=path.resolve(__dirname,'..'),args=process.argv.slice(2);
if(args.includes('--help')){console.log('Usage: node scripts/check_wonderswan_samples_browser.cjs [--root=docs-or-flat-analyzer] [--chromium-only] [--webkit-only] [--large-file=local.vgm-or.vgz] [--out=REPORT.json]');process.exit(0);}
for(const arg of args)if(!arg.startsWith('--root=')&&!arg.startsWith('--out=')&&!arg.startsWith('--large-file=')&&!['--chromium-only','--webkit-only'].includes(arg))throw Error(`Unknown argument: ${arg}`);
assert(!(args.includes('--chromium-only')&&args.includes('--webkit-only')),'Select at most one focused browser');
const root=path.resolve(repository,args.find(v=>v.startsWith('--root='))?.slice(7)??'docs');
const reportPath=args.find(v=>v.startsWith('--out='))?.slice(6);
const largeFilePath=args.find(v=>v.startsWith('--large-file='))?.slice(13);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex'),servedSources=new Map();
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm'};
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://local').pathname);
    if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    let file=path.resolve(root,'.'+pathname);
    if(file!==root&&!file.startsWith(root+path.sep))throw Error('Outside test root');
    if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
    const body=await fs.readFile(file);
    servedSources.set(path.relative(root,file).replaceAll(path.sep,'/'),{bytes:body.length,sha256:sha256(body)});
    response.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');response.end(body);
  }catch(error){response.writeHead(404).end(error.message);}
});
// No preview data is injected. We retain actual source buffers and read actual
// rendered samples upstream of the muting gain, as well as observing lifecycle.
const installProbe=()=>{
  const Original=window.AudioContext??window.webkitAudioContext;
  const state={contexts:[],sources:[],starts:0,stops:0,holdNextResume:false,releaseResume:null,copied:null};
  window.__wsSampleTest=state;
  document.addEventListener('change',event=>{
    if(event.target?.id==='fileInput'&&event.target.files?.[0])state.inputFile=event.target.files[0];
  },true);
  class TestAudioContext extends Original{
    constructor(...args){
      super(...args);const context=this;
      const analyser=this.createAnalyser();analyser.fftSize=2048;
      const silence=this.createGain();silence.gain.value=0;
      analyser.connect(silence);silence.connect(this.destination);
      const meter={analyser,silence,sampleRate:this.sampleRate};state.contexts.push(meter);
      const originalCreate=this.createBufferSource.bind(this);
      this.createBufferSource=()=>{
        const source=originalCreate(),record={source,starts:0,stops:0,destinationMuted:false,meter};
        state.sources.push(record);
        const connect=source.connect.bind(source),start=source.start.bind(source),stop=source.stop.bind(source);
        source.connect=(destination,...rest)=>{
          if(destination!==context.destination)throw Error('Unexpected preview audio route');
          record.destinationMuted=true;return connect(analyser,...rest);
        };
        source.start=(...values)=>{record.starts++;state.starts++;return start(...values);};
        source.stop=(...values)=>{record.stops++;state.stops++;return stop(...values);};
        return source;
      };
      const resume=this.resume.bind(this);
      this.resume=async()=>{
        await resume();
        if(state.holdNextResume){state.holdNextResume=false;await new Promise(resolve=>{state.releaseResume=()=>{state.releaseResume=null;resolve();};});}
      };
    }
  }
  Object.defineProperty(window,'AudioContext',{configurable:true,value:TestAudioContext});
  if(window.webkitAudioContext)Object.defineProperty(window,'webkitAudioContext',{configurable:true,value:TestAudioContext});
  try{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{state.copied=String(value);}}});}catch{}
  state.snapshot=()=>({starts:state.starts,stops:state.stops,sourceCount:state.sources.length,
    sources:state.sources.map(record=>{
      const buffer=record.source.buffer,channels=buffer?Array.from({length:buffer.numberOfChannels},(_,channel)=>{
        const values=buffer.getChannelData(channel);let sum=0,square=0,peak=0,bad=0;
        for(const value of values){if(!Number.isFinite(value))bad++;else{sum+=value;square+=value*value;peak=Math.max(peak,Math.abs(value));}}
        return{frames:values.length,peak,bad,mean:sum/values.length,acRms:Math.sqrt(Math.max(0,square/values.length-(sum/values.length)**2))};
      }):[];
      return{starts:record.starts,stops:record.stops,destinationMuted:record.destinationMuted,sampleRate:buffer?.sampleRate,channels};
    }),copied:state.copied,held:!!state.releaseResume});
  state.signal=()=>{
    const meter=state.sources.at(-1)?.meter;if(!meter)return null;
    const values=new Float32Array(meter.analyser.fftSize);meter.analyser.getFloatTimeDomainData(values);
    let peak=0,square=0,bad=0;for(const value of values){if(!Number.isFinite(value))bad++;else{peak=Math.max(peak,Math.abs(value));square+=value*value;}}
    return{peak,rms:Math.sqrt(square/values.length),bad,mute:meter.silence.gain.value};
  };
};
async function download(page,button){
  const [event]=await Promise.all([page.waitForEvent('download'),button.click()]);
  const bytes=await fs.readFile(await event.path());return{name:event.suggestedFilename(),bytes};
}
async function waitForSignal(page){
  await page.waitForFunction(()=>{const signal=window.__wsSampleTest.signal();return signal?.rms>.001;});
  const signal=await page.evaluate(()=>window.__wsSampleTest.signal());assert.equal(signal.bad,0);assert.equal(signal.mute,0);return signal;
}

const decodedVgm=bytes=>bytes[0]===0x1f&&bytes[1]===0x8b?gunzipSync(bytes):bytes;
async function rawVoiceAudit(input){
  const {Ym2612VGM,rawCommandLength}=await import(pathToFileURL(path.join(repository,'web/ym2612vgm.js')));
  const bytes=decodedVgm(input),parser=new Ym2612VGM(bytes,{logger:null}),windows=[];
  let position=parser.header.dataOffset,time=0,totalPcmWrites=0;
  while(position<bytes.length){
    const opcode=bytes[position],length=rawCommandLength(bytes,parser.view,position);
    if(opcode===0xbc&&bytes[position+1]===9){
      const index=Math.floor(time/441000);
      windows[index]??={startTime:index*441000,pcmCount:0,firstPcmTime:time,lastPcmTime:time,bytes:createHash('sha256'),timing:createHash('sha256')};
      const window=windows[index],value=bytes[position+2],timed=Buffer.allocUnsafe(5);
      timed.writeUInt32LE(time-window.startTime,0);timed[4]=value;
      window.bytes.update(Uint8Array.of(value));window.timing.update(timed);window.pcmCount++;window.lastPcmTime=time;totalPcmWrites++;
    }
    if(opcode===0x61)time+=parser.view.getUint16(position+1,true);
    else if(opcode===0x62)time+=735;
    else if(opcode===0x63)time+=882;
    else if(opcode>=0x70&&opcode<=0x7f)time+=(opcode&15)+1;
    else if(opcode===0x66)break;
    else if(![0xbc,0xc6].includes(opcode))throw Error('The optional local-file proof requires the direct-write Cat Song VGM, not an expanded DAC stream');
    position+=length;
  }
  return {durationSamples:time,totalPcmWrites,clock:parser.header.wonderswanClock,windows:windows.map(window=>({
    startTime:window.startTime,durationSamples:Math.min(441000,time-window.startTime),pcmCount:window.pcmCount,
    firstPcmTime:window.firstPcmTime,lastPcmTime:window.lastPcmTime,pcmSha256:window.bytes.digest('hex'),timingSha256:window.timing.digest('hex'),
  }))};
}

let referenceModules;
async function referenceVoiceSegment(input,startTime,frames=22050){
  referenceModules??=(async()=>{
    const [{WonderSwanAudioEngine},{Ym2612VGM},{default:factory},binary]=await Promise.all([
      import(pathToFileURL(path.join(repository,'web/wonderswanaudioengine.js'))),
      import(pathToFileURL(path.join(repository,'web/ym2612vgm.js'))),
      import(pathToFileURL(path.join(repository,'docs/generated/wonderswan_wasm.js'))),
      fs.readFile(path.join(repository,'docs/generated/wonderswan_wasm.wasm')),
    ]);
    return{WonderSwanAudioEngine,Ym2612VGM,module:await factory({wasmBinary:binary})};
  })();
  const{WonderSwanAudioEngine,Ym2612VGM,module}=await referenceModules;
  const parser=new Ym2612VGM(decodedVgm(input),{logger:{warn:message=>{throw Error(message);}}});
  const engine=await WonderSwanAudioEngine.create({moduleFactory:async()=>module,clock:parser.header.wonderswanClock,outputSampleRate:44100,masterVolume:1});
  for(const channel of[0,2,3])engine.setChannelMuted(channel,true);
  const left=new Float32Array(frames),right=new Float32Array(frames),endTime=startTime+frames;
  let time=0,rendered=0;
  const targets={wonderswan:{writeRegister:(r,v)=>engine.writeWonderSwan(r,v),writeMemory:(a,v)=>engine.writeWonderSwanMemory(a,v)}};
  try{
    while(rendered<endTime){
      const event=parser.playStep(targets);if(event.type==='end')break;
      if(event.type==='wait')parser.consumeWait(targets,event.samples,count=>{
        time+=count;const end=Math.min(endTime,time);
        if(end>rendered){
          const pcm=engine.processFrames(end-rendered),from=Math.max(rendered,startTime);
          if(end>from){left.set(pcm.left.subarray(from-rendered,end-rendered),from-startTime);right.set(pcm.right.subarray(from-rendered,end-rendered),from-startTime);}
          rendered=end;
        }
      });
    }
  }finally{engine.dispose();}
  assert.equal(rendered,endTime,'Original VGM covers the preview reference interval');
  return{left,right,sampleRate:44100,startTime,frames,sha256:sha256(Buffer.concat([Buffer.from(left.buffer),Buffer.from(right.buffer)]))};
}
function compareVoicePcm(actual,reference,label){
  assert.equal(actual.sampleRate,44100);assert.equal(actual.left.length,reference.frames);assert.equal(actual.right.length,reference.frames);
  let maximumDifference=0,mismatchedSamples=0;const firstMismatches=[];
  for(const channel of['left','right'])for(let frame=0;frame<reference.frames;frame++){
    const value=actual[channel][frame],expected=reference[channel][frame],difference=Math.abs(value-expected);
    assert(Number.isFinite(value),label+' has finite PCM');maximumDifference=Math.max(maximumDifference,difference);
    if(difference!==0){mismatchedSamples++;if(firstMismatches.length<5)firstMismatches.push({channel,frame,actual:value,expected});}
  }
  const result={framesPerChannel:reference.frames,sampleRate:44100,sourceStartSample:reference.startTime,maximumDifference,mismatchedSamples,firstMismatches,referenceSha256:reference.sha256};
  assert.equal(mismatchedSamples,0,label+' retains original CH2 timing, routing and native tick phase: '+JSON.stringify(result));
  return result;
}
function compareVoiceWav(bytes,reference,label){
  assert.equal(bytes.subarray(0,4).toString(),'RIFF');assert.equal(bytes.subarray(8,12).toString(),'WAVE');
  assert.equal(bytes.readUInt16LE(20),1);assert.equal(bytes.readUInt16LE(22),2);assert.equal(bytes.readUInt32LE(24),44100);assert.equal(bytes.readUInt16LE(34),16);
  assert.equal(bytes.readUInt32LE(40)+44,bytes.length);
  let mismatchedSamples=0;
  for(let frame=0;frame<reference.frames;frame++)for(const[channel,offset]of[['left',0],['right',2]]){
    const value=Math.max(-1,Math.min(1,reference[channel][frame])),expected=Math.round(value*(value<0?32768:32767));
    if(bytes.readInt16LE(44+frame*4+offset)!==expected)mismatchedSamples++;
  }
  assert.equal(mismatchedSamples,0,label+' contains exactly quantized preview PCM');
  return{framesPerChannel:reference.frames,mismatchedSamples};
}
function storedZipFiles(bytes){
  const files=new Map();let offset=0;
  while(offset+30<=bytes.length&&bytes.readUInt32LE(offset)===0x04034b50){
    assert.equal(bytes.readUInt16LE(offset+8),0,'Sample ZIP contains stored files');
    const size=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extraLength=bytes.readUInt16LE(offset+28);
    const name=bytes.subarray(offset+30,offset+30+nameLength).toString(),from=offset+30+nameLength+extraLength;
    assert(from+size<=bytes.length,'ZIP member is complete');assert(!files.has(name),'ZIP member names are unique');
    files.set(name,bytes.subarray(from,from+size));offset=from+size;
  }
  assert.equal(bytes.readUInt32LE(offset),0x02014b50,'ZIP has a central directory');return files;
}
function checkVoiceJson(content,expected,label){
  assert.equal(content.schemaVersion,1);assert.equal(content.format,'tetorica-wonderswan-voice-pcm');
  assert.equal(content.chip,'wonderswan');assert.equal(content.kind,'voice-pcm');assert.equal(content.representation,'timed-voice-pcm');
  assert.equal(content.clock,3072000);assert.equal(content.timebase,44100);
  assert.equal(content.sourceStartSample,expected.startTime);assert.equal(content.durationSamples,expected.durationSamples);
  assert.deepEqual(content.phase,{sourceStartSample:expected.startTime,timebase:44100,nativeTickRate:24000,periodSamples:147});
  for(const name of['registers','heldRegisters']){
    assert.equal(content.initial[name].length,32);
    assert(content.initial[name].every(value=>Number.isInteger(value)&&value>=0&&value<=255),label+' has valid initial '+name);
  }
  assert.equal(content.initial.registers[17],11,label+' preserves source headphone/output routing');
  assert.equal(content.initial.registers[20],15,label+' preserves source Voice PCM left/right gain');
  assert.equal(content.pcmBytes.length,expected.pcmCount);assert.equal(sha256(Buffer.from(content.pcmBytes)),expected.pcmSha256);
  assert.equal(content.times.length,content.registers.length);assert.equal(content.times.length,content.values.length);
  const timing=createHash('sha256'),controls=new Set();let pcmIndex=0,previous=0;
  for(let index=0;index<content.times.length;index++){
    const time=content.times[index],register=content.registers[index],value=content.values[index];
    assert(Number.isInteger(time)&&time>=previous&&time<=content.durationSamples,label+' preserves ordered sample timestamps, including EOF');previous=time;
    assert([9,16,17,20,30].includes(register));assert(Number.isInteger(value)&&value>=0&&value<=255);
    if(register===9){
      assert.equal(value,content.pcmBytes[pcmIndex++]);const bytes=Buffer.allocUnsafe(5);bytes.writeUInt32LE(time,0);bytes[4]=value;timing.update(bytes);
    }else controls.add(register);
  }
  assert.equal(pcmIndex,expected.pcmCount);assert.equal(timing.digest('hex'),expected.timingSha256,label+' retains every original PCM byte and timestamp');
  assert.equal(content.observations.length,1);
  assert.equal(content.observations[0].startTime,expected.startTime);assert.equal(content.observations[0].endTime,expected.startTime+expected.durationSamples);
  if(expected.startTime===0)assert(content.registers.some((register,index)=>register===16&&content.values[index]===42),'Original CH2 enable/Voice/other mode bits remain in JSON');
  return{sourceStartSample:content.sourceStartSample,durationSamples:content.durationSamples,pcmBytes:content.pcmBytes.length,
    writeCount:content.times.length,pcmSha256:expected.pcmSha256,timingSha256:expected.timingSha256,
    controlRegisters:[...controls],phase:content.phase,initialOutput:content.initial.registers[17],initialVoiceGain:content.initial.registers[20],boundary:content.boundary};
}

async function checkLocalVoice(page,analyzerPath,largeFile){
  console.error('WonderSwan Samples: local timed Voice PCM captures and unused RAM candidates');
  await page.locator('#fileInput').setInputFiles({name:largeFile.name,mimeType:'application/octet-stream',buffer:largeFile.bytes});
  await page.waitForFunction(name=>document.getElementById('status').textContent.startsWith('Parsed '+name+' ')&&!document.getElementById('sampleExplorerTab').disabled,largeFile.name);
  await page.locator('#sampleExplorerTab').click();
  await page.locator('#sampleExplorerPanel').getByRole('button',{name:'Analyze samples',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-wonderswan-voice-id]').length===10);
  const voices=page.locator('[data-wonderswan-voice-id]'),candidates=page.locator('[data-wonderswan-wave-usage="unused"]');
  assert.equal(await voices.count(),10,'The source has ten timed output windows');assert.equal(await candidates.count(),6);
  assert.equal(await page.locator('[data-wonderswan-wave-usage="used"]').count(),0,'RAM definitions are not mistaken for played wave instruments');
  const candidateSummary=page.locator('summary').filter({hasText:/^Unplayed WonderSwan RAM candidates \(6\)$/});
  assert.equal(await candidateSummary.count(),1,'Unused RAM has a separate, explicitly labelled group');
  if(!await candidateSummary.evaluate(summary=>summary.parentElement.open))await candidateSummary.click();
  for(let index=0;index<6;index++)assert.match(await candidates.nth(index).locator('summary').innerText(),/^Unplayed RAM candidate /);
  const results=[],jsonDownloads=new Map();
  for(const index of[0,1]){
    const row=voices.nth(index),expected=largeFile.audit.windows[index];
    assert.match(await row.locator('summary').innerText(),/^Voice PCM capture /);await row.locator('summary').click();
    const canvas=row.locator('canvas[aria-label="WonderSwan Voice PCM input bytes over source time"]');
    await page.waitForFunction(canvas=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some((value,index)=>index%4===3&&value>0),await canvas.elementHandle());
    const json=await download(page,row.getByRole('button',{name:'Save timed Voice PCM JSON',exact:true}));
    const content=JSON.parse(json.bytes),metadata=checkVoiceJson(content,expected,`UI capture ${index+1}`);
    jsonDownloads.set(json.name,json.bytes);
    const before=await page.evaluate(()=>window.__wsSampleTest.starts);
    await row.getByRole('button',{name:'Preview Voice PCM',exact:true}).click();
    await page.waitForFunction(before=>window.__wsSampleTest.starts>before,before);
    const signal=await waitForSignal(page),probe=await page.evaluate(()=>window.__wsSampleTest.snapshot()),source=probe.sources.at(-1);
    assert(source.destinationMuted);assert.equal(source.sampleRate,44100);assert(source.channels.every(channel=>channel.bad===0&&channel.frames===expected.durationSamples));
    const actual=await page.evaluate(()=>{
      const buffer=window.__wsSampleTest.sources.at(-1).source.buffer;
      return{sampleRate:buffer.sampleRate,left:Array.from(buffer.getChannelData(0).subarray(0,22050)),right:Array.from(buffer.getChannelData(1).subarray(0,22050))};
    });
    const reference=await referenceVoiceSegment(largeFile.bytes,expected.startTime),comparison=compareVoicePcm(actual,reference,`Voice preview window ${index+1}`);
    await row.getByRole('button',{name:'Stop preview',exact:true}).click();
    const wav=await download(page,row.getByRole('button',{name:'Save preview WAV',exact:true}));
    assert.equal(wav.bytes.length,44+expected.durationSamples*4,'WAV duration matches the selected timed capture');
    const wavComparison=compareVoiceWav(wav.bytes,reference,`Voice WAV window ${index+1}`);
    results.push({id:Number(await row.getAttribute('data-wonderswan-voice-id')),waveformDrawn:true,metadata,
      json:{name:json.name,bytes:json.bytes.length,sha256:sha256(json.bytes)},preview:{source,signal,comparison},
      wav:{name:wav.name,bytes:wav.bytes.length,sha256:sha256(wav.bytes),comparison:wavComparison}});
  }
  // Use the same served public API as the CLI. The probe retains the actual
  // selected File before the app clears its input; no song data enters reports.
  const[event]=await Promise.all([page.waitForEvent('download'),page.evaluate(async analyzerPath=>{
    const{exportSamples}=await import(location.origin+analyzerPath+'/sample_core.js');
    let source=new Uint8Array(await window.__wsSampleTest.inputFile.arrayBuffer());
    if(source[0]===0x1f&&source[1]===0x8b)source=new Uint8Array(await new Response(new Blob([source]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    const result=await exportSamples(source,{all:true});
    const url=URL.createObjectURL(new Blob([result.bytes],{type:'application/zip'})),link=document.createElement('a');
    link.href=url;link.download='wonderswan-samples.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },analyzerPath)]);
  const zip=await fs.readFile(await event.path()),files=storedZipFiles(zip);
  assert.equal(files.size,17,'ZIP contains ten Voice captures, six RAM candidates and one manifest');
  const manifest=JSON.parse(files.get('manifest.json'));
  assert.equal(manifest.schemaVersion,1);assert.equal(manifest.timebase,44100);assert.equal(manifest.time,largeFile.audit.durationSamples);
  const voiceInventory=manifest.samples.filter(sample=>sample.chip==='wonderswan'&&sample.kind==='voice-pcm'),waveInventory=manifest.samples.filter(sample=>sample.chip==='wonderswan'&&sample.kind==='wave');
  assert.equal(voiceInventory.length,10);assert.equal(waveInventory.length,6);assert(waveInventory.every(sample=>sample.usedInPlayback===false));
  const captured=[];
  for(const[name,bytes]of files){
    if(name==='manifest.json')continue;
    const content=JSON.parse(bytes);
    if(content.kind==='voice-pcm'){
      const index=content.sourceStartSample/441000,expected=largeFile.audit.windows[index];assert(expected,'ZIP capture has a known source window');
      const metadata=checkVoiceJson(content,expected,`ZIP ${name}`),inventory=voiceInventory.find(sample=>sample.sourceStartSample===metadata.sourceStartSample);
      assert(inventory);assert.equal(inventory.representation,'timed-voice-pcm');assert.equal(inventory.durationSamples,metadata.durationSamples);assert.equal(inventory.size,metadata.pcmBytes);assert.equal(inventory.writeCount,metadata.writeCount);
      if(jsonDownloads.has(name))assert.deepEqual(bytes,jsonDownloads.get(name),'UI JSON and ZIP member agree byte-for-byte');
      captured.push({name,bytes:bytes.length,sha256:sha256(bytes),metadata});
    }else{assert.equal(content.kind,'wave');assert.equal(content.usedInPlayback,false);assert(content.observations.every(observation=>observation.audible===false));}
  }
  assert.equal(captured.length,10);assert.equal(captured.reduce((sum,capture)=>sum+capture.metadata.pcmBytes,0),1151160);
  for(const name of jsonDownloads.keys())assert(files.has(name),'Each UI JSON appears in the all-samples ZIP');
  return{voiceCaptures:10,unusedRamCandidates:6,totalPcmBytes:1151160,results,
    zip:{name:event.suggestedFilename(),bytes:zip.length,sha256:sha256(zip),members:files.size,captures:captured},
    originalDurationSamples:largeFile.audit.durationSamples};
}

async function runBrowser(name,type,origin,analyzerPath,fixture,waves,largeFile){
  const browser=await type.launch({headless:true,args:name==='chromium'?['--autoplay-policy=no-user-gesture-required']:[]});
  try{
    const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[];
    page.setDefaultTimeout(35000);page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(installProbe);
    await page.goto(origin+analyzerPath+'/index.html');await page.waitForFunction(()=>window.__wsSampleTest);
    const load=async(filename)=>{
      await page.locator('#fileInput').setInputFiles({name:filename,mimeType:'application/octet-stream',buffer:Buffer.from(fixture)});
      await page.waitForFunction(filename=>document.getElementById('status').textContent.startsWith('Parsed '+filename+' ')&&!document.getElementById('sampleExplorerTab').disabled,filename);
    };
    const analyze=async()=>{
      await page.locator('#sampleExplorerTab').click();
      await page.locator('#sampleExplorerPanel').getByRole('button',{name:'Analyze samples',exact:true}).click();
      await page.waitForFunction(()=>document.querySelectorAll('[data-wonderswan-wave-id]').length===2);
      assert.equal(await page.locator('[data-wonderswan-wave-id]').count(),2,'Shared channels must deduplicate identical wave RAM');
    };
    await load('original-wonderswan-wave-samples.vgm');await analyze();
    const expected=waves.map(bytes=>bytes.flatMap(value=>[value&15,value>>>4]));
    const rows=page.locator('[data-wonderswan-wave-id]'),waveResults=[];
    for(let index=0;index<2;index++){
      const row=rows.nth(index);await row.locator('summary').click();
      const canvas=row.locator('canvas[aria-label="WonderSwan wave RAM: 32 unsigned 4-bit values"]');
      await page.waitForFunction(element=>{const bytes=element.getContext('2d').getImageData(0,0,element.width,element.height).data;return bytes.some((value,index)=>index%4===3&&value>0);},await canvas.elementHandle());
      const code=await row.locator('textarea[aria-label="WonderSwan setWaveform JavaScript"]').inputValue();
      const calls=[];new Function('ws',code)({setWaveform:(...values)=>calls.push(values)});
      assert.equal(calls.length,1,'Exported code must call ws.setWaveform once');
      assert.deepEqual(calls[0].find(value=>Array.isArray(value)),expected[index],'Reusable code must retain low-nibble-first wave order');
      await row.getByRole('button',{name:'Copy setWaveform JavaScript',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.__wsSampleTest.copied),code,'Copy must preserve the reusable code');
      const json=await download(page,row.getByRole('button',{name:'Save waveform JSON',exact:true}));
      assert.match(json.name,/^wonderswan-wave-.*\.json$/);
      const content=JSON.parse(json.bytes);assert.equal(content.chip,'wonderswan');assert.equal(content.kind,'wave');
      assert.equal(content.schemaVersion,1);assert.equal(content.representation,'written-wave-ram');
      assert.deepEqual(content.waveform,expected[index]);assert.deepEqual(content.packedBytes,waves[index]);
      assert.equal(content.timebase,44100);assert(content.observations.length>=2,'Repeated use must be retained without duplicating waveform definitions');
      const initialOccurrence=Number(await row.locator('select').inputValue());
      assert.equal(calls[0][0],content.observations[initialOccurrence].channel-1,'Reusable code must address the selected zero-based channel');
      assert.equal(await row.getAttribute('data-wonderswan-wave-usage'),content.usedInPlayback?'used':'unused');
      const before=await page.evaluate(()=>window.__wsSampleTest.starts);
      await row.getByRole('button',{name:'Preview wave (1 s)',exact:true}).click();
      await page.waitForFunction(before=>window.__wsSampleTest.starts>before,before);
      const signal=await waitForSignal(page),probe=await page.evaluate(()=>window.__wsSampleTest.snapshot()),source=probe.sources.at(-1);
      assert.equal(source.destinationMuted,true);assert.equal(source.channels.length,2);
      for(const channel of source.channels){assert.equal(channel.bad,0);assert(channel.acRms>.001);assert.equal(channel.frames,source.sampleRate,'Preview must last one second');}
      const stopBefore=probe.stops;
      await page.locator('#sampleExplorerPanel').getByRole('button',{name:'Stop preview',exact:true}).click();
      assert((await page.evaluate(()=>window.__wsSampleTest.stops))>stopBefore,'Stop preview must stop the actual AudioBufferSourceNode');
      const wav=await download(page,row.getByRole('button',{name:'Save preview WAV (1 s)',exact:true}));
      assert.equal(wav.bytes.subarray(0,4).toString(),'RIFF');assert.equal(wav.bytes.subarray(8,12).toString(),'WAVE');
      assert.equal(wav.bytes.readUInt16LE(22),2);assert.equal(wav.bytes.readUInt32LE(24),source.sampleRate);
      assert(wav.bytes.length>source.sampleRate*4,'WAV must contain full stereo preview PCM');
      let occurrenceChange=null;
      if(index===0){
        const selected=content.observations.findIndex((event,index)=>index!==initialOccurrence&&event.channel!==content.observations[initialOccurrence].channel);
        assert(selected>=0,'Shared waveform must retain observations from distinct channels');
        await row.getByRole('button',{name:'Preview wave (1 s)',exact:true}).click();await waitForSignal(page);
        const stopBeforeSelection=await page.evaluate(()=>window.__wsSampleTest.stops);
        await row.locator('select').selectOption(String(selected));
        assert((await page.evaluate(()=>window.__wsSampleTest.stops))>stopBeforeSelection,'Changing occurrence must stop the current audition');
        const updatedCode=await row.locator('textarea').inputValue(),updatedCalls=[];
        new Function('ws',updatedCode)({setWaveform:(...values)=>updatedCalls.push(values)});
        assert.equal(updatedCalls[0][0],content.observations[selected].channel-1);
        assert.deepEqual(updatedCalls[0][1],expected[index]);
        occurrenceChange={index:selected,channel:content.observations[selected].channel,code:updatedCode,stopped:true};
      }
      waveResults.push({wave:index+1,code,json:{name:json.name,bytes:json.bytes.length,sha256:sha256(json.bytes),content},preview:{source,signal},wav:{name:wav.name,bytes:wav.bytes.length,sha256:sha256(wav.bytes)},occurrenceChange});
    }
    const first=rows.first(),preview=first.getByRole('button',{name:'Preview wave (1 s)',exact:true});
    // Hold the real context resume promise, then exercise user cancellation.
    let startBefore=await page.evaluate(()=>{window.__wsSampleTest.holdNextResume=true;return window.__wsSampleTest.starts;});
    await preview.click();await page.waitForFunction(()=>window.__wsSampleTest.releaseResume);
    await page.locator('#sampleExplorerPanel').getByRole('button',{name:'Stop preview',exact:true}).click();
    await page.evaluate(()=>window.__wsSampleTest.releaseResume());await page.waitForTimeout(150);
    assert.equal(await page.evaluate(()=>window.__wsSampleTest.starts),startBefore,'Cancelled pending preview must not start after context resume');
    // Replacing the source cancels an in-flight preview and clears old waves.
    startBefore=await page.evaluate(()=>{window.__wsSampleTest.holdNextResume=true;return window.__wsSampleTest.starts;});
    await preview.click();await page.waitForFunction(()=>window.__wsSampleTest.releaseResume);
    await load('replacement-wonderswan-wave-samples.vgm');
    assert.equal(await page.locator('[data-wonderswan-wave-id]').count(),0,'Loading a new file must clear sample observations');
    await page.evaluate(()=>window.__wsSampleTest.releaseResume());await page.waitForTimeout(150);
    assert.equal(await page.evaluate(()=>window.__wsSampleTest.starts),startBefore,'Replaced-source preview must not start later');
    await analyze();await rows.first().locator('summary').click();
    await rows.first().getByRole('button',{name:'Preview wave (1 s)',exact:true}).click();await waitForSignal(page);
    const stopBefore=await page.evaluate(()=>window.__wsSampleTest.stops);
    await load('reset-playing-wonderswan-wave-samples.vgm');
    assert((await page.evaluate(()=>window.__wsSampleTest.stops))>stopBefore,'File reset must stop an active preview');
    const voice=largeFile?await checkLocalVoice(page,analyzerPath,largeFile):null;
    assert.deepEqual(errors,[],'Analyzer Samples page errors');
    await page.screenshot({path:`/private/tmp/wonderswan-samples-${name}.png`,fullPage:true});
    return{browser:name,version:browser.version(),uniqueWaves:2,waveResults,voice,lifecycle:{stop:true,pendingStop:true,pendingFileReset:true,activeFileReset:true},pageErrors:errors};
  }finally{await browser.close();}
}
(async()=>{
  let analyzerPath='';try{await fs.access(path.join(root,'vgm_analyzer','vgm_analyzer.js'));analyzerPath='/vgm_analyzer';}catch{await fs.access(path.join(root,'vgm_analyzer.js'));}
  const{createWonderSwanSampleVgm,WONDER_SWAN_SAMPLE_WAVES}=await import(pathToFileURL(path.join(repository,'test/helpers/wonderswan_sample_vgm_fixture.mjs')).href);
  const largeFile=largeFilePath?{name:path.basename(largeFilePath),bytes:await fs.readFile(path.resolve(largeFilePath))}:null;
  if(largeFile){largeFile.audit=await rawVoiceAudit(largeFile.bytes);assert.equal(largeFile.audit.windows.length,10);assert.equal(largeFile.audit.totalPcmWrites,1151160);}
  const fixture=createWonderSwanSampleVgm();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const results=[],engines=[['chromium',chromium],['webkit',webkit]].filter(([name])=>!args.includes('--chromium-only')||name==='chromium').filter(([name])=>!args.includes('--webkit-only')||name==='webkit');
  try{for(const[name,type]of engines){results.push(await runBrowser(name,type,`http://127.0.0.1:${server.address().port}`,analyzerPath,fixture,WONDER_SWAN_SAMPLE_WAVES,largeFile));console.log(`WonderSwan Samples ${name}: wave export/lifecycle${largeFile?', timed Voice PCM, exact original CH2 preview/WAV and ZIP metadata':''} passed.`);}}
  finally{await new Promise(resolve=>server.close(resolve));}
  const sourceFiles=Object.fromEntries([...servedSources].sort(([a],[b])=>a.localeCompare(b)));
  const testSources=Object.fromEntries(await Promise.all(['scripts/check_wonderswan_samples_browser.cjs','test/helpers/wonderswan_sample_vgm_fixture.mjs'].map(async file=>[file,sha256(await fs.readFile(path.join(repository,file)))])));
  const report={format:'tetorica-wonderswan-samples-browser-2',root,physicalOutput:'zero-gain destination; actual preview AudioBuffer compared before device resampling',fixture:{bytes:fixture.length,sha256:sha256(fixture)},localFile:largeFile?{name:largeFile.name,bytes:largeFile.bytes.length,sha256:sha256(largeFile.bytes),sourceAudit:largeFile.audit,copiedIntoRepository:false}:null,sourceFiles,testSources,results};
  if(reportPath)await fs.writeFile(path.resolve(reportPath),JSON.stringify(report,null,2)+'\n');
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
