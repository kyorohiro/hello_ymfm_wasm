import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Ps1Spu} from './ps1_spu.js';
import {Ps1Synth,preparePs1ADPCM,createPs1InitSample} from './ps1synth.js';
import {PS1_REVERB_PRESETS} from './ps1_parameters.js';
import {preparePs1Waveform} from './ps1_waveform.js';
let sharedModule;
async function create(t) {
  sharedModule??=Promise.all([import('../docs/generated/ps1_spu_wasm.js'),readFile(new URL('../docs/generated/ps1_spu_wasm.wasm',import.meta.url))]).then(([{default:factory},wasmBinary])=>factory({wasmBinary}));
  const core=await Ps1Spu.create({moduleFactory:()=>sharedModule}),synth=new Ps1Synth({core});
  t.after(()=>synth.dispose());return {synth,core};
}
function load(synth){const {adpcm,...options}=createPs1InitSample();return synth.loadADPCM(adpcm,options);}
function render(synth,frames){const left=new Float32Array(frames),right=new Float32Array(frames);synth.renderInto(left,right,frames);assert.ok(left.every(Number.isFinite));assert.ok(right.every(Number.isFinite));return {left,right};}
const peak=values=>values.reduce((v,x)=>Math.max(v,Math.abs(x)),0);
function frequency(values,rate){let edges=0,first=-1,last=-1;for(let at=1;at<values.length;at++)if(values[at-1]<=0&&values[at]>0){if(first<0)first=at;last=at;edges++;}return (edges-1)*rate/(last-first);}
function cloneFixture(){const {adpcm,...options}=createPs1InitSample();return {adpcm,options};}

test('the starter is the pre-encoded editor sine with unchanged packet layout, tuning and owned buffers',()=>{
  const first=createPs1InitSample(),second=createPs1InitSample();
  assert.equal(first.adpcm.length,64);assert.equal(first.baseFrequencyHz,44100/112);assert.equal(first.loopStartSamples,0);
  const prepared=preparePs1ADPCM(first.adpcm,{baseFrequencyHz:first.baseFrequencyHz,loopStartSamples:first.loopStartSamples});
  assert.equal(prepared.decodedFrames,112);assert.equal(prepared.loop,true);
  const editor=preparePs1Waveform(Array.from({length:112},(_,i)=>.65*Math.sin(2*Math.PI*i/112)));
  assert.deepEqual(first.adpcm,editor.adpcm,'The AudioWorklet-ready bytes equal the prepare-side panel Sine encoder output');
  for(let block=0;block<4;block++){
    assert((first.adpcm[block*16]>>4)<=4&&(first.adpcm[block*16]&15)<=12);
    assert.equal(first.adpcm[block*16+1],block===0?6:block===3?3:0);
  }
  assert.equal(first.adpcm[0]>>4,2,'The cyclic Sine predicts across the loop boundary');
  first.adpcm.fill(255);assert.notDeepEqual(first.adpcm,second.adpcm);assert.deepEqual(createPs1InitSample(),second);
});

test('actual SPU decoding gives the starter lower sine error than the former coarse four-bit waveform',async t=>{
  // Fixed Gaussian group delay at PITCH=4096, phase zero, is about two frames.
  const target=Array.from({length:112},(_,i)=>.65*Math.sin(2*Math.PI*(i-2)/112));
  const coarse=new Uint8Array(64);
  for(let block=0;block<4;block++){
    coarse[block*16+1]=block===0?6:block===3?3:0;
    for(let i=0;i<28;i++){const code=Math.round(5*Math.sin(2*Math.PI*(block*28+i)/112))&15;coarse[block*16+2+(i>>1)]|=code<<((i&1)*4);}
  }
  const quality=async packets=>{
    const {synth}=await create(t),sample=synth.loadADPCM(packets,{baseFrequencyHz:44100/112,loopStartSamples:0});
    synth.setPreset(0,{sample,volumeLeft:1,volumeRight:1,adsr1:15,adsr2:0,pitch:4096});synth.keyOn(0);render(synth,112*16);
    const pcm=render(synth,112*3).left,cycle=pcm.subarray(0,112);
    assert.deepEqual(pcm.subarray(112,224),cycle,'The actual decoder repeats the same cycle');assert.deepEqual(pcm.subarray(224),cycle);
    const error=cycle.reduce((sum,value,i)=>sum+(value-target[i])**2,0);
    return {rmsError:Math.sqrt(error/112),peak:peak(cycle),dc:cycle.reduce((sum,value)=>sum+value,0)/112};
  };
  const current=await quality(createPs1InitSample().adpcm),former=await quality(coarse);
  assert(current.rmsError<former.rmsError*.6,'Predictive encoding materially reduces actual PCM error without a Mixer correction');
  assert(current.peak>.64&&current.peak<.67);assert(Math.abs(current.dc)<.005);
});

