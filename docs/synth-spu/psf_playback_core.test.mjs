// SPDX-License-Identifier: BSD-3-Clause
// Numeric-only PSF machine tests: no AudioContext or output device is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPsfPlaybackCore} from './psf_playback_core.js';
import {preparePsfSongSource} from './psf_song_source.js';
import {readPsfFileSet} from '../playground/playground_ps1_psf.js';
import createPsfPlayerModule from '../generated/psf-player/psf_player.js';
import createSpuModule from '../generated/ps1_spu_wasm.js';
import {Ps1Spu} from '../../tetorica_src/runtime/ps1_spu.js';
import {createPsfPlaybackFixture,createPsfSpuFeatureFixture,PSF_FIXTURE_SPU_ADDRESS} from '../../test/helpers/spu_psf_playback_fixture.mjs';

const wasmBinary=await readFile(new URL('../generated/psf-player/psf_player.wasm',import.meta.url));
const spuWasmBinary=await readFile(new URL('../generated/ps1_spu_wasm.wasm',import.meta.url));
const fixture=createPsfPlaybackFixture();
const standalone=await preparePsfSongSource(await readPsfFileSet(fixture.standaloneFiles),'standalone.psf');
const mini=await preparePsfSongSource(await readPsfFileSet(fixture.files),'Demo/track.minipsf');
const create=(image=standalone,options={})=>createPsfPlaybackCore({image,wasmBinary,...options});
const peak=samples=>samples.reduce((value,sample)=>Math.max(value,Math.abs(sample)),0);
const crossings=samples=>{
  let count=0;
  for(let frame=401;frame<samples.length/2;frame++)if(samples[(frame-1)*2]<=0&&samples[frame*2]>0)count++;
  return count;
};

test('original PSF MIPS program executes and produces finite stereo PCM',async()=>{
  const core=await create();
  try {
    assert.equal(core.sampleRate,44100);
    assert.deepEqual(core.backend,{abi:3,engine:'play-hle+mame-ps1-spu',sampleRate:44100});
    assert.ok(Object.isFrozen(core.backend),'the backend identity is read-only metadata');
    const samples=core.render(8820);
    assert.equal(samples.length,17640);
    assert.ok(samples.every(Number.isFinite));
    assert.ok(peak(samples)>.001,'CPU sample transfer and key-on must produce sound');
    assert.ok(peak(samples)<=1);
    const left=samples.filter((_,index)=>!(index&1)),right=samples.filter((_,index)=>index&1);
    assert.ok(peak(left)>peak(right)*1.5,'authored L/R volume difference survives execution');
    assert.ok(crossings(samples)>20,'the test contains a repeating ADPCM cycle');
    assert.equal(core.position,.2);
  } finally {core.dispose();}
});

test('MiniPSF instruction overlay changes the executed sample pitch',async()=>{
  const plain=await create(),patched=await create(mini);
  try {
    const a=plain.render(8820),b=patched.render(8820);
    assert.ok(peak(a)>.001&&peak(b)>.001);
    assert.ok(crossings(b)>crossings(a)*1.15,'0x1400 patch must run faster than original 0x1000');
    assert.notDeepEqual(a,b);
  } finally {plain.dispose();patched.dispose();}
});

test('render subdivision preserves samples and separate machines keep independent state',async()=>{
  const whole=await create(),split=await create();
  try {
    const expected=whole.render(8193),actual=new Float32Array(expected.length);
    let frames=0;
    while(frames<8193) {
      const count=Math.min(127,8193-frames);
      actual.set(split.render(count),frames*2);frames+=count;
    }
    assert.deepEqual(actual,expected);
    whole.dispose();
    assert.ok(peak(split.render(1025))>.001,'disposing one machine cannot stop another');
  } finally {whole.dispose();split.dispose();}
});

test('machine validates RAM, entry point, timing, render sizes and disposal',async()=>{
  await assert.rejects(create({...standalone,ram:new Uint8Array(8)}),/2 MiB RAM/);
  await assert.rejects(create({...standalone,pc:0x80010001}),/entry point/);
  await assert.rejects(create({...standalone,pc:0x80030000}),/entry point/);
  await assert.rejects(create({...standalone,refresh:55}),/refresh/);
  const core=await create();
  for(const frames of [0,-1,1.5,44101])assert.throws(()=>core.render(frames),/render size/);
  assert.equal(core.render(1).length,2);
  core.dispose();core.dispose();
  assert.throws(()=>core.render(1),/disposed/);
});

