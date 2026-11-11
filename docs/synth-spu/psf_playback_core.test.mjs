// SPDX-License-Identifier: BSD-3-Clause
// Numeric-only PSF machine tests: no AudioContext or output device is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
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
    assert.deepEqual(core.backend,{abi:4,engine:'play-hle+mame-ps1-spu',sampleRate:44100});
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
  for(const frames of [0,-1,1.5,44101])assert.throws(()=>core.renderWithVoices(frames),/render size/);
  assert.equal(core.render(1).length,2);
  core.dispose();core.dispose();
  assert.throws(()=>core.render(1),/disposed/);
  assert.throws(()=>core.renderWithVoices(1),/disposed/);
});

test('abort cancels creation and further rendering without an audio device',async()=>{
  const early=new AbortController();early.abort();
  await assert.rejects(create(standalone,{signal:early.signal}),{name:'AbortError'});
  const late=new AbortController(),core=await create(standalone,{signal:late.signal});
  late.abort();
  assert.throws(()=>core.render(1),{name:'AbortError'});
  assert.throws(()=>core.renderWithVoices(1),{name:'AbortError'});
  core.dispose();
});

test('stale or mismatched CPU/SPU WASM is rejected before a machine is created',async()=>{
  for(const replacement of [
    {abi:1,model:1},
    {abi:2,model:1},
    {abi:3,model:1},
    {abi:4,model:0},
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
  assert.equal(module._psf_abi_version(),4,'PSF sound bridge ABI must identify the unified fixed core');
  assert.equal(module._psf_spu_model(),1,'CPU playback must use the same MAME-derived SPU as Synth');
  const input=module._malloc(image.ram.length),coverage=module._malloc(image.coverage.length);
  let handle;
  try {
    module.HEAPU8.set(image.ram,input);module.HEAPU8.set(image.coverage,coverage);
    handle=module._psf_create(input,coverage,image.pc,image.gp,image.sp,image.refresh??60);
  } finally {module._free(input);module._free(coverage);}
  assert.ok(handle,`PSF machine creation: ${module.UTF8ToString(module._psf_last_error())}`);
  assert.equal(module._psf_trace_start(handle,traceLimit),1);
  const output=module._malloc(44100*2*4),scratch=module._malloc(16);let stems=0,stemFrames=0;
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
    renderWithVoices(frames) {
      if(frames>stemFrames) {
        if(stems)module._free(stems);stems=module._malloc(frames*48*4);stemFrames=frames;
        assert.ok(stems,'voice capture output allocation');
      }
      assert.equal(module._psf_render_stems(handle,output,stems,frames),frames,module.UTF8ToString(module._psf_last_error()));
      return {pcm:module.HEAPF32.slice(output/4,output/4+frames*2),voices:module.HEAPF32.slice(stems/4,stems/4+frames*48)};
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
    registers:()=>Uint16Array.from({length:512},(_,index)=>module._psf_spu_read(handle,index*2)),
    gates:()=>module._psf_spu_key_gates(handle)>>>0,
    active:()=>module._psf_spu_active_mask(handle)>>>0,
    spuRam:(address,length)=>readMemory(module._psf_spu_read_ram,address,length),
    cpuRam:(address,length)=>readMemory(module._psf_cpu_read_ram,address,length),
    get frames(){return module._psf_spu_frames(handle);},
    dispose(){module._psf_destroy(handle);module._free(output);module._free(scratch);if(stems)module._free(stems);},
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

const voiceSamples=(voices,channel)=>{
  const output=new Float32Array(voices.length/24);
  for(let frame=0;frame<voices.length/48;frame++){output[frame*2]=voices[frame*48+channel*2];output[frame*2+1]=voices[frame*48+channel*2+1];}
  return output;
};
const clamp16=value=>Math.max(-32768,Math.min(32767,value));
const mainGain=0x7ffe/1073741824;

function allVoiceFixture({saturating=false}={}) {
  const writes=[];
  for(let channel=0;channel<24;channel++) {
    const volume=saturating?(channel<12?0x3fff:0x4001):0x0100;
    const pitch=saturating?0x1000:0x0600+channel*0x0080;
    for(const [offset,value]of [[0,volume],[2,saturating?volume:0x0080],[4,pitch],[6,PSF_FIXTURE_SPU_ADDRESS/8],
      [8,0x000f],[10,0x1fc0],[14,PSF_FIXTURE_SPU_ADDRESS/8]])writes.push([channel*16+offset,value]);
  }
  writes.push([0x188,0xffff],[0x18a,0xff]);
  return createPsfSpuFeatureFixture({steps:[{delay:4096,writes}]});
}

/** Tap collection must leave the whole machine identical, not merely audible. */
async function compareVoiceTap(fixture,frames=4096) {
  const normal=await nativeMachine(fixture),tapped=await nativeMachine(fixture);
  try {
    const pcm=normal.render(frames),result=tapped.renderWithVoices(frames);
    assert.deepEqual(result.pcm,pcm,'observing voices cannot change full-song PCM');
    assert.equal(result.voices.length,frames*48);assert.ok(result.voices.every(Number.isFinite));
    assert.deepEqual(tapped.registers(),normal.registers(),'all 512 register views remain identical');
    assert.deepEqual(tapped.spuRam(0,0x80000),normal.spuRam(0,0x80000),'sample and decoded-capture RAM remain identical');
    assert.deepEqual(tapped.cpuRam(0,0x200000),normal.cpuRam(0,0x200000),'CPU RAM and IRQ/DMA mailbox state remain identical');
    assert.deepEqual(tapped.trace(),normal.trace(),'CPU SPU writes and transfer events remain at the same native frames');
    assert.equal(tapped.gates(),normal.gates());assert.equal(tapped.active(),normal.active());assert.equal(tapped.frames,normal.frames);
    const registers=tapped.registers(),active=tapped.active(),gates=tapped.gates(),events=tapped.trace();
    assert.deepEqual(tapped.renderWithVoices(257).pcm,normal.render(257),'continued CPU/DSP playback stays identical after a tap read');
    return {...result,registers,active,gates,events};
  } finally {normal.dispose();tapped.dispose();}
}

test('24 simultaneous dry voice outputs reconstruct the unclipped full mix while every voice continues',async()=>{
  const result=await compareVoiceTap(allVoiceFixture(),8192);
  assert.equal(result.active,0xffffff);assert.equal(result.gates,0xffffff);
  for(let channel=0;channel<24;channel++) {
    assert.equal(result.registers[(channel*16+12)/2],32767);
    assert.ok(peak(voiceSamples(result.voices,channel))>1e-4,`CH${channel+1} has a distinct running output`);
  }
  for(let frame=0;frame<result.pcm.length/2;frame++)for(let side=0;side<2;side++) {
    let integerSum=0;
    for(let channel=0;channel<24;channel++)integerSum+=Math.round(result.voices[frame*48+channel*2+side]/mainGain);
    assert.ok(integerSum>=-32768&&integerSum<=32767,'the low-volume fixture avoids mixed-bus saturation');
    assert.equal(result.pcm[frame*2+side],Math.fround(integerSum*mainGain));
  }
});

test('dry taps precede mixed-bus saturation, whose voice-order clamp is preserved in the full mix',async()=>{
  const result=await compareVoiceTap(allVoiceFixture({saturating:true}),4096);let saturationWitness=false;
  assert.equal(result.active,0xffffff);
  for(let frame=0;frame<result.pcm.length/2;frame++)for(let side=0;side<2;side++) {
    let ordered=0,sum=0;
    for(let channel=0;channel<24;channel++) {
      const contribution=Math.round(result.voices[frame*48+channel*2+side]/mainGain);
      sum+=contribution;ordered=clamp16(ordered+contribution);
    }
    if(Math.abs(ordered-clamp16(sum))>=1024)saturationWitness=true;
    assert.equal(result.pcm[frame*2+side],Math.fround(ordered*mainGain));
  }
  assert.ok(saturationWitness,'positive voices before negative voices expose why a tap cannot be a difference of clipped buses');
});

test('PMON sources retain their silent dry volume while modulating carriers in both masks',async()=>{
  for(const carrier of [1,23]) {
    const dry=await compareVoiceTap(createPsfSpuFeatureFixture({pair:true,pmon:false,carrier}));
    const modulated=await compareVoiceTap(createPsfSpuFeatureFixture({pair:true,pmon:true,carrier}));
    assert.equal(peak(voiceSamples(modulated.voices,carrier-1)),0,'a zero-L/R PMON source has no direct dry output');
    const before=voiceSamples(dry.voices,carrier),after=voiceSamples(modulated.voices,carrier);
    assert.ok(rms(Float32Array.from(before,(value,index)=>value-after[index]))>.001,'the dry carrier includes live PMON pitch modulation');
    assert.deepEqual(after,modulated.pcm,'one audible carrier without reverb matches its full-song output');
  }
});

test('Noise dry taps use the same shared generator and change clock without retriggering',async()=>{
  const writes=[[0x194,3],[0x010,0x2000],[0x012,0x1000],[0x014,0x2800],[0x016,PSF_FIXTURE_SPU_ADDRESS/8],
    [0x018,0x000f],[0x01a,0x1fc0],[0x01e,PSF_FIXTURE_SPU_ADDRESS/8],[0x188,3]];
  const result=await compareVoiceTap(createPsfSpuFeatureFixture({noise:true,noiseClock:8,steps:[
    {delay:4096,writes},{delay:65535,writes:[[0x1aa,0xc000|(48<<8)]]},
  ]}));
  const first=voiceSamples(result.voices,0),second=voiceSamples(result.voices,1);
  const together=result.events.findLast(event=>event.kind===1&&event.address===0x188&&event.value===3).frame;
  assert.deepEqual(first.subarray((together+2)*2),second.subarray((together+2)*2),'Noise is shared even with different sample PITCH registers');
  const changed=result.events.find(event=>event.kind===1&&event.address===0x1aa&&event.value===(0xc000|(48<<8))).frame;
  assert.ok(crossings(first.subarray((changed+2)*2))>crossings(first.subarray((together+2)*2,changed*2)),'faster shared Noise clock reaches both dry taps');
});

test('selected dry outputs omit shared reverb but the full wet tail and hardware processing continue',async()=>{
  const result=await compareVoiceTap(createPsfSpuFeatureFixture({reverb:true,oneShot:true,returnLeft:0x4000,returnRight:0x2000}),22050);
  const voice=voiceSamples(result.voices,0),tail=2048*2;
  assert.ok(peak(voice)>.001,'a voice sent to reverb still has its own dry contribution');
  assert.equal(peak(voice.subarray(tail)),0,'the ended one-shot has no selected dry tail');
  assert.equal(peak(voiceSamples(result.voices,23)),0,'an inactive selection cannot leak another voice or shared wet output');
  assert.ok(peak(result.pcm.subarray(tail))>1e-5,'the original shared reverb keeps processing its full-song tail');
  const muted=await compareVoiceTap(createPsfSpuFeatureFixture({reverb:true,mainLeft:0,mainRight:0}));
  assert.equal(peak(muted.voices),0);assert.equal(peak(muted.pcm),0,'main volume also gates the dry monitor');
});

test('dry monitor follows main gain and output-enable changes without modifying envelopes',async()=>{
  const full=await compareVoiceTap(createPsfSpuFeatureFixture());
  const quarter=await compareVoiceTap(createPsfSpuFeatureFixture({mainLeft:0x1000,mainRight:0x1000}));
  const ratio=rms(quarter.voices)/rms(full.voices);assert.ok(ratio>.24&&ratio<.26);
  const result=await compareVoiceTap(createPsfSpuFeatureFixture({steps:[
    {delay:65535,writes:[[0x1aa,0x8000]]},{delay:65535,writes:[[0x1aa,0xc000]]},
  ]}));
  const control=result.events.filter(event=>event.kind===1&&event.address===0x1aa),off=control.find(event=>event.value===0x8000),on=control.find(event=>event.frame>off.frame&&event.value===0xc000);
  assert.equal(peak(result.voices.subarray((off.frame+2)*48,on.frame*48)),0,'SPUCNT mute reaches every dry output at the same frame');
  assert.ok(peak(result.voices.subarray((on.frame+2)*48))>.001);assert.equal(result.registers[0x00c/2],32767);
});

test('public dry rendering is chunk-exact, returns owned arrays, and keeps legacy rendering cheap',async()=>{
  const calls={full:0,voices:0},whole=await create(standalone,{moduleOptions:{onRuntimeInitialized(){
    const full=this._psf_render,voices=this._psf_render_stems;
    this._psf_render=(...args)=>{calls.full++;return full(...args);};this._psf_render_stems=(...args)=>{calls.voices++;return voices(...args);};
  }}}),split=await create();
  try {
    const expected=whole.renderWithVoices(8193),pcm=new Float32Array(8193*2),voices=new Float32Array(8193*48);
    let frames=0;while(frames<8193){const count=Math.min(127,8193-frames),part=split.renderWithVoices(count);pcm.set(part.pcm,frames*2);voices.set(part.voices,frames*48);frames+=count;}
    assert.deepEqual(pcm,expected.pcm);assert.deepEqual(voices,expected.voices);assert.equal(whole.position,8193/44100);
    assert.equal(calls.full,0);assert.equal(calls.voices,1);const frozenPcm=expected.pcm.slice(),frozenVoices=expected.voices.slice();
    assert.deepEqual(whole.render(257),split.render(257));assert.equal(calls.full,1);assert.equal(calls.voices,1,'legacy render does not collect unused stems');
    assert.deepEqual(expected.pcm,frozenPcm);assert.deepEqual(expected.voices,frozenVoices);
    expected.pcm.fill(0);expected.voices.fill(0);assert.deepEqual(whole.renderWithVoices(128),split.renderWithVoices(128),'caller edits cannot change native state');
  } finally {whole.dispose();split.dispose();}
});

test('overlapping native full/stem destinations are rejected before CPU or DSP advancement',async()=>{
  const machine=await nativeMachine(createPsfSpuFeatureFixture()),module=machine.module,buffer=module._malloc(8*48*4+32);
  try {
    assert.equal(module._psf_render_stems(machine.handle,buffer,buffer,8),-1);assert.equal(machine.frames,0);
    assert.equal(module._psf_render_stems(machine.handle,buffer,buffer+4,8),-1);assert.equal(machine.frames,0);
    assert.equal(module._psf_render_stems(machine.handle,buffer,0,8),-1);assert.equal(machine.frames,0);
    assert.equal(machine.renderWithVoices(8).voices.length,8*48,'invalid destination arguments do not poison an otherwise valid machine');
  } finally {module._free(buffer);machine.dispose();}
});

test('the passive build overlay is deterministic, hash-pinned and leaves fixed SDK files unchanged',async()=>{
  const {createPsfSpuTapSource,PSF_SPU_TAP_INPUT_SHA256}=await import('../../scripts/build_psf_player.mjs');
  const vendor=new URL('../../third_party/tetorica-soundchip-native/vendor/mame-ps1-spu/',import.meta.url),input=await readFile(new URL('spu.cpp',vendor)),before=input.slice();
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');assert.equal(sha(input),PSF_SPU_TAP_INPUT_SHA256);
  const overlay=createPsfSpuTapSource(input);assert.equal(overlay,createPsfSpuTapSource(input));assert.deepEqual(input,before);
  assert.equal((overlay.match(/psf_spu_voice_tap/g)??[]).length,2,'only a declaration and one read-only observation call are inserted');
  const restored=overlay.replace(/\n\n\/\/ Generated build-only[^\n]+\nextern "C" void psf_spu_voice_tap\([^;]+;/,'')
    .replace(/\n\t\tpsf_spu_voice_tap\(this,v,frame,sample,vol\[0\],vol\[1\]\);/,'');
  assert.equal(restored,input.toString('utf8'),'all original DSP arithmetic and ordering remain byte-identical');
  assert.throws(()=>createPsfSpuTapSource(new Uint8Array()),/anchor/);assert.throws(()=>createPsfSpuTapSource(Buffer.concat([input,input])),/anchor/);
  assert.throws(()=>createPsfSpuTapSource(Buffer.concat([input,Buffer.from('\n')])),/hash changed/);
  assert.deepEqual(await readFile(new URL('spu.cpp',vendor)),before);
  const manifest=JSON.parse(await readFile(new URL('../../third_party/tetorica-soundchip-native/RELEASE-MANIFEST.json',import.meta.url),'utf8'));
  const pinned=Object.entries(manifest.files).filter(([name])=>name.startsWith('vendor/mame-ps1-spu/'));assert.equal(pinned.length,17);
  for(const [name,record]of pinned)assert.equal(sha(await readFile(new URL('../../third_party/tetorica-soundchip-native/'+name,import.meta.url))),record.sha256,name);
});