test('PS1 private waveform slots are isolated, reused, and independent of shared sample RAM',async t=>{
  const{synth,core}=await create(t),shared=load(synth),original=core.readRam(shared.startAddress,64);
  for(let ch=0;ch<24;ch++)synth.setPreset(ch,{sample:shared});
  const wave=preparePs1Waveform(Array.from({length:112},(_,i)=>.5*Math.sin(2*Math.PI*i/112)));
  for(let ch=0;ch<24;ch++){
    const before=synth.getPreset(ch),sample=synth._setWaveformPrepared(ch,wave);
    assert.equal(sample.editorChannel,ch);assert.equal(sample.byteLength,64);assert.equal(sample.id,ch+1);assert.equal(sample.startAddress,0x1040+ch*64);
    assert.deepEqual(synth.getPreset(ch),before,'resource upload does not assign or retrigger a voice');
    synth.setPreset(ch,{sample});assert.deepEqual(synth.getState().channels[ch].waveform,{sample:sample.id,pcm:wave.pcm});
    assert.throws(()=>synth.setPreset((ch+1)%24,{sample}),/another channel/);
  }
  const allocated=synth.nextAddress,descriptors=synth.samples.map(s=>({...s}));
  const next=preparePs1Waveform(Array.from({length:112},(_,i)=>i<56?.4:-.4));
  for(let i=0;i<30;i++)for(let ch=0;ch<24;ch++)synth._setWaveformPrepared(ch,next);
  assert.equal(synth.nextAddress,allocated);assert.deepEqual(synth.samples,descriptors);assert.deepEqual(core.readRam(shared.startAddress,64),original);
  const state=synth.getState();state.channels[0].waveform.pcm.fill(0);assert.deepEqual(synth.getState().channels[0].waveform.pcm,next.pcm);
  synth.stopVoices();assert.deepEqual(synth.getState().channels[23].waveform.pcm,next.pcm);
  synth.reset();assert.equal(synth.getState().channels[23].waveform,null);assert.equal(synth.samples.length,25);
  const reused=synth._setWaveformPrepared(23,wave);assert.equal(reused.id,24);assert.equal(synth.nextAddress,allocated);
  synth.reset({clearRam:true});assert.equal(synth.samples.length,0);assert.equal(synth.nextAddress,0x1000);assert(synth.editorWaveforms.every(value=>value===null));
});

test('PS1 invalid or full-bank waveform edits are atomic and resource adoption leaves requested voices alone',async t=>{
  const{synth,core}=await create(t),prepared=preparePs1Waveform(Array(112).fill(.25));load(synth);
  const before=synth.snapshot();
  for(const [ch,value]of [[24,prepared],[0,{...prepared,pcm:Array(112).fill(NaN)}],[0,{...prepared,adpcm:prepared.adpcm.slice(0,48)}],[0,{...prepared,extra:1}]])assert.throws(()=>synth._setWaveformPrepared(ch,value));
  assert.deepEqual(synth.snapshot(),before);
  const bytes=new Uint8Array(524288-synth.nextAddress);bytes[bytes.length-15]=1;synth.loadADPCM(bytes,{rootNote:60});
  const full=synth.snapshot();assert.throws(()=>synth._setWaveformPrepared(0,prepared),/full/);assert.deepEqual(synth.snapshot(),full);
  const resources=synth._getResources();synth.setPitch(23,1234);synth._adoptResources(resources);assert.equal(synth.getPreset(23).pitch,1234);
  resources.samples[0].startAddress=0;assert.equal(synth.samples[0].startAddress,0x1000);assert.equal(core.nativeFrames,0);
});