test('abort cancels creation and further rendering without an audio device',async()=>{
  const early=new AbortController();early.abort();
  await assert.rejects(create(standalone,{signal:early.signal}),{name:'AbortError'});
  const late=new AbortController(),core=await create(standalone,{signal:late.signal});
  late.abort();
  assert.throws(()=>core.render(1),{name:'AbortError'});
  core.dispose();
});

test('stale or mismatched CPU/SPU WASM is rejected before a machine is created',async()=>{
  for(const replacement of [
    {abi:1,model:1},
    {abi:2,model:1},
    {abi:3,model:0},
    {abi:undefined,model:1},
  ]) {
    let allocationAttempt=false;
    await assert.rejects(create(standalone,{moduleOptions:{onRuntimeInitialized(){
      this._psf_abi_version=replacement.abi===undefined?undefined:()=>replacement.abi;
      this._psf_spu_model=()=>replacement.model;
      this._malloc=()=>{allocationAttempt=true;throw new Error('Native allocation reached');};
    }}}),/components are out of date/);
    assert.equal(allocationAttempt,false,'ABI validation must run before native allocation');
  }
});

test('a supplied invalid WASM binary is rejected without loading a different file',async()=>{
  // Invalid WASM version, rather than a missing path: this specifically proves
  // the Emscripten factory honors wasmBinary instead of silently using disk.
  await assert.rejects(create(standalone,{wasmBinary:Uint8Array.of(0,97,115,109,0,0,0,0)}),/wasm|WebAssembly|Compile|Aborted/i);
});

const rms=samples=>Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length);
const featureImage=async fixture=>preparePsfSongSource(await readPsfFileSet(fixture.standaloneFiles),'spu-conformance.psf');

/** Private C diagnostics stay in numerical tests, outside the public player API. */
async function nativeMachine(fixture,{traceLimit=4096}={}) {
  const image=await featureImage(fixture);
  const module=await createPsfPlayerModule({wasmBinary,print:()=>{},printErr:()=>{}});
  assert.equal(module._psf_abi_version(),3,'PSF sound bridge ABI must identify the unified fixed core');
  assert.equal(module._psf_spu_model(),1,'CPU playback must use the same MAME-derived SPU as Synth');
  const input=module._malloc(image.ram.length),coverage=module._malloc(image.coverage.length);
  let handle;
  try {
    module.HEAPU8.set(image.ram,input);module.HEAPU8.set(image.coverage,coverage);
    handle=module._psf_create(input,coverage,image.pc,image.gp,image.sp,image.refresh??60);
  } finally {module._free(input);module._free(coverage);}
  assert.ok(handle,`PSF machine creation: ${module.UTF8ToString(module._psf_last_error())}`);
  assert.equal(module._psf_trace_start(handle,traceLimit),1);
  const output=module._malloc(44100*2*4),scratch=module._malloc(16);
  const readMemory=(reader,address,length)=>{
    const ptr=module._malloc(length);
    try {assert.equal(reader(handle,address,ptr,length),1);return module.HEAPU8.slice(ptr,ptr+length);}
    finally {module._free(ptr);}
  };
  return {
    module,handle,
    render(frames) {
      assert.equal(module._psf_render(handle,output,frames),frames,module.UTF8ToString(module._psf_last_error()));
      return module.HEAPF32.slice(output/4,output/4+frames*2);
    },
    trace() {
      assert.equal(module._psf_trace_overflow(handle),0,'conformance trace must be complete');
      const events=[];
      for(let index=0;index<module._psf_trace_count(handle);index++) {
        assert.equal(module._psf_trace_read(handle,index,scratch),1);
        const view=new DataView(module.HEAPU8.buffer,scratch,16);
        events.push({frame:view.getUint32(0,true),kind:view.getUint32(4,true),address:view.getUint32(8,true),value:view.getUint32(12,true)});
      }
      return events;
    },
    read:offset=>module._psf_spu_read(handle,offset)>>>0,
    spuRam:(address,length)=>readMemory(module._psf_spu_read_ram,address,length),
    cpuRam:(address,length)=>readMemory(module._psf_cpu_read_ram,address,length),
    get frames(){return module._psf_spu_frames(handle);},
    dispose(){module._psf_destroy(handle);module._free(output);module._free(scratch);},
  };
}

/**
 * Re-execute CPU bus events at their native-frame boundary with the ordinary
 * standalone Synth core. PCM equality cannot be satisfied by the old Play!
 * SPU, which ignored master volumes, Noise and PMON during rendering.
 */
