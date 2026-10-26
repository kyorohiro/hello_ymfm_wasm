/** Exact bounded comparisons of two real SNES/SPC WASM builds.
 * Uses the unchanged synchronous wrappers, original synthetic SPC/BRR only,
 * and no browser, compiler, AudioContext, physical audio device or tolerance.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {SpcCore, SpcPlayerCore, SnesDspCore, SPC_SAMPLE_RATE, SPC_TRACE_CLOCK_RATE, prepareSpcTimeline} from '../web/spc.js';
import {createSyntheticSpc} from '../web/spc_test_fixture.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage='Usage: node scripts/check_spc_wasm_sdk.mjs --legacy-dir DIR --sdk-dir DIR [--out REPORT.json]';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const layouts={regular:[256],irregular:[1,17,127,509,3,1024,257,4096]};
const bodyFrames=4097,probeFrames=97;
const exportNames=['create','destroy','error','load','restart','render','left_ptr','right_ptr','native_frames','set_mute_mask','snapshot_ptr','load_ram','write_dsp','read_dsp','trace_begin','trace_finish','trace_initial_ptr','trace_events_ptr','trace_event_count','ram_read_begin','ram_read_finish','ram_read_mask_ptr','observer_begin','observer_stop','observer_ptr','observer_drain','observer_lost','observer_registers_ptr','load_timeline','restart_timeline','timeline_total_frames'];
const requiredExports=exportNames.map(name=>'spc_'+name).concat(['malloc','free']);
function argumentsFor(argv){
  const values={};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--help'){assert.equal(argv.length,1,'--help cannot be combined with other arguments');return null;}
    const equal=arg.indexOf('='),name=equal<0?arg:arg.slice(0,equal);
    assert(['--legacy-dir','--sdk-dir','--out'].includes(name),`Unknown argument: ${arg}\n${usage}`);
    assert(!Object.hasOwn(values,name),`Duplicate argument: ${name}`);
    const value=equal<0?argv[++i]:arg.slice(equal+1);
    assert(value&&!value.startsWith('--'),`${name} needs a value`);values[name]=resolve(value);
  }
  assert(values['--legacy-dir']&&values['--sdk-dir'],usage);
  assert.notEqual(values['--legacy-dir'],values['--sdk-dir'],'Use two distinct build directories');
  if(values['--out']){const protectedPaths=['scripts/check_spc_wasm_sdk.mjs','web/spc.js','docs/js/spc.js','web/spc_test_fixture.mjs'].map(name=>resolve(root,name));assert(!protectedPaths.includes(values['--out']),'Report must not overwrite a checker input');}
  if(values['--out'])for(const dir of [values['--legacy-dir'],values['--sdk-dir']]){
    assert(!['spc_wasm.js','spc_wasm.wasm','build-info.json'].some(name=>resolve(dir,name)===values['--out']),'Report must not overwrite an input');
  }
  return values;
}
async function inputFile(path){const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha256(bytes)};}
async function backend(directory){
  const js=resolve(directory,'spc_wasm.js'),wasm=resolve(directory,'spc_wasm.wasm');
  const wasmBinary=await readFile(wasm),compiled=new WebAssembly.Module(wasmBinary);
  const exports=WebAssembly.Module.exports(compiled).map(({name,kind})=>({name,kind})).sort((a,b)=>a.name.localeCompare(b.name));
  for(const name of requiredExports)assert(exports.some(e=>e.name===name&&e.kind==='function'),`Missing WASM export ${name}: ${directory}`);
  const {default:factory}=await import(pathToFileURL(js).href);assert.equal(typeof factory,'function');
  const module=await factory({wasmBinary});
  for(const name of requiredExports)assert.equal(typeof module['_'+name],'function',`Missing generated JS export _${name}`);
  assert(module.HEAPU8 instanceof Uint8Array);assert(module.HEAPF32 instanceof Float32Array);assert.equal(typeof module.UTF8ToString,'function');
  const options={moduleFactory:()=>module},metadata={directory,javascript:await inputFile(js),wasm:await inputFile(wasm),exports};
  const buildInfoPath=resolve(directory,'build-info.json');let buildInfo;
  try{buildInfo=JSON.parse(await readFile(buildInfoPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(buildInfo){
    const artifact=buildInfo.artifacts?.find(a=>a.id==='spc');assert(artifact,'SPC build receipt entry');
    for(const [name,record] of [['spc_wasm.js',metadata.javascript],['spc_wasm.wasm',metadata.wasm]]){
      const output=artifact.outputs?.find(o=>o.path===name);assert(output,`Missing build receipt output: ${name}`);
      assert.equal(output.sha256,record.sha256,`Build receipt ${name} SHA`);assert.equal(output.size,record.bytes,`Build receipt ${name} size`);
    }
    metadata.buildInfo={...await inputFile(buildInfoPath),artifact};
  }
  return {module,metadata,create:()=>SpcCore.create(options),dsp:()=>SnesDspCore.create(options),ledger:{requestedOutputStereoFrames:0,deliveredOutputStereoFrames:0,nativeFrameAdvances:0,renderCalls:0,failedRenderCalls:0}};
}
function sameBytes(actual,expected,label){
  const a=ArrayBuffer.isView(actual)?Buffer.from(actual.buffer,actual.byteOffset,actual.byteLength):Buffer.from(actual);
  const b=ArrayBuffer.isView(expected)?Buffer.from(expected.buffer,expected.byteOffset,expected.byteLength):Buffer.from(expected);
  assert.equal(a.length,b.length,`${label}: byte length`);assert.equal(a.compare(b),0,`${label}: byte content`);
}
function pcmDigest(p){const h=createHash('sha256');for(const a of[p.left,p.right])h.update(Buffer.from(a.buffer,a.byteOffset,a.byteLength));return h.digest('hex');}
function equalPcm(a,b,label){for(const side of['left','right'])sameBytes(a[side],b[side],label+'/'+side);}
function peak(p){let max=0;for(const a of[p.left,p.right])for(const value of a){assert(Number.isFinite(value));assert(value>=-1&&value<=1);max=Math.max(max,Math.abs(value));}return max;}
function snapshotRecord(s){return {nativeFrames:s.nativeFrames,ramSha256:sha256(s.ram),dspSha256:sha256(s.dsp)};}
function traceRecord(t){return {durationClocks:t.durationClocks,events:t.events.length/4,eventsSha256:sha256(t.events),ramSha256:sha256(t.initialState.ram),dspSha256:sha256(t.initialState.dsp),outputDelayFrames:t.initialState.outputDelayFrames};}
function render(b,c,n,layout=[n]){
  const guard=123.25,left=new Float32Array(n+8).fill(guard),right=new Float32Array(n+8).fill(guard);let at=0,index=0;
  while(at<n){const count=Math.min(n-at,layout[index++%layout.length]),before=c.nativeFrames;b.ledger.renderCalls++;b.ledger.requestedOutputStereoFrames+=count;
    try{c.renderInto(left,right,count,at+3);b.ledger.deliveredOutputStereoFrames+=count;}
    catch(error){b.ledger.failedRenderCalls++;throw error;}
    finally{b.ledger.nativeFrameAdvances+=c.nativeFrames-before;}
    at+=count;
  }
  for(const a of[left,right])for(const i of[0,1,2,n+3,n+4,n+5,n+6,n+7])assert.equal(a[i],guard,'Caller output guards');
  const p={left:left.subarray(3,n+3),right:right.subarray(3,n+3)};peak(p);return p;
}
function loadDsp(c,image){c.loadRam(image.subarray(0x100,0x10100));const dsp=image.subarray(0x10100,0x10180);for(let r=0;r<128;r++)if(r!==0x4c)c.writeDsp(r,dsp[r]);c.writeDsp(0x4c,dsp[0x4c]);}
function authored({voice=0,voices=1,filter=0,gain=0x7f,adsr=null,pitch=0x1000,noise=false,echo=false,pmon=false,ended=false,wrapped=false}={}){
  const image=createSyntheticSpc({voices:8,echo,pmon,noise}),ram=image.subarray(0x100,0x10100),dsp=image.subarray(0x10100,0x10180);
  const mask=voices===8?255:1<<voice;dsp[0x4c]=mask;dsp[0x4d]=echo?mask:0;dsp[0x3d]=noise?mask:0;dsp[0x2d]=pmon?mask&254:0;
  for(let ch=0;ch<8;ch++){dsp[ch*16+2]=(pitch+ch*29)&255;dsp[ch*16+3]=((pitch+ch*29)>>8)&63;dsp[ch*16+5]=adsr?.[0]??0;dsp[ch*16+6]=adsr?.[1]??0;dsp[ch*16+7]=gain;}
  const sample=[0xc0|(filter<<2)|(ended?1:3),0x13,0x57,0x75,0x31,0xfd,0xb9,0x9b,0xdf];
  if(wrapped){ram.set([0xfc,0xff,0xfc,0xff],0x1000);for(let i=0;i<sample.length;i++)ram[(0xfffc+i)&65535]=sample[i];}
  else {ram.set(sample,0x2000);if(ended){ram[0x2000]&=0xfc;ram.set([0xc1|(filter<<2),...sample.slice(1)],0x2009);}}
  return image;
}
function dynamicSpc(options={}){
  const image=createSyntheticSpc(options),ram=image.subarray(0x100,0x10100);
  ram.set([0xe8,0x73,0xc5,1,0x20,0x8f,2,0xf2,0x8f,0x7d,0xf3,0x8f,3,0xf2,0x8f,0x0b,0xf3,0x2d,0xae,0x3f,0,4,0x8f,0x80,0xf1,0x8f,0,0xf1,0xac,1,0x20,0x2f,0xfb],0x200);ram[0x400]=0x6f;return image;
}
function observerSpc(options={}){const image=createSyntheticSpc(options);image.set([0x8f,0,0xf2,0xe8,0x20,0xc4,0xf3,0xbc,0x2f,0xfb],0x300);return image;}
function scenesFor(){
  const scenes=[],add=(name,image,kind='dsp',events=[],partitionInvariant=true)=>scenes.push({name,image,kind,events,partitionInvariant});
  for(let voice=0;voice<8;voice++)add('voice/'+voice,authored({voice}));
  for(let filter=0;filter<4;filter++)add('BRR/filter'+filter,authored({filter}));
  for(const gain of[0x30,0x7f,0x9f,0xbf,0xdf,0xff])add('GAIN/'+gain,authored(), 'dsp',[{frame:101,reg:7,value:gain}]);
  for(const adsr of[[0x8f,0xff],[0x9f,0x5f],[0xff,0xe0],[0xff,0xff]])add('ADSR/'+adsr.join('-'),authored({adsr}), 'dsp',[{frame:1603,reg:0x5c,value:1}]);
  for(const pitch of[0,1,0x1000,0x3fff])add('pitch/'+pitch,authored({pitch}), 'dsp',[{frame:701,reg:2,value:0x71},{frame:701,reg:3,value:8}]);
  for(const clock of[1,8,16,31]){const image=authored({noise:true});image[0x1016c]=(image[0x1016c]&0xe0)|clock;add('noise/'+clock,image);}
  add('eight-voices/echo-PMON',authored({voices:8,echo:true,pmon:true}));
  add('BRR/end-without-loop',authored({ended:true}));add('BRR/wrap-64KiB',authored({wrapped:true}));
  add('direct/RAM-and-register-edits',authored(), 'dsp',[{frame:101,reg:0,value:32},{frame:701,ram:0x2001,value:0x72},{frame:1603,reg:2,value:0x40}]);
  for(const [name,o]of[['dry',{}],['echo',{echo:true}],['noise',{noise:true}],['PMON',{voices:3,pmon:true}],['eight-voices',{voices:8,echo:true,pmon:true,noise:true}]])add('SPC/'+name,createSyntheticSpc(o),'spc');
  add('SPC/live-CPU-RAM-DSP',dynamicSpc({voices:3,echo:true,pmon:true}),'spc',[],false);
  return scenes;
}
async function sceneResult(b,scene,layout){
  const c=await (scene.kind==='dsp'?b.dsp():b.create());
  try{
    if(scene.kind==='dsp')loadDsp(c,scene.image);else c.load(scene.image);
    const left=new Float32Array(bodyFrames),right=new Float32Array(bodyFrames),observations=[];let at=0,next=0,index=0;
    while(at<bodyFrames){
      while(next<scene.events.length&&scene.events[next].frame===at){const e=scene.events[next++];if(e.ram!==undefined)c.loadRam(Uint8Array.of(e.value),e.ram);else c.writeDsp(e.reg,e.value);observations.push({frame:at,...snapshotRecord(c.snapshot())});}
      const end=Math.min(bodyFrames,at+layout[index++%layout.length],scene.events[next]?.frame??Infinity),p=render(b,c,end-at);left.set(p.left,at);right.set(p.right,at);at=end;
    }
    const body={left,right},state=c.snapshot(),probe=render(b,c,probeFrames),after=c.snapshot();assert.equal(state.nativeFrames,bodyFrames);assert.equal(after.nativeFrames,bodyFrames+probeFrames);
    assert(peak(body)>0,scene.name+' must produce nonzero PCM');
    assert.notEqual(sha256(left),sha256(right),scene.name+' must retain independent stereo volume');
    if(scene.name.startsWith('ADSR/'))assert.equal(state.dsp[8],0,'KOFF actually releases the ADSR envelope');
    if(scene.name==='BRR/end-without-loop'){assert(left.subarray(bodyFrames-128).every(v=>v===0),'Non-looping BRR actually ends');assert(state.dsp[0x7c]&1,'BRR end sets ENDX');}
    if(scene.kind==='spc'&&scene.name!=='SPC/live-CPU-RAM-DSP')assert.notEqual(state.ram[0x30],scene.image[0x130],'Real SPC700 counter executes');
    return {body,probe,state,after,observations};
  }finally{c.dispose();}
}
function equalResult(a,b,label){equalPcm(a.body,b.body,label);equalPcm(a.probe,b.probe,label+'/probe');assert.deepEqual(a.state,b.state,label+'/snapshot');assert.deepEqual(a.after,b.after,label+'/after-probe');assert.deepEqual(a.observations,b.observations,label+'/edits');}
async function wrapperChecks(b){
  const actors=[],make=async(dsp=false)=>{const c=await (dsp?b.dsp():b.create());actors.push(c);return c;};
  try{
    assert.equal(SpcPlayerCore,SpcCore);assert.equal(SPC_SAMPLE_RATE,32000);assert.equal(SPC_TRACE_CLOCK_RATE,1024000);
    const a=await make(),ref=await make(),d=await make(true),other=await make(true);assert.equal(a.sampleRate,32000);
    for(const c of[a,d])for(const name of['saveState','loadState','generateStereo','generateStereoView','generateStereoInto'])assert.equal(typeof c[name],'undefined');
    await assert.rejects(SpcCore.create(),/moduleFactory/);assert.throws(()=>a.restart(),/Load/);assert.throws(()=>render(b,a,1),/Load/);
    const image=createSyntheticSpc({echo:true});a.load(image);ref.load(image);image.fill(0);
    const before=a.snapshot();for(const n of[-1,.5,NaN,Infinity,9])assert.throws(()=>a.renderInto(new Float32Array(8),new Float32Array(8),n),RangeError);
    for(const f of[()=>a.renderInto([],new Float32Array(8)),()=>a.renderInto(new Float32Array(8),new Float32Array(8),2,7),()=>a.renderInto(new Float32Array(8),new Float32Array(8),0,-1),()=>a.renderInto(new Float32Array(b.module.HEAPU8.buffer,0,8),new Float32Array(8),0)])assert.throws(f);
    a.renderInto(new Float32Array(1),new Float32Array(1),0);assert.deepEqual(a.snapshot(),before);
    for(const mask of[-1,.5,NaN,256])assert.throws(()=>a.setMuteMask(mask),RangeError);
    for(const input of[null,new Uint8Array(10)])assert.throws(()=>a.load(input));const bad=createSyntheticSpc();bad[0]=0;assert.throws(()=>a.load(bad),/SPC/);
    equalPcm(render(b,a,113),render(b,ref,113),'Invalid/zero calls preserve exact continuation');
    const retained=a.snapshot(),retainedCopy={ram:retained.ram.slice(),dsp:retained.dsp.slice(),nativeFrames:retained.nativeFrames};retained.ram[0x200]=99;retained.dsp[7]=99;assert.notEqual(a.snapshot().ram[0x200],99);assert.notEqual(a.snapshot().dsp[7],99);
    const initial=render(b,a,4097);a.restart();ref.restart();equalPcm(render(b,a,4097),render(b,ref,4097),'Restart owns original SPC bytes and echo RAM');a.reset();ref.load(createSyntheticSpc({echo:true}));equalPcm(render(b,a,1027),render(b,ref,1027),'Reset/reload restore original RAM/DSP/echo, not arbitrary snapshot');assert(retainedCopy.ram[0x200]!==99);assert(peak(initial)>0);
    const source=authored({voice:7}),ram=source.subarray(0x100,0x10100);d.loadRam(ram);ram.fill(99);assert.notEqual(d.snapshot().ram[0x200],99);other.loadRam(Uint8Array.of(7),65535);assert.equal(other.snapshot().ram[65535],7);assert.notEqual(d.snapshot().ram[65535],7);
    d.loadRam(new Uint8Array(),65536);for(const f of[()=>d.loadRam(new Uint8Array(2),65535),()=>d.loadRam(new Uint8Array(1),-1),()=>d.writeDsp(128,0),()=>d.writeDsp(0,256),()=>d.readDsp(-1)])assert.throws(f,RangeError);
    for(let r=0;r<128;r++){d.writeDsp(r,(r*13+17)&255);if(![0x7c].includes(r))assert.equal(d.readDsp(r),(r*13+17)&255,'Actual DSP write/read');}
    d.reset();assert.equal(d.nativeFrames,0);assert(d.snapshot().ram.every(v=>v===0));assert.equal(peak(render(b,d,1027)),0);
    const voices=[];for(let ch=0;ch<8;ch++){d.reset();d.setMuteMask(0);loadDsp(d,authored({voice:ch}));const p=render(b,d,1027);assert(peak(p)>0);voices.push({voice:ch,pcmSha256:pcmDigest(p)});}assert.equal(new Set(voices.map(r=>r.pcmSha256)).size,8,'Eight actual voice register banks alter PCM');
    const gainRows=[];for(const gain of[0x30,0x7f,0x9f,0xbf,0xdf,0xff]){d.reset();loadDsp(d,authored());render(b,d,257);d.writeDsp(7,gain);const p=render(b,d,2049);gainRows.push({gain,pcmSha256:pcmDigest(p),envx:d.readDsp(8)});}assert.equal(new Set(gainRows.map(r=>r.pcmSha256)).size,6,'All six GAIN cases have actual output effects');assert.deepEqual(gainRows.map(r=>r.envx),[48,127,0,0,127,127],'Direct/decreasing/increasing GAIN modes reach their actual envelopes');
    const featureRows=[];for(const feature of['echo','noise','pmon']){d.reset();other.reset();loadDsp(d,authored({voices:8,[feature]:true}));loadDsp(other,authored({voices:8}));const p=render(b,d,4097),r=render(b,other,4097);assert.notEqual(pcmDigest(p),pcmDigest(r),feature+' has an actual output effect');featureRows.push({feature,pcmSha256:pcmDigest(p),plainPcmSha256:pcmDigest(r)});}
    const muteRows=[];for(const mask of[1,2,4,8,16,32,64,128,255]){
      a.setMuteMask(0);ref.setMuteMask(0);const im=createSyntheticSpc({voices:8,pmon:true});a.load(im);ref.load(im);equalPcm(render(b,a,1000),render(b,ref,1000),'Mute anchor');a.setMuteMask(mask);const p=render(b,a,2011),r=render(b,ref,2011);assert.notEqual(pcmDigest(p),pcmDigest(r),'Each voice mute changes actual PCM');assert.deepEqual(a.snapshot(),ref.snapshot(),'Mute retains RAM/DSP/BRR/envelope/PMON phase without echo');
      if(mask===255){assert(p.left.subarray(16).every(v=>v===0));assert(p.right.subarray(16).every(v=>v===0));}
      a.setMuteMask(0);render(b,a,16);render(b,ref,16);equalPcm(render(b,a,257),render(b,ref,257),'Unmute converges after bounded queued output');muteRows.push({mask,pcmSha256:pcmDigest(p)});
    }
    a.load(createSyntheticSpc({echo:true}));render(b,a,4096);a.setMuteMask(255);const echoTail=render(b,a,512);assert(echoTail.left.subarray(16).some(v=>v!==0),'Existing echo RAM tail survives all dry voices muted');a.restart();assert.equal(peak(render(b,a,128)),0,'Restart retains mute');a.setMuteMask(0);
    d.reset();loadDsp(d,authored());const owned=render(b,d,137),copy={left:owned.left.slice(),right:owned.right.slice()};const later=render(b,d,137);assert.notEqual(pcmDigest(later),pcmDigest(copy));equalPcm(owned,copy,'Caller-owned PCM survives scratch reuse');
    const oldHeap=b.module.HEAPU8.buffer,p=b.module._malloc(oldHeap.byteLength);assert(p);try{assert.notEqual(b.module.HEAPU8.buffer,oldHeap,'Real WASM memory growth');render(b,d,31);equalPcm(owned,copy,'Caller-owned PCM survives actual heap growth');}finally{b.module._free(p);}
    d.dispose();d.dispose();equalPcm(owned,copy,'Caller-owned PCM survives disposal');for(const f of[()=>d.renderInto(new Float32Array(0),new Float32Array(0)),()=>d.snapshot(),()=>d.loadRam(new Uint8Array(0)),()=>d.readDsp(0),()=>d.writeDsp(0,0),()=>d.setMuteMask(0),()=>d.reset()])assert.throws(f,/disposed/);
    return {passed:true,voices,gainRows,featureRows,muteRows,echoTailPcmSha256:pcmDigest(echoTail),fixedNativeRate:32000,invalidCallsAndFailedLoadPreserveContinuation:true,sourceBytesAndSnapshotsOwned:true,separateHandleRam:true,dspResetClearsRamAndPhase:true,callerOwnedOutputGuards:true,callerOwnedSurvivesOverwriteRealHeapGrowthDispose:true,snapshotIsCopiedAnalysisOnly:true};
  }finally{for(const c of actors)c.dispose();}
}
async function traceChecks(b){
  const rows=[];
  for(const [name,image]of[['static-eight',createSyntheticSpc({voices:8,echo:true,pmon:true,noise:true})],['dynamic',dynamicSpc({voices:3,echo:true,pmon:true})]]){
    const c=await b.create(),plain=await b.create(),replay=await b.dsp();
    try{
      const frames=3200,layout=[128];c.load(image);plain.load(image);const expected=render(b,plain,frames,layout);c.beginTrace();const captured=render(b,c,frames,layout),trace=c.endTrace();equalPcm(captured,expected,'Tracing preserves original synthesis');assert.equal(trace.clockRate,1024000);assert.equal(trace.initialState.outputDelayFrames,4);assert.equal(trace.durationClocks,frames*32);
      if(name==='dynamic'){assert(trace.events.some((v,i)=>i%4===0&&v%32!==0));assert(trace.events.some((v,i)=>i%4===2&&v===0x2001));assert(trace.events.some((v,i)=>i%4===1&&v===0));}
      const originalTrace=traceRecord(trace),state=c.snapshot();replay.loadTimeline(trace);const prepared=prepareSpcTimeline(trace);sameBytes(prepared.events,trace.events,'Prepared copied events');assert.notEqual(prepared.events,trace.events);equalPcm(render(b,replay,frames,layouts.irregular),expected,'Actual DSP-only timeline preserves original FIFO and subsample writes');assert.deepEqual(replay.getTimelineState(),{loaded:true,positionFrames:frames,totalFrames:frames,ended:true});const ended=render(b,replay,97);assert.equal(peak(ended),0);assert.equal(replay.nativeFrames,frames,'Timeline end does not advance source frame position');
      const replayState=snapshotRecord(replay.snapshot());trace.events.fill(0);trace.initialState.ram.fill(0);trace.initialState.dsp.fill(0);replay.restartTimeline();equalPcm(render(b,replay,frames,[41,127]),expected,'Timeline owns source arrays through mutation and restart');
      c.restart();c.beginRamReadTracking();equalPcm(render(b,c,frames,layout),expected,'RAM discovery preserves synthesis');const mask=c.endRamReadTracking();assert.equal(mask.length,65536);assert(mask.every(v=>v<=1));assert(mask.some(v=>v===1));assert.equal(mask[0x30],0);assert.equal(mask[0x2001],1);const maskDigest=sha256(mask);
      c.restart();c.beginTrace({ramReadMask:mask});mask.fill(0);equalPcm(render(b,c,frames,layout),expected,'Filtered trace owns discovery mask');const filtered=c.endTrace(),filteredRecord=traceRecord(filtered);assert(filtered.events.length<originalTrace.events*4);replay.loadTimeline(filtered);equalPcm(render(b,replay,frames,layouts.irregular),expected,'Filtered trace replay is exact');
      rows.push({name,fixtureSha256:sha256(image),frames,pcmSha256:pcmDigest(expected),snapshot:snapshotRecord(state),trace:originalTrace,filteredTrace:filteredRecord,ramReadMaskSha256:maskDigest,replaySnapshot:replayState});
      const before=replay.getTimelineState();for(const patch of[{version:2},{clockRate:32000},{durationClocks:33},{initialState:{...filtered.initialState,outputDelayFrames:0}},{events:[0,0,128,0]},{events:[9,0,0,1,8,0,0,2]}]){assert.throws(()=>replay.loadTimeline({...filtered,...patch}));assert.deepEqual(replay.getTimelineState(),before);}
      replay.reset();assert.equal(replay.getTimelineState().loaded,false);assert.throws(()=>replay.restartTimeline(),/Load a SNES timeline/);
    }finally{c.dispose();plain.dispose();replay.dispose();}
  }
  const c=await b.create();try{
    const image=observerSpc({voices:3,echo:true,pmon:true}),ref=await b.create();try{
      c.load(image);ref.load(image);c.beginTrace();c.startDspObservation({capacity:16});equalPcm(render(b,c,512),render(b,ref,512),'Observer overflow preserves PCM');const output=new Float64Array(48),count=c.drainDspEventsInto(output),lost=c.takeDspEventOverflow();assert.equal(count,16);assert(lost>0);assert.equal(c.takeDspEventOverflow(),0);assert.equal(c.drainDspEventsInto(output),0);const trace=c.endTrace(),writes=[];for(let i=0;i<trace.events.length;i+=4)if(trace.events[i+1]===0)writes.push(trace.events[i],trace.events[i+2],trace.events[i+3]);assert.deepEqual(Array.from(output),writes.slice(0,48));assert.equal(writes.length/3,count+lost);
      const registers=new Uint8Array(128);c.readDspRegistersInto(registers);sameBytes(registers,c.snapshot().dsp,'Live copied register observer');c.stopDspObservation();equalPcm(render(b,c,257),render(b,ref,257),'Stopping observer preserves continuation');
      c.startDspObservation({capacity:2048});const events=new Float64Array(6144);equalPcm(render(b,c,128),render(b,ref,128),'Late observer preserves continuation');const lateCount=c.drainDspEventsInto(events);assert(lateCount>0);assert.equal(c.takeDspEventOverflow(),0);for(let i=0;i<lateCount;i++)assert(events[i*3]>=769*32&&events[i*3]<=c.nativeFrames*32);rows.push({name:'observer',count,lost,eventsSha256:sha256(output),lateCount,lateEventsSha256:sha256(events.subarray(0,lateCount*3)),registersSha256:sha256(registers)});
      c.restart();c.beginTrace({maxEvents:1});assert.throws(()=>render(b,c,128),/trace limit exceeded/);assert.throws(()=>c.endTrace(),/trace limit exceeded/);c.restart();c.beginTrace();render(b,c,128);assert(c.endTrace().events.length>4);
      c.restart();c.setMuteMask(1);assert.throws(()=>c.beginTrace(),/unmuted/);c.setMuteMask(0);c.beginRamReadTracking();c.setMuteMask(1);c.setMuteMask(0);render(b,c,128);assert.throws(()=>c.endRamReadTracking(),/unmuted/);
    }finally{ref.dispose();}
  }finally{c.dispose();}
  return {passed:true,rows,exactSubsampleTraceAndFourFrameFifo:true,readDiscoveryAndFilteredTrace:true,observerOverflowAndLateAbsoluteClocks:true,traceFailureAndChangedMuteDiscoveryRejected:true,timelineOwnsCopiesAndEndsWithSilence:true};
}
async function main(){
  const args=argumentsFor(process.argv.slice(2));if(!args){console.log(usage);return;}
  const legacy=await backend(args['--legacy-dir']),sdk=await backend(args['--sdk-dir']);assert.deepEqual(sdk.metadata.exports,legacy.metadata.exports,'Exact deployed C ABI export set');
  const wrappers=['web/spc.js','docs/js/spc.js'];sameBytes(await readFile(resolve(root,wrappers[0])),await readFile(resolve(root,wrappers[1])),'Unchanged web/docs SPC wrapper sync');
  const report={schemaVersion:1,passed:false,deviceOpened:false,startedAt:new Date().toISOString(),sampleRate:32000,traceClockRate:1024000,bodyFrames,probeFrames,layouts,inputs:{legacy:legacy.metadata,sdk:sdk.metadata,checker:await inputFile(fileURLToPath(import.meta.url)),wrappers:await Promise.all(wrappers.map(p=>inputFile(resolve(root,p)))),helpers:await Promise.all(['web/spc_test_fixture.mjs'].map(p=>inputFile(resolve(root,p))))},method:'Actual generated JS/WASM through SpcCore and SnesDspCore. Exact stereo Float32 PCM, copied RAM/DSP/nativeFrames, real trace/RAM discovery/observation/timeline; original synthetic SPC/BRR only. No tolerance or device.',limits:['Fixed native 32000 Hz only; no constructor clock, invented VgmPlayer, save/load-state, browser scheduling, resampler, Synth, native backend, physical hardware or listening claim.','snapshot() contains copied RAM/DSP analysis bytes and nativeFrames, not CPU registers, complete DSP phase, queued output or a complete restorable state. Restart/reset/reload use the original loaded file; DSP reset clears its RAM.','Mute is output-only: sources, envelopes, BRR and PMON advance; already queued output and written echo tails remain. Exact mute convergence is tested after a bounded 16-frame settling interval.','Upstream deferred DSP catch-up can make active-BRR CPU mutations partition-sensitive. Dynamic CPU scenes are compared between builds using each identical partition; no cross-partition equality is asserted for that scene. Captured canonical-128 traces replay with different partitions.','Bounded original material covers all eight voices, BRR filters/end/loop/address wrap, direct GAIN and four envelope modes, ADSR/KOFF, pitch, noise, stereo/echo/PMON, CPU writes, trace limits, masks, observation overflow, timeline ownership/end/restart and real WASM heap growth.'],wrapperChecks:{},traceChecks:{},cases:[],maximumDifference:0};
  report.wrapperChecks.legacy=await wrapperChecks(legacy);report.wrapperChecks.sdk=await wrapperChecks(sdk);assert.deepEqual(report.wrapperChecks.legacy,report.wrapperChecks.sdk,'Wrapper positive results');
  report.traceChecks.legacy=await traceChecks(legacy);report.traceChecks.sdk=await traceChecks(sdk);assert.deepEqual(report.traceChecks.legacy,report.traceChecks.sdk,'Trace/discovery/observer/timeline results');
  const scenes=scenesFor(),regularCases=new Map();for(const scene of scenes){let regular;for(const [layoutName,layout]of Object.entries(layouts)){
    const x=await sceneResult(legacy,scene,layout),y=await sceneResult(sdk,scene,layout);equalResult(y,x,scene.name+'/'+layoutName);if(regular&&scene.partitionInvariant)equalResult(x,regular,scene.name+'/partition invariance');else if(!regular)regular=x;
    if(layoutName==='regular')regularCases.set(scene.name,x);
    report.cases.push({name:scene.name,kind:scene.kind,layout:layoutName,fixtureSha256:sha256(scene.image),fixtureBytes:scene.image.length,bodyFrames,probeFrames,partitionInvariant:scene.partitionInvariant,peak:peak(x.body),pcmSha256:pcmDigest(x.body),probePcmSha256:pcmDigest(x.probe),snapshot:snapshotRecord(x.state),afterProbe:snapshotRecord(x.after),edits:x.observations,maximumDifference:0});
  }}
  const filterCases=[0,1,2,3].map(n=>regularCases.get('BRR/filter'+n));assert.equal(new Set(filterCases.map(r=>pcmDigest(r.body))).size,4,'All four BRR filters actually alter PCM');equalPcm(regularCases.get('BRR/wrap-64KiB').body,regularCases.get('BRR/filter0').body,'Wrapped BRR decodes identical sample bytes');
  assert.deepEqual(legacy.ledger,sdk.ledger,'Identical counted render work');report.scenarios=scenes.length;report.renderExecutions=report.cases.length*2;report.frameCounts={legacy:legacy.ledger,sdk:sdk.ledger};report.totalDeliveredOutputStereoFrames=legacy.ledger.deliveredOutputStereoFrames+sdk.ledger.deliveredOutputStereoFrames;report.totalNativeFrameAdvances=legacy.ledger.nativeFrameAdvances+sdk.ledger.nativeFrameAdvances;
  report.frameCountScope='All bounded nonzero PCM render requests go through one counter, including wrapper/trace positives, scenarios/probes, failed attempts and timeline-end silence. Direct invalid/zero validation-only calls never entering native rendering are excluded. Requested frames, successfully copied output frames and native position advances are reported separately. Internal 1024-frame chunks are not added again; failed trace rendering may advance native state before rejecting delivery, and ended timeline silence does not advance nativeFrames.';
  report.passed=true;report.completedAt=new Date().toISOString();if(args['--out']){await mkdir(dirname(args['--out']),{recursive:true});await writeFile(args['--out'],JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({passed:true,scenarios:report.scenarios,cases:report.cases.length,totalDeliveredOutputStereoFrames:report.totalDeliveredOutputStereoFrames,totalNativeFrameAdvances:report.totalNativeFrameAdvances,...(args['--out']?{out:args['--out']}:{})},null,2));
}
main().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