test('SPU ADPCM validation requires complete packets, explicit tuning, final END and a matching aligned loop',()=>{
  const {adpcm,options}=cloneFixture();
  for(const opts of [{},{rootNote:69,baseFrequencyHz:440},{baseFrequencyHz:0},{rootNote:'H4'},{...options,basePitch:1}])assert.throws(()=>preparePs1ADPCM(adpcm,opts));
  for(const bytes of [new Uint8Array(),new Uint8Array(15),new Uint8Array(524288)])assert.throws(()=>preparePs1ADPCM(bytes,options));
  const bad=(at,value)=>{const copy=adpcm.slice();copy[at]=value;assert.throws(()=>preparePs1ADPCM(copy,options));};
  bad(0,0x50);bad(0,0x0d);bad(1,0x80);bad(1,7);bad(49,2);bad(17,4);
  assert.throws(()=>preparePs1ADPCM(adpcm,{baseFrequencyHz:440}),/loopStartSamples/);
  assert.throws(()=>preparePs1ADPCM(adpcm,{baseFrequencyHz:440,loopStartSamples:1}),/boundary/);
  assert.throws(()=>preparePs1ADPCM(adpcm,{baseFrequencyHz:440,loopStartSamples:28}),/disagrees/);
  const oneShot=adpcm.slice();oneShot[1]=0;oneShot[49]=1;
  assert.throws(()=>preparePs1ADPCM(oneShot,options),/LOOP/);
  const prepared=preparePs1ADPCM(adpcm,{rootNote:'A4',loopStartSamples:0});adpcm.fill(0);
  assert.equal(prepared.rootFrequencyHz,440);assert.equal(prepared.basePitch,4096);assert.equal(prepared.decodedFrames,112);assert.equal(prepared.adpcm[1],6);
  assert.equal(createPs1InitSample().adpcm[1],6,'authored fixture returns independent buffers');
});

test('PS1 instruments upload beyond capture RAM, tune A4=440, and preserve signed independent stereo',async t=>{
  const {synth,core}=await create(t),sample=load(synth);
  assert.equal(sample.startAddress,0x1000);assert.equal(sample.repeatAddress,0x1000);assert.equal(sample.byteLength,64);
  assert.equal(sample.decodedFrames,112);assert.equal(sample.basePitch,4096);
  synth.setPreset(23,{sample,volumeLeft:0.7,volumeRight:-0.7});synth.noteOn(23,'A4');
  const expected=Math.round(4096*440/(44100/112));assert.equal(core.read(23*16+4),expected);
  const audio=render(synth,16384);assert.ok(peak(audio.left)>0.01);
  assert.ok(Math.abs(frequency(audio.left.subarray(1024),44100)-440)<0.2);
  for(let at=1024;at<audio.left.length;at++)assert.ok(Math.abs(audio.left[at]+audio.right[at])<1/16384);
  synth.setNote(23,'A5');assert.equal(synth.getPreset(23).pitch,Math.round(4096*880/(44100/112)));
  synth.setFrequency(23,220);assert.equal(synth.getPreset(23).pitch,Math.round(4096*220/(44100/112)));
  synth.setPitch(23,0);assert.equal(core.read(23*16+4),0);
});

test('all 24 fixed SPU voices sound, simultaneous key-ons survive, and KOFF isolates the high bank',async t=>{
  const {synth}=await create(t),sample=load(synth);
  for(let ch=0;ch<24;ch++) {
    synth.setPreset(ch,{sample,volumeLeft:0.03,volumeRight:0.03});synth.keyOn(ch);
    assert.ok(peak(render(synth,128).left)>0,`voice ${ch}`);synth.stopVoices();
  }
  for(let ch=0;ch<24;ch++)synth.keyOn(ch);
  render(synth,1024);assert.ok(synth.getState().channels.every(c=>c.envelope>0));
  synth.keyOff(23);render(synth,2048);
  const state=synth.getState();assert.equal(state.channels[23].envelope,0);assert.equal(state.channels[23].gate,false);
  assert.ok(state.channels.slice(0,23).every(c=>c.envelope>0&&c.gate));
  synth.allNotesOff();render(synth,2048);assert.equal(peak(render(synth,256).left),0);
});