async function compareOrdinaryCore(fixture,frames=4096) {
  const machine=await nativeMachine(fixture);
  const ordinary=await Ps1Spu.create({moduleFactory:createSpuModule,moduleOptions:{wasmBinary:spuWasmBinary,print:()=>{},printErr:()=>{}}});
  try {
    const actual=machine.render(frames),events=machine.trace();
    assert.equal(machine.frames,frames,'CPU bridge generates exactly the requested native frames');
    assert.deepEqual(events.filter(event=>event.kind===1).map(event=>[event.address,event.value]),fixture.registerWrites,
      'the original MIPS program executes every authored register write without truncation or loss');
    assert.ok(events.some(event=>event.kind===1&&[0x188,0x18a].includes(event.address)&&event.value),'fixture CPU reaches key-on');
    const left=new Float32Array(frames),right=new Float32Array(frames);
    let at=0;
    for(const event of events) {
      assert.ok(event.frame>=at&&event.frame<frames,'trace events precede the corresponding rendered sample');
      if(event.frame>at){ordinary.renderInto(left,right,event.frame-at,at);at=event.frame;}
      if(event.kind===1) {
        // CPU PIO is drained by the bus scheduler; kind 2 records its actual
        // RAM writes. Replaying the FIFO as well would upload bytes twice.
        if(event.address!==0x1a8)ordinary.write(event.address,event.value);
      } else if(event.kind===2)ordinary.loadRam(Uint8Array.of(event.value&255,event.value>>>8),event.address);
      else assert.equal(event.kind,3,'only register writes and SPU RAM transfers are traced');
    }
    if(at<frames)ordinary.renderInto(left,right,frames-at,at);
    const expected=new Float32Array(frames*2);
    for(let frame=0;frame<frames;frame++){expected[frame*2]=left[frame];expected[frame*2+1]=right[frame];}
    assert.deepEqual(actual,expected,'PSF CPU bus and ordinary Synth SPU must produce sample-exact PCM');
    assert.deepEqual(machine.spuRam(0,0x80000),ordinary.readRam(),'sample data and hardware capture RAM must match');
    for(const offset of [0x180,0x182,0x184,0x186,0x190,0x192,0x194,0x196,0x198,0x19a,0x1aa])
      assert.equal(machine.read(offset),ordinary.read(offset),`same final SPU register +0x${offset.toString(16)}`);
    const masterRead=new DataView(machine.cpuRam(fixture.mailboxAddress+4,4).buffer).getUint32(0,true);
    const firstMaster=events.find(event=>event.kind===1&&event.address===0x180).value;
    const firstRight=events.find(event=>event.kind===1&&event.address===0x182).value;
    assert.equal(masterRead,((firstRight<<16)|firstMaster)>>>0,'MIPS SW/LW preserves both 16-bit SPU register halves');
    return {samples:actual,events,source:machine.cpuRam(fixture.cpuSourceAddress,fixture.adpcm.length),
      readback:machine.cpuRam(fixture.cpuReadbackAddress,fixture.adpcm.length),
      mailbox:machine.cpuRam(fixture.mailboxAddress,48),status:machine.read(0x1ae)};
  } finally {ordinary.dispose();machine.dispose();}
}

test('PIO and both DMA4 directions feed the ordinary SPU with sample-exact stereo PCM',async()=>{
  for(const transfer of ['pio','dma-roundtrip']) {
    const authored=createPsfSpuFeatureFixture({transfer,mainLeft:0x3fff,mainRight:0x2000});
    const result=await compareOrdinaryCore(authored);
    assert.ok(peak(result.samples)>.001,`${transfer}: CPU reaches audible numerical output`);
    const writes=result.events.filter(event=>event.kind===2);
    assert.equal(writes.length,authored.adpcm.length/2,`${transfer}: every uploaded halfword is traced`);
    const source=new DataView(authored.adpcm.buffer);
    assert.deepEqual(writes.map(event=>[event.address,event.value]),Array.from({length:authored.adpcm.length/2},(_,index)=>
      [PSF_FIXTURE_SPU_ADDRESS+index*2,source.getUint16(index*2,true)]),`${transfer}: correct little-endian sample bytes reach sequential RAM addresses`);
    if(transfer==='dma-roundtrip') {
      assert.deepEqual(result.source,authored.adpcm);
      assert.deepEqual(result.readback,authored.adpcm,'DMA4 SPU → CPU returns every uploaded byte');
      assert.equal(result.events.filter(event=>event.kind===3).length,authored.adpcm.length/2);
    }
  }
});