test('PS1 preset and sample errors are atomic and valid edits do not retrigger sounding voices',async t=>{
  const {synth,core}=await create(t),sample=load(synth);synth.setPreset(0,{sample});synth.keyOn(0);render(synth,512);
  const state=synth.getPreset(0),frame=core.nativeFrames,before=core.readRam(sample.startAddress,sample.byteLength);
  for(const params of [{volumeLeft:0.1,volumeRight:2},{adsr1:12,pitch:16384},{sample:999},{volumeLeft:NaN},{adsr1:-1},{gain:1}])assert.throws(()=>synth.setPreset(0,params));
  assert.deepEqual(synth.getPreset(0),state);assert.equal(core.nativeFrames,frame);assert.deepEqual(core.readRam(sample.startAddress,sample.byteLength),before);
  const next=synth.getState().nextAddress;
  assert.throws(()=>synth.loadADPCM(new Uint8Array(64),{rootNote:60}));assert.equal(synth.getState().nextAddress,next);
  assert.throws(()=>synth.setNote(1,'A4'),/Assign/);assert.throws(()=>synth.keyOn(1),/Assign/);
  assert.throws(()=>synth.setFrequency(0,1e9),/range/);assert.deepEqual(synth.getPreset(0),state);
  synth.setPreset(0,{volumeLeft:0,volumeRight:0.4});const audio=render(synth,128);assert.equal(peak(audio.left),0);assert.ok(peak(audio.right)>0);
  assert.equal(synth.getState().channels[0].gate,true);assert.equal(core.nativeFrames,frame+128);
});

test('PS1 Stop immediately silences output and reuses sample RAM, presets, tuning and all 24 channels',async t=>{
  const {synth,core}=await create(t),sample=load(synth);synth.setPreset(23,{sample,volumeLeft:0.5,volumeRight:0.2,adsr2:8});synth.noteOn(23,'C4');
  assert.ok(peak(render(synth,1024).left)>0);const before=synth.getPreset(23),ram=core.readRam(sample.startAddress,64);
  synth.stopVoices();assert.equal(core.nativeFrames,0);assert.deepEqual(synth.getPreset(23),before);assert.deepEqual(core.readRam(sample.startAddress,64),ram);
  assert.equal(peak(render(synth,4097).left),0);assert.ok(synth.getState().channels.every(c=>!c.gate));
  synth.keyOn(23);assert.ok(peak(render(synth,512).left)>0);assert.equal(synth.getState().samples.length,1);
  synth.reset();assert.equal(synth.getPreset(23).sample,null);assert.equal(synth.getState().samples.length,1);assert.equal(peak(render(synth,128).left),0);
  synth.setPreset(0,{sample});synth.noteOn(0,'A4');assert.ok(peak(render(synth,256).left)>0);
  synth.reset({clearRam:true});assert.equal(synth.getState().samples.length,0);assert.equal(synth.getState().nextAddress,0x1000);assert.ok(core.readRam().every(x=>x===0));
  assert.throws(()=>synth.setPreset(0,{sample}),/sample/);assert.equal(load(synth).id,0);
});

test('SPU upload allocator fills only available RAM and rejects further samples without changing the bank',async t=>{
  const {synth,core}=await create(t),bytes=new Uint8Array(512*1024-0x1000);bytes[bytes.length-15]=1;
  const sample=synth.loadADPCM(bytes,{rootNote:60});assert.equal(sample.byteLength,bytes.length);assert.equal(synth.getState().nextAddress,512*1024);
  const end=core.readRam(512*1024-16,16);
  assert.throws(()=>load(synth),/full/);assert.deepEqual(core.readRam(512*1024-16,16),end);assert.equal(synth.getState().samples.length,1);
});