test('MIPS byte accesses preserve the PS1 SPU bus rules without changing ordinary RAM writes',async()=>{
  const result=await compareOrdinaryCore(createPsfSpuFeatureFixture({byteBus:true,mainLeft:0x1234,mainRight:0x3fff}));
  const mailbox=new DataView(result.mailbox.buffer);
  assert.equal(mailbox.getUint32(24,true),0x78,'LBU even reads the low byte after even SB wrote the low 16 bits');
  assert.equal(mailbox.getUint32(28,true),0x56,'LBU odd reads the high byte of the same SPU register');
  assert.equal(mailbox.getUint32(32,true),0x3fff,'odd SB leaves the adjacent right-volume register unchanged');
  assert.equal(mailbox.getUint32(36,true),0x3fff5678,'LW combines both hardware halfwords after byte writes');
  assert.equal(mailbox.getUint32(40,true),0x78,'the same MIPS SB to CPU RAM writes only its low byte');
});

test('stopped transfer mode keeps PIO FIFO data queued until manual transfer is enabled',async()=>{
  const fixture=createPsfSpuFeatureFixture({transfer:'stopped-pio'}),machine=await nativeMachine(fixture);
  try {
    machine.render(1);
    const before=machine.trace();
    assert.equal(before.filter(event=>event.kind===1&&event.address===0x1a8).length,fixture.adpcm.length/2);
    assert.equal(before.filter(event=>event.kind===2).length,0,'frame boundaries cannot flush a stopped FIFO');
    assert.deepEqual(machine.spuRam(PSF_FIXTURE_SPU_ADDRESS,fixture.adpcm.length),new Uint8Array(fixture.adpcm.length));
    const samples=machine.render(4095);
    assert.deepEqual(machine.spuRam(PSF_FIXTURE_SPU_ADDRESS,fixture.adpcm.length),fixture.adpcm);
    assert.ok(peak(samples)>.001,'entering manual mode transfers queued data and lets the CPU voice play');
  } finally {machine.dispose();}
  await compareOrdinaryCore(fixture);
});

test('unsupported fixed-core modes fail explicitly and cannot resume partial rendering',async()=>{
  for(const [settings,reason] of [
    [{steps:[{delay:4096,writes:[[0x180,0x8000]]}]},/volume sweeps/],
    [{steps:[{delay:4096,writes:[[0x1ac,0]]}]},/RAM-control/],
    [{steps:[{delay:4096,writes:[[0x006,0x0401]]}]},/ADPCM start\/repeat/],
    ...[0x01000001,0x01000401,0x01000203].map(dmaWriteControl=>
      [{transfer:'dma-roundtrip',dmaWriteControl},/incrementing request-mode/]),
  ]) {
    const image=await featureImage(createPsfSpuFeatureFixture(settings));
    const core=await create(image);
    try {
      assert.throws(()=>core.render(4096),reason);
      assert.throws(()=>core.render(1),reason,'a failed machine cannot silently resume after a partial render');
    } finally {core.dispose();}
  }
});

test('CPU master-volume writes change the actual mix, including a later mute and restore',async()=>{
  const full=await compareOrdinaryCore(createPsfSpuFeatureFixture());
  const quarter=await compareOrdinaryCore(createPsfSpuFeatureFixture({mainLeft:0x1000,mainRight:0x1000}));
  const gain=rms(quarter.samples)/rms(full.samples);
  assert.ok(gain>.24&&gain<.26,`master 0x1000 / 0x3fff must scale PCM, got ${gain}`);
  const dynamic=await compareOrdinaryCore(createPsfSpuFeatureFixture({steps:[
    {delay:65535,writes:[[0x180,0],[0x182,0]]},
    {delay:65535,writes:[[0x180,0x3fff],[0x182,0x3fff]]},
  ]}));
  const master=dynamic.events.filter(event=>event.kind===1&&event.address===0x180);
  assert.equal(master.length,3);
  const muted=dynamic.samples.subarray((master[1].frame+2)*2,master[2].frame*2);
  assert.ok(muted.length>32,'the authored CPU wait gives a measurable muted interval');
  assert.equal(peak(muted),0,'master mute applies before the next frame, not just to register readback');
  assert.ok(peak(dynamic.samples.subarray((master[2].frame+2)*2))>.001,'restoring master volume restores sound');
});