test('non-looped SPU ADPCM stops at END and snapshots are independent owned copies',async t=>{
  const {synth}=await create(t),{adpcm}=createPs1InitSample();adpcm[1]=0;adpcm[49]=1;
  const sample=synth.loadADPCM(adpcm,{rootNote:60});assert.equal(sample.loop,false);assert.equal(sample.loopStartSamples,null);
  synth.setPreset(0,{sample});synth.keyOn(0);assert.ok(peak(render(synth,512).left)>0);assert.equal(peak(render(synth,512).left),0);
  const snapshot=synth.snapshot();assert.equal(snapshot.ram.length,512*1024);assert.equal(snapshot.registers.length,512);assert.equal(snapshot.channels[0].ended,true);
  snapshot.samples[0].startAddress=0;snapshot.channels[0].pitch=0;snapshot.ram.fill(0);assert.equal(synth.getState().samples[0].startAddress,0x1000);assert.equal(synth.getPreset(0).pitch,4096);
  synth.dispose();synth.dispose();assert.throws(()=>synth.keyOn(0),/disposed/);assert.throws(()=>synth.getState(),/disposed/);assert.throws(()=>synth.reset(),/disposed/);
});

test('named PS1 ADSR edits can explicitly defer the held envelope and retain raw bits for next key-on',async t=>{
  const a=await create(t),b=await create(t);
  for(const{synth}of[a,b]){const sample=load(synth);synth.setPreset(0,{sample,adsr2:0x2000});synth.keyOn(0);}
  assert.deepEqual(render(a.synth,512),render(b.synth,512));
  const frame=a.core.nativeFrames,ram=a.core.readRam(),other=a.synth.getPreset(1);
  a.synth.setEnvelope(0,{attackRate:70,attackExponential:true,decayRate:8,sustainLevel:9,sustainRate:127,sustainDecrease:true,sustainExponential:true,releaseRate:14,releaseExponential:true},{live:false});
  assert.equal(a.core.read(8),0xc689);assert.equal(a.core.read(10),0xffee);
  assert.equal(a.core.nativeFrames,frame);assert.deepEqual(a.core.readRam(),ram);assert.deepEqual(a.synth.getPreset(1),other);
  const p=a.synth.getState().channels[0].envelopeParameters;
  assert.equal(p.attackRate,70);assert.equal(p.releaseRate,14);assert.equal(p.sustainDecrease,true);
  assert.deepEqual(render(a.synth,1024),render(b.synth,1024),'ADSR register edits do not retrigger or replace the active envelope');
  a.synth.keyOn(0);b.synth.keyOn(0);render(a.synth,256);render(b.synth,256);
  assert.ok(a.core.read(12)<b.core.read(12)/4,'next key-on uses the programmed slow attack');
  const before=a.synth.getPreset(0),snapshot=a.synth.snapshot();
  for(const value of [{attackRate:128},{releaseExponential:1},{unsupported:0}])assert.throws(()=>a.synth.setEnvelope(0,value));
  assert.deepEqual(a.synth.getPreset(0),before);assert.deepEqual(a.synth.snapshot().registers,snapshot.registers);
});

test('public ADSR setters refresh once after both words, and unrelated or unchanged patches never refresh',async t=>{
  const {synth,core}=await create(t),sample=load(synth),refresh=core.refreshEnvelope.bind(core),calls=[];
  core.refreshEnvelope=ch=>{calls.push({ch,adsr1:core.read(ch*16+8),adsr2:core.read(ch*16+10)});refresh(ch);};
  synth.setPreset(0,{sample,adsr1:0x200f,adsr2:0x3fc0});
  assert.deepEqual(calls,[{ch:0,adsr1:0x200f,adsr2:0x3fc0}],'Both ADSR words reach the core before one live refresh');
  synth.setChannel(0,{adsr1:0x210f,adsr2:0x2fc0},{live:true});assert.equal(calls.length,2);
  synth.setEnvelope(0,{attackRate:34,sustainRate:64});assert.equal(calls.length,3);
  const current=synth.getPreset(0);
  synth.setPreset(0,{adsr1:current.adsr1,adsr2:current.adsr2});synth.setEnvelope(0,{});
  synth.setChannel(0,{sample,volumeLeft:.4,volumeRight:.3,pitch:4123,reverb:true});
  synth.setEnvelope(0,{sustainRate:60,sustainDecrease:true},{live:false});
  synth.setPreset(0,{adsr2:synth.getPreset(0).adsr2},{live:true});
  synth.setPreset(0,{volumeLeft:.2});synth.setChannel(0,{sample,pitch:4124});
  assert.equal(calls.length,3,'Neither same-value ADSR nor later volume/sample/pitch patches flush a deferred ADSR edit');
  const before=synth.snapshot();
  for(const method of ['setPreset','setChannel','setEnvelope'])for(const options of [null,[],true,{live:1},{live:null},{live:'false'},{unknown:true},{live:false,extra:0}]){
    assert.throws(()=>synth[method](0,method==='setEnvelope'?{attackRate:12}:{adsr1:0x120f},options),/options|live/);
    assert.deepEqual(synth.snapshot(),before,'Invalid options are rejected before registers, metadata or core time changes');
  }
});

test('ordinary public ADSR edits preserve sustain phase and apply a new slope without KON',async t=>{
  const a=await create(t),b=await create(t);
  for(const {synth}of[a,b]){const sample=load(synth);synth.setPreset(0,{sample,adsr2:0x2000});synth.keyOn(0);}
  assert.deepEqual(render(a.synth,1009),render(b.synth,1009));
  const frame=a.core.nativeFrames,ram=a.core.readRam(0x1000,512*1024-0x1000),other=a.synth.getPreset(1),writes=[],write=a.core.write.bind(a.core);
  a.core.write=(register,value)=>{writes.push(register);write(register,value);};
  a.synth.setEnvelope(0,{attackRate:100});b.synth.setEnvelope(0,{attackRate:100},{live:false});
  assert.equal(a.core.nativeFrames,frame);assert.equal(a.core.read(12),0x7fff);
  assert.deepEqual(render(a.synth,2048),render(b.synth,2048),'An attack edit during sustain preserves every PCM sample and sample position');
  a.synth.setPreset(0,{adsr2:0x2000|0x4000|(40<<6)});
  b.synth.setPreset(0,{adsr2:0x2000|0x4000|(40<<6)},{live:false});
  b.synth.setEnvelope(0,{sustainRate:40,sustainDecrease:true},{live:true});
  // An unrelated patch must not activate b's deferred sustain registers.
  b.synth.setChannel(0,{volumeLeft:.75,volumeRight:.75});
  const changed=render(a.synth,4096),held=render(b.synth,4096),energy=pcm=>pcm.reduce((sum,v)=>sum+v*v,0);
  assert.equal(changed.left[0],held.left[0],'A changed slope starts at the current level');
  assert(energy(changed.left)<energy(held.left)*.8);assert.equal(b.core.read(12),0x7fff);
  assert.equal(a.core.read(10)&0x2000,0x2000);assert.deepEqual(a.core.readRam(0x1000,512*1024-0x1000),ram);assert.deepEqual(a.synth.getPreset(1),other);
  assert(!writes.some(register=>[0x188,0x18a,0x18c,0x18e].includes(register)),'Live envelope edits never key on or off');
});

for(const stage of ['attack','decay','release'])test(`public ADSR edits retime the current ${stage} without resetting its level`,async t=>{
  const a=await create(t),b=await create(t);
  const preset=stage==='attack'?{adsr1:(61<<8)|15,adsr2:127<<6}:stage==='decay'?{adsr1:(12<<4)|3,adsr2:127<<6}:{adsr1:15,adsr2:14};
  for(const {synth}of[a,b]){const sample=load(synth);synth.setPreset(0,{sample,...preset});synth.keyOn(0);render(synth,512);if(stage==='release'){synth.keyOff(0);render(synth,512);}}
  const before=a.core.read(12),frame=a.core.nativeFrames,patch=stage==='attack'?{attackRate:20}:stage==='decay'?{decayRate:4}:{releaseRate:0};
  assert(before>0&&before<0x7fff,'The selected envelope stage is already progressing');
  if(stage==='release')assert.equal(a.synth.getState().channels[0].gate,false,'Release editing must work after the requested key gate is off');
  a.synth.setEnvelope(0,patch);b.synth.setEnvelope(0,patch,{live:false});
  assert.equal(a.core.read(12),before);assert.equal(a.core.nativeFrames,frame);
  const actual=render(a.synth,1024),unchanged=render(b.synth,1024);
  assert.equal(actual.left[0],unchanged.left[0],'The first sample retains the existing phase and level');
  if(stage==='attack')assert(a.core.read(12)>b.core.read(12)*10,'A faster attack applies immediately');
  else if(stage==='decay')assert(a.core.read(12)<b.core.read(12)*.5,'A faster decay applies immediately');
  else {assert.equal(a.core.read(12),0);assert(b.core.read(12)>20000,'The explicitly deferred slow release remains audible');}
});