test('shared Noise clock changes the deterministic noise output rather than sample pitch',async()=>{
  const slow=await compareOrdinaryCore(createPsfSpuFeatureFixture({noise:true,noiseClock:8}));
  const fast=await compareOrdinaryCore(createPsfSpuFeatureFixture({noise:true,noiseClock:48}));
  const fastRepeat=await compareOrdinaryCore(createPsfSpuFeatureFixture({noise:true,noiseClock:48,pitch:0x2000}));
  assert.ok(peak(slow.samples)>.001&&peak(fast.samples)>.001);
  assert.notDeepEqual(slow.samples,fast.samples,'SPUCNT Noise clock must affect actual PCM');
  assert.deepEqual(fast.samples,fastRepeat.samples,'the shared Noise generator is independent of voice sample pitch');
  assert.ok(crossings(fast.samples)>crossings(slow.samples),'faster Noise clock produces more zero crossings');
  const moving=await compareOrdinaryCore(createPsfSpuFeatureFixture({noise:true,noiseClock:8,steps:[
    {delay:65535,writes:[[0x1aa,0xc000|(48<<8)]]},
  ]}));
  const change=moving.events.find(event=>event.kind===1&&event.address===0x1aa&&event.value===(0xc000|(48<<8)));
  assert.ok(change&&change.frame>0);
  assert.deepEqual(moving.samples.subarray(0,change.frame*2),slow.samples.subarray(0,change.frame*2));
  assert.notDeepEqual(moving.samples.subarray(change.frame*2),slow.samples.subarray(change.frame*2),'changing the clock affects a held Noise voice');
  assert.equal(moving.events.filter(event=>event.kind===1&&[0x188,0x18a].includes(event.address)&&event.value).length,1,'clock change does not require another key-on');
});

test('PMON modulates carriers in both 16-bit masks, including CH23 → CH24',async()=>{
  for(const carrier of [1,23]) {
    const dry=await compareOrdinaryCore(createPsfSpuFeatureFixture({pair:true,pmon:false,carrier}));
    const modulated=await compareOrdinaryCore(createPsfSpuFeatureFixture({pair:true,pmon:true,carrier}));
    assert.ok(peak(dry.samples)>.001&&peak(modulated.samples)>.001);
    const difference=Float32Array.from(dry.samples,(value,index)=>value-modulated.samples[index]);
    assert.ok(rms(difference)>.001,`PMON must change CH${carrier+1} carrier phase/pitch while source direct volume is zero`);
    const offset=carrier>=16?0x192:0x190;
    assert.ok(modulated.events.some(event=>event.kind===1&&event.address===offset&&event.value===(1<<(carrier%16))));
  }
});

test('Room reverb has a nonzero tail, respects return volumes and follows main volume',async()=>{
  const common={reverb:true,oneShot:true};
  const wet=await compareOrdinaryCore(createPsfSpuFeatureFixture({...common,returnLeft:0x4000,returnRight:0x2000}),22050);
  const noReturn=await compareOrdinaryCore(createPsfSpuFeatureFixture({...common,returnLeft:0,returnRight:0}),22050);
  const quarter=await compareOrdinaryCore(createPsfSpuFeatureFixture({...common,returnLeft:0x1000,returnRight:0x0800}),22050);
  const muted=await compareOrdinaryCore(createPsfSpuFeatureFixture({...common,mainLeft:0,mainRight:0}),22050);
  const from=2048*2;
  assert.equal(peak(noReturn.samples.subarray(from)),0,'one-shot sample has finished before the tail measurement');
  assert.ok(peak(wet.samples.subarray(from))>1e-5,'shared Room processing leaves a measurable tail');
  const gain=rms(quarter.samples.subarray(from))/rms(wet.samples.subarray(from));
  assert.ok(gain>.23&&gain<.27,`return volume must scale the wet signal, got ${gain}`);
  assert.equal(peak(muted.samples),0,'main volume also attenuates the reverb return');
});

test('SPU sample-fetch IRQ reaches CPU I_STAT without being consumed by HLE',async()=>{
  const fixture=createPsfSpuFeatureFixture({irq:true});
  const result=await compareOrdinaryCore(fixture);
  const observed=new DataView(result.mailbox.buffer).getUint32(0,true);
  assert.ok(result.status&0x40,'SPUSTAT IRQ flag is asserted by the sample read');
  assert.ok(observed&0x200,'the original CPU program observes SPU IRQ9 in I_STAT');
  const lifecycle=await compareOrdinaryCore(createPsfSpuFeatureFixture({irq:true,irqLifecycle:true}));
  const mailbox=new DataView(lifecycle.mailbox.buffer);
  assert.ok(mailbox.getUint32(0,true)&0x200,'CPU sees the initial interrupt');
  assert.ok(mailbox.getUint32(8,true)&0x40,'SPUSTAT records the originating sample-fetch IRQ');
  assert.ok(mailbox.getUint32(12,true)&0x200,'disabling SPUCNT IRQ leaves CPU I_STAT latched');
  assert.equal(mailbox.getUint32(16,true)&0x40,0,'disabling SPUCNT IRQ clears the SPU source');
  assert.equal(mailbox.getUint32(20,true)&0x200,0,'only the CPU I_STAT acknowledgement clears its latch');
});