test('public sustain-level edits follow the current stage rather than acting as a volume slider',async t=>{
  const a=await create(t),b=await create(t);
  for(const {synth}of[a,b]){const sample=load(synth);synth.setPreset(0,{sample,adsr1:15,adsr2:127<<6});synth.keyOn(0);render(synth,1009);}
  a.synth.setEnvelope(0,{sustainLevel:3});b.synth.setEnvelope(0,{sustainLevel:3},{live:false});
  assert.deepEqual(render(a.synth,2048),render(b.synth,2048),'Changing the future decay target during sustain does not jump its level');
});

test('PS1 named reverb changes validate atomically and do not modify samples, pitch or master gain',async t=>{
  const{synth,core}=await create(t),sample=load(synth);synth.setPreset(0,{sample});synth.keyOn(0);render(synth,512);
  const before=synth.snapshot(),state=synth.getState(),frame=core.nativeFrames;
  for(const value of [null,[],{preset:'echo'},{preset:'delay'},{preset:'unknown'},{volumeLeft:-.1},{volumeRight:1.01},{volumeLeft:NaN},{volumeRight:'0.5'},{preset:'hall',volumeRight:Infinity},{wet:.5}])assert.throws(()=>synth.setReverb(value));
  for(const value of [{reverb:1},{reverb:'true'},{reverb:true,pitch:16384}])assert.throws(()=>synth.setPreset(0,value));
  assert.deepEqual(synth.snapshot().registers,before.registers);assert.deepEqual(synth.getState(),state);assert.equal(core.nativeFrames,frame);
  assert.deepEqual(synth._reverb({preset:'room',volumeRight:.5}),{preset:'room',volumeLeft:.25,volumeRight:.5});
  assert.deepEqual(synth.snapshot().registers,before.registers,'pure inspector validation has no side effects');
  synth.setReverb({preset:'room',volumeLeft:.5,volumeRight:.75});
  assert.deepEqual(synth.getState().reverb,{preset:'room',volumeLeft:.5,volumeRight:.75});
  assert.equal(core.read(0x184),0x4000);assert.equal(core.read(0x186),0x5fff);assert.equal(core.read(0x1aa),0xc080);
  assert.equal(core.read(0x180),before.registers[0x180/2]);assert.equal(core.read(0x182),before.registers[0x182/2]);
  assert.equal(core.read(4),before.registers[2]);assert.equal(core.nativeFrames,frame);assert.deepEqual(core.readRam(),before.ram);
  const owned=synth.getState();owned.reverb.preset='off';owned.channels[0].envelopeParameters.attackRate=127;
  assert.equal(synth.getState().reverb.preset,'room');assert.equal(synth.getState().channels[0].envelopeParameters.attackRate,0);
});

test('reverb send edits preserve all other voices and are restored after a one-shot END',async t=>{
  const{synth,core}=await create(t),{adpcm}=createPs1InitSample();adpcm[1]=0;adpcm[49]=1;
  const sample=synth.loadADPCM(adpcm,{rootNote:60});
  for(const ch of [0,15,16,23])synth.setPreset(ch,{sample,reverb:true});
  assert.equal(core.read(0x198),0x8001);assert.equal(core.read(0x19a),0x81);
  synth.setPreset(15,{reverb:false});assert.equal(core.read(0x198),1);assert.equal(core.read(0x19a),0x81);
  synth.keyOn(0);render(synth,512);assert.equal(core.read(0x198)&1,0,'upstream one-shot completion clears applied send');
  assert.equal(synth.getPreset(0).reverb,true,'the requested voice preset remains available for another note');
  synth.keyOn(0);assert.equal(core.read(0x198)&1,1);assert.equal(core.read(0x19a),0x81);
  synth.setPreset(16,{reverb:false});assert.equal(core.read(0x19a),0x80);
});

test('every exposed nonzero reverb preset produces finite audible tails through the actual WASM SPU',async t=>{
  for(const preset of PS1_REVERB_PRESETS){
    const{synth}=await create(t),sample=load(synth);
    synth.setPreset(0,{sample,reverb:true,volumeLeft:.2,volumeRight:.2});synth.setReverb({preset:preset.id,volumeLeft:.75,volumeRight:.75});
    synth.keyOn(0);render(synth,4410);synth.keyOff(0);const audio=render(synth,44100),tail=audio.left.subarray(1024);
    if(preset.id==='off')assert.equal(peak(tail),0);
    else assert.ok(peak(tail)>.001,`${preset.id} has an audible wet tail after the dry voice stops`);
  }
});

test('reverb return levels and sends update held voices, Off restores dry PCM, and Stop clears tails but retains settings',async t=>{
  const a=await create(t),b=await create(t);
  for(const{synth}of[a,b]){const sample=load(synth);synth.setPreset(0,{sample,volumeLeft:.2,volumeRight:.2});synth.keyOn(0);}
  a.synth.setPreset(0,{reverb:true});
  assert.deepEqual(render(a.synth,2048),render(b.synth,2048),'Off is exact dry bypass even when a voice requests reverb');
  a.synth.setReverb({preset:'room',volumeLeft:0,volumeRight:.75});
  const wet=render(a.synth,8192),dry=render(b.synth,8192);
  assert.deepEqual(wet.left,dry.left);assert.notDeepEqual(wet.right,dry.right,'return edits take effect without key-on');
  assert.equal(a.synth.getState().channels[0].gate,true);
  a.synth.keyOff(0);b.synth.keyOff(0);const tail=render(a.synth,8192);
  assert.equal(peak(tail.left.subarray(1024)),0);assert.ok(peak(tail.right.subarray(1024))>.001);
  const settings=a.synth.getState().reverb,preset=a.synth.getPreset(0),ram=a.core.readRam(),next=a.synth.nextAddress;
  a.synth.stopVoices();assert.deepEqual(a.synth.getState().reverb,settings);assert.deepEqual(a.synth.getPreset(0),preset);
  assert.deepEqual(a.core.readRam(),ram);assert.equal(a.synth.nextAddress,next);assert.equal(peak(render(a.synth,8192).right),0);
  assert.equal(a.core.read(0x198),1);assert.equal(a.core.read(0x1c0),PS1_REVERB_PRESETS.find(p=>p.id==='room').registers[0]);
  a.synth.keyOn(0);render(a.synth,4096);a.synth.setReverb({preset:'off'});
  assert.equal(a.core.read(0x184),0);assert.equal(a.core.read(0x186),0);assert.deepEqual(a.synth.getState().reverb,{...settings,preset:'off'});
  a.synth.reset();assert.deepEqual(a.synth.getState().reverb,{preset:'off',volumeLeft:.25,volumeRight:.25});
  assert.ok(a.synth.getState().channels.every(ch=>ch.reverb===false));assert.equal(a.synth.getState().samples.length,1);
});

test('held cyclic Sine has no coarse first-quarter staircase in actual SPU PCM',async t=>{
  const {synth}=await create(t),{adpcm,...options}=createPs1InitSample();
  const sample=synth.loadADPCM(adpcm,options);
  synth.setPreset(0,{sample,volumeLeft:.75,volumeRight:.75,adsr1:15,adsr2:0x1fc0,pitch:4096});synth.keyOn(0);render(synth,112*20);
  const pcm=render(synth,112*100).left;
  let sine=0,cosine=0,dc=0;
  for(let i=0;i<pcm.length;i++){sine+=pcm[i]*Math.sin(2*Math.PI*i/112);cosine+=pcm[i]*Math.cos(2*Math.PI*i/112);dc+=pcm[i];}
  sine*=2/pcm.length;cosine*=2/pcm.length;dc/=pcm.length;
  const residual=pcm.reduce((sum,x,i)=>sum+(x-dc-sine*Math.sin(2*Math.PI*i/112)-cosine*Math.cos(2*Math.PI*i/112))**2,0)/pcm.length;
  const relativeDb=10*Math.log10(residual/((sine*sine+cosine*cosine)/2));
  assert(relativeDb< -55,`Actual held-Sine residual ${relativeDb} dBc must stay below -55 dBc`);
});
