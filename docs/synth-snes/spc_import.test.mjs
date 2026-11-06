// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseSpcVoices, MAX_SPC_BYTES} from './spc_import.js';
import {readPreset, envelopeRegisters, modulatorEnvelopeRegisters, presetToCode, ECHO_BRR_MAX_BYTES} from './preset.js';
import {decodeBase64, MAX_BRR_BYTES} from './sample.js';
import {SnesInstrument} from './instrument.js';
import {SnesDspCore} from '../js/spc.js';
import factory from '../generated/spc_wasm.js';
import {SnesSynth} from '../js/snessynth.js';

// Entirely self-authored SPC snapshots: no game program or Nintendo IPL ROM.
const RAM = 0x100, DSP = 0x10100;
const BRR = Uint8Array.of(0xc0,0x77,0x66,0x44,0x22,0x0e,0xcc,0xaa,0x99,0xc3,0x99,0xaa,0xcc,0xee,0x02,0x44,0x66,0x77);
function sample(image, sourceNumber, address = 0x2000, bytes = BRR, loopAddress = address) {
  const directory = image[DSP + 0x5d] << 8;
  const word = (address, value) => {image[RAM + (address & 65535)] = value & 255;image[RAM + ((address + 1) & 65535)] = value >> 8;};
  word(directory + sourceNumber * 4, address);word(directory + sourceNumber * 4 + 2, loopAddress);
  bytes.forEach((value,index) => {image[RAM + ((address + index) & 65535)] = value;});
  return image;
}
function voice(image, index, {sourceNumber = 0, pitch = 4096, left = 16, right = 16, adsr1 = 0xaf, adsr2 = 0xe0, gain = 0x60, envx = 0, outx = 0} = {}) {
  image.set([left & 255,right & 255,pitch & 255,(pitch >> 8) & 255,sourceNumber,adsr1,adsr2,gain,envx,outx],DSP + (index << 4));
  return image;
}
function image() {
  const data = new Uint8Array(0x10200);
  data.set(new TextEncoder().encode('SNES-SPC700 Sound File Data v0.30'));
  data.set([0x1a,0x1a,0x1b,30],0x21);
  data[DSP + 0x5d] = 2;
  for (let index=0;index<8;index++) voice(data,index);
  return sample(data,0);
}
const ready = result => result.candidates.filter(candidate => candidate.preset);
function echoRegisters(data, {flags=0, delay=2, feedback=32, left=48, right=-32, sendMask=1,
  fir=[127,0,0,0,0,0,0,0], address=0x40} = {}) {
  for (const [offset,value] of [[0x6c,flags],[0x7d,delay],[0x0d,feedback],[0x2c,left],[0x3c,right],[0x4d,sendMask],[0x6d,address]]) data[DSP+offset]=value&255;
  fir.forEach((value,index)=>{data[DSP+0x0f+16*index]=value&255;});
  return data;
}
function pmonImage() {
  const data=echoRegisters(image(),{sendMask:3,feedback:24,left:40,right:-20,fir:[96,16,-8,4,0,0,0,0]});
  sample(data,1,0x2400,BRR,0x2409);
  voice(data,0,{sourceNumber:1,pitch:2048,left:-128,right:127,adsr1:0,adsr2:0,gain:64,envx:100});
  voice(data,1,{sourceNumber:0,pitch:3072,left:24,right:16,adsr1:0x9f,adsr2:0xe0,gain:0x4f,envx:80});
  data[DSP+0x2d]=2;
  return data;
}

test('optional SPC PMON preserves the adjacent BRR pair, both captured PITCH values and independent envelopes', () => {
  const data=pmonImage(),before=data.slice(),result=parseSpcVoices(data),candidate=result.candidates[1];
  const dry=candidate.pmonVariant,wet=candidate.pmonEchoVariant;
  assert(dry.preset);assert(wet.preset);assert.equal(dry.reason,null);assert.equal(wet.reason,null);
  assert.equal(candidate.preset.pmon.enabled,false);assert.equal(candidate.echoVariant.preset.pmon.enabled,false);
  assert(candidate.warnings.some(warning=>warning.includes('PMON is not reproduced')));
  assert(!dry.warnings.some(warning=>warning.includes('PMON is not reproduced')));
  assert.equal(dry.preset.source,'brr');assert.equal(dry.preset.brr.basePitch,3072);assert.equal(dry.preset.brr.rootNote,60);
  assert.equal(dry.preset.pmon.enabled,true);assert.equal(dry.preset.pmon.source,'brr');assert.equal(dry.preset.pmon.ratio,1);
  assert.deepEqual(dry.preset.pmon.brr,{name:result.candidates[0].preset.brr.name,data:result.candidates[0].preset.brr.data,
    rootNote:60,basePitch:2048,loopStartSamples:16});
  assert.deepEqual(envelopeRegisters(dry.preset),{adsr1:0x9f,adsr2:0xe0,gain:0x4f});
  assert.deepEqual(modulatorEnvelopeRegisters(dry.preset),{adsr1:0,adsr2:0,gain:64});
  assert.deepEqual(dry.preset.volume,{left:24,right:16});assert.equal(dry.preset.echo.enabled,false);
  assert.deepEqual(wet.preset.echo,{enabled:true,delay:2,feedback:24,volumeLeft:40,volumeRight:-20,send:true,fir:[96,16,-8,4,0,0,0,0]});
  assert.deepEqual(candidate.pmonPair.modulatorVoice,result.candidates[0].voice);
  assert.deepEqual(candidate.pmonPair.sample,result.candidates[0].sample);
  assert(dry.warnings.some(warning=>warning.includes('C4')));assert(dry.warnings.some(warning=>warning.includes('not inferred')));
  assert(dry.warnings.some(warning=>warning.includes('L/R zero')&&warning.includes('Echo send is omitted')));
  assert(dry.warnings.some(warning=>warning.includes('Current ENVX')&&warning.includes('BRR decoder history')));
  assert.deepEqual(data,before);
  result.candidates[0].voice.pitch=1;result.candidates[0].sample.bytes=1;result.candidates[0].preset.envelope.gainLevel=1;
  candidate.pmonPair.modulatorVoice.volumeLeft=0;dry.preset.pmon.brr.basePitch=3;dry.preset.pmon.envelope.gainLevel=2;
  assert.equal(wet.preset.pmon.brr.basePitch,2048);assert.equal(wet.preset.pmon.envelope.gainLevel,64);
  assert.equal(candidate.pmonPair.modulatorVoice.pitch,2048);assert.equal(candidate.pmonPair.sample.bytes,18);
  assert.equal(result.candidates[0].voice.volumeLeft,-128);data.fill(0);
  assert.deepEqual(decodeBase64(wet.preset.pmon.brr.data),BRR,'pair data no longer depends on the SPC file');
});

test('SPC PMON pair scope rejects missing input, Noise modulators, invalid tuning / BRR and longer chains explicitly', () => {
  const cases=[
    [data=>{data[DSP+0x2d]=0;},/no recorded PMON input/],
    [data=>{data[DSP+0x3d]=1;},/Noise modulator/],
    [data=>voice(data,0,{sourceNumber:1,pitch:0}),/Modulator CH1:.*PITCH is 0/],
    [data=>sample(data,1,0x3000,new Uint8Array(9),0x3000),/Modulator CH1:.*END/],
    [data=>sample(data,1,0x2400,BRR,0x2401),/Modulator CH1:.*Loop target/],
    [data=>{data[DSP+0x2d]=6;},/Outgoing PMON chain/],
  ];
  for(const [alter,reason] of cases) {
    const data=pmonImage();alter(data);const candidate=parseSpcVoices(data).candidates[1];
    assert(candidate.preset);assert(candidate.echoVariant.preset,'ordinary fallback remains usable');
    for(const variant of [candidate.pmonVariant,candidate.pmonEchoVariant]) {assert.equal(variant.preset,null);assert.match(variant.reason,reason);}
  }
  const incoming=pmonImage();incoming[DSP+0x2d]=6;
  assert.match(parseSpcVoices(incoming).candidates[2].pmonVariant.reason,/Incoming PMON chain/);
  const outgoingNoise=pmonImage();outgoingNoise[DSP+0x2d]=6;outgoingNoise[DSP+0x3d]=4;
  assert(parseSpcVoices(outgoingNoise).candidates[1].pmonVariant.preset,'PMON cannot tune the next Noise voice, so no outgoing BRR chain exists');
  const noiseCarrier=pmonImage();noiseCarrier[DSP+0x3d]=2;
  assert.match(parseSpcVoices(noiseCarrier).candidates[1].pmonVariant.reason,/Noise is not tuned by PMON/);
  const bitZero=pmonImage();bitZero[DSP+0x2d]=3;
  const result=parseSpcVoices(bitZero);assert.equal(result.candidates[0].voice.pitchModulation,false);
  assert(result.candidates[1].pmonVariant.preset,'PMON bit zero does not create an incoming chain');
  assert.match(result.candidates[0].pmonVariant.reason,/no recorded PMON input/);assert.equal(result.candidates[0].pmonPair,null);
});

test('invalid PMON carriers retain their original reason in all variants, and modulator silence has its own warning', () => {
  for(const alter of [data=>voice(data,1,{pitch:0}),data=>sample(data,0,0x2000,BRR,0x2001)]) {
    const data=pmonImage();alter(data);const candidate=parseSpcVoices(data).candidates[1];assert.equal(candidate.preset,null);
    for(const variant of [candidate.echoVariant,candidate.pmonVariant,candidate.pmonEchoVariant]) {
      assert.equal(variant.preset,null);assert.equal(variant.reason,candidate.reason);
    }
  }
  for(const [gain,warning] of [[0,/Modulator Direct GAIN is zero/],[0x94,/Modulator decreasing GAIN/],[0xa4,/Modulator decreasing GAIN/],
    [0xc0,/Modulator increasing GAIN rate 0/],[0xe0,/Modulator increasing GAIN rate 0/]]) {
    const data=pmonImage();voice(data,0,{sourceNumber:1,adsr1:0,gain});
    const candidate=parseSpcVoices(data).candidates[1];assert(candidate.pmonVariant.preset);
    assert(candidate.pmonVariant.warnings.some(message=>warning.test(message)));
    assert(!candidate.warnings.some(message=>warning.test(message)),'modulator warnings do not leak into the unmodulated fallback');
  }
});

test('SPC PMON combined BRR budget accepts exact dry / Echo boundaries and never deduplicates shared SRCN', () => {
  for(const budget of [MAX_BRR_BYTES,ECHO_BRR_MAX_BYTES]) {
    for(const extra of [0,9]) {
      const data=echoRegisters(image()),carrier=new Uint8Array(budget-9+extra);carrier[carrier.length-9]=1;
      sample(data,0,1024,carrier,1024);sample(data,1,768,Uint8Array.of(3,0,0,0,0,0,0,0,0),768);
      voice(data,0,{sourceNumber:1});voice(data,1,{sourceNumber:0});data[DSP+0x2d]=2;
      const candidate=parseSpcVoices(data).candidates[1],variant=budget===MAX_BRR_BYTES?candidate.pmonVariant:candidate.pmonEchoVariant;
      assert(candidate.preset);assert.equal(candidate.pmonPair.sample.bytes,9);
      if(!extra){assert(variant.preset);assert.equal(variant.reason,null);}
      else {assert.equal(variant.preset,null);assert.match(variant.reason,new RegExp(budget.toLocaleString('en-US')));assert.match(variant.reason,/combined/);}
      if(budget===ECHO_BRR_MAX_BYTES) {
        assert(candidate.pmonVariant.preset,'Echo failure does not disable the dry pair');
        data[DSP+0x6c]=0x20;
        const disabled=parseSpcVoices(data).candidates[1].pmonEchoVariant;
        assert(disabled.preset,'captured Echo Off does not reserve wet RAM');assert.equal(disabled.preset.echo.enabled,false);
      }
    }
    for(const extra of [0,9]) {
      const size=budget/2+extra,data=echoRegisters(image()),bytes=new Uint8Array(size);bytes[size-9]=1;
      sample(data,0,1024,bytes,1024);data[DSP+0x2d]=2;
      const candidate=parseSpcVoices(data).candidates[1],variant=budget===MAX_BRR_BYTES?candidate.pmonVariant:candidate.pmonEchoVariant;
      assert.equal(candidate.sample.sourceNumber,candidate.pmonPair.sample.sourceNumber);
      if(!extra)assert(variant.preset,'two copies exactly fill the available sample budget');
      else {assert.equal(variant.preset,null);assert.match(variant.reason,/counted separately even when SRCN is shared/);}
    }
  }
});

test('SPC PMON Echo imports only the carrier send and respects write-disable without reserving wet RAM', () => {
  const data=pmonImage();data[DSP+0x4d]=1;
  let candidate=parseSpcVoices(data).candidates[1];
  assert.equal(candidate.pmonEchoVariant.preset.echo.send,false);assert.equal(candidate.pmonEchoVariant.preset.echo.enabled,true);
  assert(candidate.pmonEchoVariant.warnings.some(warning=>warning.includes('CH2 was not sent')));
  assert(candidate.pmonEchoVariant.warnings.some(warning=>warning.includes('modulator')&&warning.includes('Echo send is omitted')));
  data[DSP+0x4d]=2;data[DSP+0x6c]=0x20;candidate=parseSpcVoices(data).candidates[1];
  assert.equal(candidate.pmonEchoVariant.preset.echo.send,true);assert.equal(candidate.pmonEchoVariant.preset.echo.enabled,false);
  assert.equal(candidate.pmonEchoVariant.preset.echo.feedback,24);
  assert(candidate.pmonEchoVariant.warnings.some(warning=>warning.includes('writes are disabled')));
  assert(candidate.pmonEchoVariant.warnings.some(warning=>warning.includes('Frozen-buffer audio is not restored')));
});

test('imported PMON BRR pairs match a manual two-voice hardware reference and survive JSON / executable JavaScript in stereo', async t => {
  const candidate=parseSpcVoices(pmonImage()).candidates[1];
  const wasmBinary=await readFile(new URL('../generated/spc_wasm.wasm',import.meta.url));
  const createCore=()=>SnesDspCore.create({moduleFactory:factory,moduleOptions:{wasmBinary}});
  const makeInstrument=async preset=>{const instrument=new SnesInstrument(await createCore());t.after(()=>instrument.dispose());instrument.loadPreset(preset);return instrument;};
  const makeSynth=async()=>{const synth=new SnesSynth({core:await createCore()});t.after(()=>synth.dispose());return synth;};
  const options=brr=>({rootNote:brr.rootNote,basePitch:brr.basePitch,...(brr.loopStartSamples===null?{}:{loopStartSamples:brr.loopStartSamples})});
  const render=engine=>{const left=new Float32Array(4096),right=new Float32Array(4096);engine.renderInto(left,right);return {left,right};};
  for(const variant of [candidate.pmonVariant,candidate.pmonEchoVariant]) {
    const preset=variant.preset;assert(preset);assert.equal(preset.version,5);
    const instrument=await makeInstrument(preset),state=instrument.read();
    assert.equal(state.sample.byteLength,18);assert.equal(state.modulatorSample.byteLength,18);
    assert.equal(state.registers[0][8],0,'captured modulator ENVX does not preload the envelope');
    assert.equal(state.registers[1][8],0,'captured carrier ENVX does not preload the envelope');
    instrument.noteOn('pair',60);
    const active=instrument.read();assert.equal(active.capacity,4);assert.equal(active.pmonRegisters.mask,0xaa);
    assert.deepEqual(active.voices.map(value=>[value.channel,value.modulatorChannel]),[[1,0]]);
    assert.deepEqual(active.registers[0].slice(0,4),[0,0,0,8]);assert.deepEqual(active.registers[1].slice(0,4),[24,16,0,12]);
    assert.deepEqual(active.registers[0].slice(5,8),[0,0,64]);assert.deepEqual(active.registers[1].slice(5,8),[0x9f,0xe0,0x4f]);
    assert.equal(active.echoRegisters.eon,preset.echo.enabled&&preset.echo.send?0xaa:0);
    const actual=render(instrument);assert(actual.left.every(Number.isFinite));assert(actual.left.some(value=>Math.abs(value)>.001));
    assert(actual.left.some((value,index)=>value!==actual.right[index]),'signed return / voice levels retain stereo output');
    const manual=await makeSynth(),{send,...echo}=preset.echo;
    manual.setEcho({...echo,sendMask:send?2:0});
    const carrier=manual.loadBRR(decodeBase64(preset.brr.data),options(preset.brr));
    const modulator=manual.loadBRR(decodeBase64(preset.pmon.brr.data),options(preset.pmon.brr));
    manual.writeDsp(0x3d,0);manual.writeDsp(0x2d,2);
    manual.setPreset(0,{sample:modulator,...modulatorEnvelopeRegisters(preset),volumeLeft:0,volumeRight:0,pitch:2048});
    manual.setPreset(1,{sample:carrier,...envelopeRegisters(preset),volumeLeft:24,volumeRight:16,pitch:3072});
    manual.keyOn(0);manual.keyOn(1);
    assert.deepEqual(render(manual),actual,'imported pair reproduces the same raw DSP path as a manual BRR modulator / carrier setup');
    const restoredPreset=readPreset(JSON.parse(JSON.stringify(preset)));assert.deepEqual(restoredPreset,preset);
    const restored=await makeInstrument(restoredPreset);restored.noteOn('restored-pair',60);
    assert.deepEqual(render(restored),actual,'portable JSON owns both BRRs and envelopes without the source SPC');
    const exported=await makeSynth(),code=presetToCode(preset);
    assert(code.indexOf('setEcho')<code.indexOf('loadBRR'));assert.match(code,/writeDsp\(0x2d,\s*2\)/);
    const run=Object.getPrototypeOf(async function(){}).constructor('useSoundChip',code);
    await run(async chip=>{assert.equal(chip,'snes');return exported;});
    assert.deepEqual(render(exported),actual,'generated executable JavaScript matches the instrument in stereo');
    const unmodulated=await makeInstrument({...preset,pmon:{...preset.pmon,enabled:false}});unmodulated.noteOn('plain',60);
    assert.notDeepEqual(render(unmodulated),actual,'the imported modulator produces an audible hardware PMON effect');
  }
});

test('only eight physical records are offered, retaining inactive voices and distinct settings on the same BRR', () => {
  const source = image();
  voice(source,0,{left:-128,right:127,pitch:3072,adsr1:0x9b,adsr2:0x73,gain:0x1d,envx:64});
  voice(source,1,{left:0,right:-1,pitch:2048,adsr1:0x35,adsr2:0x98,gain:0xd4,outx:255});
  const result = parseSpcVoices(source,{name:'My snapshot.spc'});
  assert.equal(result.name,'My snapshot.spc');assert.equal(result.directory,2);
  assert.equal(result.candidates.length,8);assert.equal(ready(result).length,8);
  const [a,b,c] = result.candidates;
  assert.deepEqual([a.id,b.id,c.id],['voice-0','voice-1','voice-2']);
  assert.equal(a.voice.active,true);assert.equal(b.voice.active,true);assert.equal(c.voice.active,false);
  assert.equal(a.preset.brr.data,b.preset.brr.data);assert.notEqual(a.preset.name,b.preset.name);
  assert.deepEqual(a.preset.volume,{left:-128,right:127});assert.deepEqual(b.preset.volume,{left:0,right:-1});
  assert.equal(a.preset.brr.rootNote,60);assert.equal(a.preset.brr.basePitch,3072);assert.equal(b.preset.brr.basePitch,2048);
  assert.deepEqual(envelopeRegisters(a.preset),{adsr1:0x9b,adsr2:0x73,gain:0x1d});
  assert.deepEqual(envelopeRegisters(b.preset),{adsr1:0x35,adsr2:0x98,gain:0xd4});
  assert.deepEqual(decodeBase64(a.preset.brr.data),BRR);
  assert.deepEqual(a.sample,{sourceNumber:0,startAddress:0x2000,loopAddress:0x2000,bytes:18,frames:32,loopStartSamples:0});
  assert(result.warnings.some(warning=>warning.includes('ENVX / OUTX')));
  assert(result.warnings.some(warning=>warning.includes('not the original musical note')));
  // An unused directory slot pointing at invalid RAM does not become a candidate.
  assert.equal(result.candidates.every(candidate=>candidate.voice.sourceNumber===0),true);
});

test('all GAIN modes preserve raw register bytes and decreasing modes explain fresh key-on silence', () => {
  const modes = [[0x00,'direct'],[0x7f,'direct'],[0x80,'linear-decrease'],[0x9f,'linear-decrease'],
    [0xa0,'exponential-decrease'],[0xbf,'exponential-decrease'],[0xc1,'linear-increase'],[0xdf,'linear-increase'],[0xe0,'bent-increase'],[0xff,'bent-increase']];
  for (const [gain,mode] of modes) {
    const data=image();voice(data,0,{adsr1:0x75,adsr2:0xab,gain});
    const candidate=parseSpcVoices(data).candidates[0];
    assert.equal(candidate.preset.envelope.mode,'gain');assert.equal(candidate.preset.envelope.gainMode,mode);
    assert.deepEqual(envelopeRegisters(candidate.preset),{adsr1:0x75,adsr2:0xab,gain});
    assert.equal(candidate.preset.envelope.gainRate,gain & 31);
    assert.equal(candidate.warnings.some(warning=>warning.includes('Decreasing GAIN')),mode.includes('decrease'));
  }
});

test('resolved block loops survive, unresolved loops remain visible but cannot be adopted', () => {
  const second=image();sample(second,0,0x2000,BRR,0x2009);
  const loop=parseSpcVoices(second).candidates[0];
  assert.equal(loop.preset.brr.loopStartSamples,16);assert.equal(loop.sample.loopStartSamples,16);
  for (const address of [0x2001,0x2012,0x1000]) {
    const data=image();sample(data,0,0x2000,BRR,address);
    const candidate=parseSpcVoices(data).candidates[0];
    assert.equal(candidate.preset,null);assert.match(candidate.reason,/Loop target/);
    assert.equal(candidate.sample.loopAddress,address);assert.equal(candidate.sample.loopStartSamples,null);
  }
  const oneShot=image(),bytes=BRR.slice();bytes[9] &= ~2;sample(oneShot,0,0x2000,bytes,0x1234);
  assert.equal(parseSpcVoices(oneShot).candidates[0].preset.brr.loopStartSamples,null,'non-looping samples ignore a stale loop pointer');
});

test('16-bit RAM wrap is reconstructed without moving the original loop boundary', () => {
  const data=image();sample(data,0,65530,BRR,3);
  const candidate=parseSpcVoices(data).candidates[0];
  assert(candidate.preset);assert.deepEqual(decodeBase64(candidate.preset.brr.data),BRR);
  assert.equal(candidate.preset.brr.loopStartSamples,16);assert.equal(candidate.sample.startAddress,65530);
  assert(candidate.warnings.some(warning=>warning.includes('wraps')));
});

test('Noise is available at its shared clock; zero BRR PITCH stays unavailable and PMON / Echo omissions are explicit', () => {
  const data=image();data[DSP + 0x3d] = 1;data[DSP + 0x2d] = 5;data[DSP + 0x4d] = 4;
  voice(data,1,{pitch:0});voice(data,3,{left:0,right:0});
  const result=parseSpcVoices(data);
  assert.equal(result.candidates[0].preset.source,'noise');assert.equal(result.candidates[0].preset.noise.clock,0);
  assert.equal(result.candidates[0].sample,null);assert.equal(result.candidates[0].reason,null);
  assert.equal(result.candidates[1].preset,null);assert.match(result.candidates[1].reason,/PITCH is 0/);
  assert(result.candidates[2].preset);assert(result.candidates[2].warnings.some(warning=>warning.includes('PMON is not reproduced')));
  assert(result.candidates[2].warnings.some(warning=>warning.includes('Echo / FIR is not reproduced')));
  assert.equal(result.candidates[0].voice.pitchModulation,false,'PMON bit zero does not modulate voice zero');
  assert(result.candidates[3].warnings.some(warning=>warning.includes('volumes are zero')));
});

test('incomplete or over-budget BRR leaves valid SRCNs available without truncating or inventing END', () => {
  const data=image();
  // SRCN 1 starts in a long region with no END; the valid SRCN 0 is elsewhere.
  sample(data,1,0x3000,new Uint8Array(MAX_BRR_BYTES));
  // Long zero write wraps and overwrites directory: rebuild directory and good sample.
  data[DSP + 0x5d]=2;sample(data,0);sample(data,1,0x3000,new Uint8Array(9));
  voice(data,1,{sourceNumber:1});
  const result=parseSpcVoices(data);
  assert(result.candidates[0].preset);assert.equal(result.candidates[1].preset,null);
  assert.match(result.candidates[1].reason,/64,512 bytes/);assert.equal(result.candidates[1].sample,null);
  assert.deepEqual(decodeBase64(result.candidates[0].preset.brr.data),BRR);
});

test('sample at the RAM budget is accepted; the next complete block is not silently truncated', () => {
  const data=image(),exact=new Uint8Array(MAX_BRR_BYTES);exact[exact.length-9]=1;
  // Starting above the reserved directory leaves exactly the full permitted RAM budget.
  sample(data,0,1024,exact,1024);
  const full=parseSpcVoices(data).candidates[0];assert(full.preset);assert.equal(full.sample.bytes,MAX_BRR_BYTES);
  assert.equal(decodeBase64(full.preset.brr.data).length,MAX_BRR_BYTES);
  const oversize=image(),long=new Uint8Array(MAX_BRR_BYTES+9);long[long.length-9]=1;
  sample(oversize,0,1024,long,1024);
  const rejected=parseSpcVoices(oversize).candidates[0];assert.equal(rejected.preset,null);assert.match(rejected.reason,/64,512 bytes/);
});

test('SPC validation is bounded and rejects malformed bytes without accepting other formats', () => {
  assert.equal(MAX_SPC_BYTES,16*1024*1024);
  assert.throws(()=>parseSpcVoices(new Uint8Array(4)),/Truncated SPC/);
  const bad=image();bad[0]=0;assert.throws(()=>parseSpcVoices(bad),/signature/);
  const sentinel=image();sentinel[0x22]=0;assert.throws(()=>parseSpcVoices(sentinel),/signature/);
  assert.throws(()=>parseSpcVoices(new Uint8Array(MAX_SPC_BYTES+1)),/16 MiB/);
  assert.throws(()=>parseSpcVoices('not bytes'),/ArrayBuffer/);
  assert.throws(()=>parseSpcVoices(image(),{name:12}),/name must be a string/);
  const short=image().slice(0,0x10180);assert.equal(ready(parseSpcVoices(short)).length,8);
});

test('file/tag names are bounded and sanitized, presets and voice records own their data', () => {
  const data=image();data[0x23]=0x1a;
  data.set(new TextEncoder().encode('A\nTitle\u0001'),0x2e);data.set(new TextEncoder().encode('Game'),0x4e);
  const before=data.slice(),result=parseSpcVoices(new DataView(data.buffer),{name:'\u0000  file\n'+ 'x'.repeat(500)});
  assert.equal(result.name.length,160);assert(!/[\u0000-\u001f]/.test(result.name));
  assert.equal(result.metadata.title,'A Title');assert.equal(result.metadata.game,'Game');
  const [a,b]=result.candidates;assert.equal(readPreset(a.preset).name,a.preset.name);
  a.preset.volume.left=90;a.voice.pitch=3;a.preset.wave[0]=1;
  assert.equal(b.preset.volume.left,16);assert.equal(b.voice.pitch,4096);assert.notEqual(b.preset.wave[0],1);
  assert.deepEqual(data,before,'parsing does not rewrite the source snapshot');
  data.fill(0);assert.deepEqual(decodeBase64(b.preset.brr.data),BRR,'returned sample no longer aliases the file');
});

test('a selected preset uses the captured hardware PITCH and envelope in the actual S-DSP without restoring snapshot ENVX', async t => {
  const data=image();voice(data,0,{pitch:3072,left:24,right:-16,adsr1:0x95,adsr2:0x9a,gain:0x47,envx:120,outx:70});
  const candidate=parseSpcVoices(data).candidates[0];
  const wasmBinary=await readFile(new URL('../generated/spc_wasm.wasm',import.meta.url));
  const core=await SnesDspCore.create({moduleFactory:factory,moduleOptions:{wasmBinary}});
  const instrument=new SnesInstrument(core);t.after(()=>instrument.dispose());
  instrument.loadPreset(candidate.preset);
  assert.equal(instrument.read().registers[0][8],0,'captured ENVX is not a preloaded envelope');
  instrument.noteOn('imported',60);
  let row=instrument.read().registers[0];
  assert.deepEqual(row.slice(0,4),[24,240,0,12]);assert.deepEqual(row.slice(5,8),[0x95,0x9a,0x47]);
  const left=new Float32Array(4096),right=new Float32Array(4096);instrument.renderInto(left,right);
  assert(left.every(Number.isFinite));assert(left.some(value=>Math.abs(value)>.001));
  assert(right.every(Number.isFinite));assert(left.some((value,index)=>value!==right[index]));
  instrument.noteOn('octave',72);row=instrument.read().registers[1];assert.equal(row[2]|row[3]<<8,6144);
  const loaded=instrument.read().preset;assert.deepEqual(loaded,readPreset(JSON.parse(JSON.stringify(candidate.preset))));
});

test('SPC Echo captures signed shared registers, EDL hardware bits and each selected voice send without changing the dry variant', () => {
  const fir=[-128,-1,0,1,64,126,127,-64];
  const data=echoRegisters(image(),{delay:0xa7,feedback:-128,left:-1,right:127,sendMask:0x81,fir,address:0xbc});
  const before=data.slice(),result=parseSpcVoices(data);
  assert.deepEqual(result.echo,{enabled:true,delay:7,feedback:-128,volumeLeft:-1,volumeRight:127,
    fir,sendMask:0x81,sourceAddress:0xbc00});
  const [a,b]=result.candidates;
  assert(a.echoVariant.preset);assert.equal(a.echoVariant.reason,null);
  assert.deepEqual(a.echoVariant.preset.echo,{enabled:true,delay:7,feedback:-128,volumeLeft:-1,volumeRight:127,send:true,fir});
  assert.equal(b.echoVariant.preset.echo.send,false);assert.equal(result.candidates[7].echoVariant.preset.echo.send,true);
  assert.equal(a.preset.echo.enabled,false);assert.equal(a.preset.echo.feedback,32);
  assert.equal(a.preset.brr.data,a.echoVariant.preset.brr.data);
  assert(a.warnings.some(warning=>warning.includes('Echo / FIR is not reproduced')));
  assert(!a.echoVariant.warnings.some(warning=>warning.includes('Echo / FIR is not reproduced')));
  assert(a.echoVariant.warnings.some(warning=>warning.includes('empty buffer')));
  assert(b.echoVariant.warnings.some(warning=>warning.includes('Send all notes is imported Off')));
  // Metadata and both modes own their arrays; editing any one cannot retarget another row.
  result.echo.fir[0]=12;a.echoVariant.preset.echo.fir[0]=99;
  assert.equal(result.candidates[7].echoVariant.preset.echo.fir[0],-128);
  assert.equal(a.preset.echo.fir[0],127);
  a.echoVariant.preset.volume.left=70;assert.equal(a.preset.volume.left,16);
  assert.deepEqual(data,before);
  data.fill(0);assert.deepEqual(decodeBase64(a.echoVariant.preset.brr.data),BRR);
});

test('Echo write-disable, zero Return and voice EON are separate saved settings, not an enable heuristic', () => {
  const data=echoRegisters(image(),{flags:0x20,delay:0xf0,feedback:-16,left:-64,right:31,sendMask:1,
    fir:[64,32,16,8,4,2,1,-1]});
  const disabled=parseSpcVoices(data);
  assert.equal(disabled.echo.enabled,false);assert.equal(disabled.echo.delay,0);
  const echo=disabled.candidates[0].echoVariant;
  assert(echo.preset);assert.equal(echo.preset.echo.enabled,false);assert.equal(echo.preset.echo.send,true);
  assert.equal(echo.preset.echo.feedback,-16);assert.equal(echo.preset.echo.volumeLeft,-64);
  assert.deepEqual(echo.preset.echo.fir,[64,32,16,8,4,2,1,-1]);
  assert(echo.warnings.some(warning=>warning.includes('writes are disabled')));
  assert(echo.warnings.some(warning=>warning.includes('Frozen-buffer audio is not restored')));
  echoRegisters(data,{flags:0,left:0,right:0,sendMask:0});
  const silent=parseSpcVoices(data).candidates[0].echoVariant;
  assert(silent.preset.echo.enabled);assert.equal(silent.preset.echo.send,false);
  assert.equal(silent.preset.echo.volumeLeft,0);assert.equal(silent.preset.echo.volumeRight,0);
  assert(silent.warnings.some(warning=>warning.includes('Return values are zero')));
  assert(silent.warnings.some(warning=>warning.includes('Send all notes is imported Off')));
});

test('Echo budget rejects only its variant, with exact boundary support and large dry samples retained', () => {
  for (const size of [ECHO_BRR_MAX_BYTES,ECHO_BRR_MAX_BYTES+9,MAX_BRR_BYTES]) {
    const data=echoRegisters(image()),bytes=new Uint8Array(size);bytes[size-9]=1;
    sample(data,0,1024,bytes,1024);
    const candidate=parseSpcVoices(data).candidates[0];
    assert(candidate.preset);assert.equal(decodeBase64(candidate.preset.brr.data).length,size);
    if(size===ECHO_BRR_MAX_BYTES) {
      assert(candidate.echoVariant.preset);assert.equal(candidate.echoVariant.reason,null);
    } else {
      assert.equal(candidate.echoVariant.preset,null);assert.match(candidate.echoVariant.reason,/33,786/);
      assert.equal(candidate.reason,null);assert.equal(candidate.preset.echo.enabled,false);
    }
    data[DSP+0x6c]=0x20;
    const disabled=parseSpcVoices(data).candidates[0].echoVariant;
    assert(disabled.preset,'retaining disabled parameters does not reserve Echo RAM');
    assert.equal(disabled.preset.echo.enabled,false);assert.equal(decodeBase64(disabled.preset.brr.data).length,size);
  }
});

test('unavailable voices keep their original reason in both variants while PMON stays explicitly omitted', () => {
  const data=echoRegisters(image(),{sendMask:255});
  data[DSP+0x3d]=1;voice(data,1,{pitch:0});sample(data,1,0x2400,BRR,0x2401);voice(data,2,{sourceNumber:1});
  data[DSP+0x2d]=8;
  const result=parseSpcVoices(data);
  assert.equal(result.candidates[0].preset.source,'noise');assert(result.candidates[0].echoVariant.preset);
  for(const index of [1,2]) {
    const candidate=result.candidates[index];
    assert.equal(candidate.preset,null);assert.equal(candidate.echoVariant.preset,null);
    assert.equal(candidate.echoVariant.reason,candidate.reason);
  }
  const pmon=result.candidates[3];assert(pmon.echoVariant.preset);
  assert(pmon.echoVariant.warnings.some(warning=>warning.includes('PMON is not reproduced')));
  assert(pmon.echoVariant.warnings.some(warning=>warning.includes('empty buffer')));
});

test('SPC Noise ignores invalid SRCN, missing END, bad loop pointers and captured PITCH while preserving voice controls', () => {
  const data=image();sample(data,255,0x2400,new Uint8Array(9),0x2401);
  voice(data,0,{sourceNumber:255,pitch:0,left:-40,right:32,adsr1:0x35,adsr2:0x73,gain:0xa7,envx:32});
  voice(data,1,{sourceNumber:255,pitch:16383,left:24,right:-16,adsr1:0x9b,adsr2:0x81,gain:0x4f});
  data[DSP+0x3d]=3;data[DSP+0x6c]=0x20|31;
  const original=data.slice(),result=parseSpcVoices(data,{name:'Noise source.spc'}),[a,b]=result.candidates;
  assert.equal(result.noiseClock,31);assert.equal(result.candidates.length,8);
  for(const candidate of [a,b]) {
    assert.equal(candidate.reason,null);assert.equal(candidate.sample,null);assert.equal(candidate.preset.source,'noise');
    assert.equal(candidate.preset.noise.clock,31);assert.equal(candidate.preset.brr.data,'');
    assert.equal(candidate.preset.brr.basePitch,4096);assert.equal(candidate.preset.brr.loopStartSamples,null);
    assert.match(candidate.preset.name,/Noise$/);assert(!candidate.preset.name.includes('SRCN'));
    assert(candidate.echoVariant.preset);assert.equal(candidate.echoVariant.preset.source,'noise');
    assert.equal(candidate.echoVariant.preset.noise.clock,31);
  }
  assert.equal(a.voice.pitch,0);assert.equal(b.voice.pitch,16383);assert.equal(a.voice.sourceNumber,255);
  assert.deepEqual(a.preset.volume,{left:-40,right:32});assert.deepEqual(envelopeRegisters(a.preset),{adsr1:0x35,adsr2:0x73,gain:0xa7});
  assert.deepEqual(b.preset.volume,{left:24,right:-16});assert.deepEqual(envelopeRegisters(b.preset),{adsr1:0x9b,adsr2:0x81,gain:0x4f});
  assert(result.candidates[2].preset.source==='brr','unrelated melodic source is still extracted');
  assert(!a.warnings.some(warning=>/BRR END|Loop target/.test(warning)));
  assert(result.warnings.some(warning=>warning.includes('LFSR state is not restored')));
  assert.deepEqual(data,original);
});

test('all-Noise snapshots need no BRR extraction, retain inactive voices and own independent clock / Echo data', () => {
  const data=image();data.fill(0,RAM,RAM+65536);data[DSP+0x5d]=255;data[DSP+0x3d]=255;data[DSP+0x6c]=0x20|17;
  for(let index=0;index<8;index++) voice(data,index,{sourceNumber:255,pitch:0});
  const before=data.slice(),result=parseSpcVoices(data);
  assert.equal(result.directory,255);assert.equal(result.noiseClock,17);assert.equal(ready(result).length,8);
  assert(result.candidates.every(candidate=>candidate.sample===null&&candidate.reason===null&&candidate.preset.source==='noise'));
  assert(result.candidates.every(candidate=>candidate.voice.active===false));
  assert(!result.warnings.some(warning=>/No voice has nonzero|BRR END|budget/.test(warning)));
  const [a,b]=result.candidates;a.preset.noise.clock=3;a.echoVariant.preset.noise.clock=7;a.preset.echo.fir[0]=20;
  assert.equal(b.preset.noise.clock,17);assert.equal(b.echoVariant.preset.noise.clock,17);
  assert.equal(b.preset.echo.fir[0],127);assert.equal(result.noiseClock,17);
  assert.deepEqual(data,before);data.fill(0);assert.equal(b.preset.noise.clock,17);
});

test('SPC Noise clock zero, PMON and optional Echo retain separate hardware meanings', () => {
  const data=echoRegisters(image(),{flags:0,delay:3,feedback:-20,left:30,right:-15,sendMask:2,fir:[100,20,-10,5,0,0,0,0]});
  data[DSP+0x3d]=2;data[DSP+0x2d]=2;voice(data,1,{sourceNumber:255,pitch:0});
  const result=parseSpcVoices(data),noise=result.candidates[1];
  assert.equal(result.noiseClock,0);assert.equal(noise.preset.source,'noise');assert.equal(noise.preset.noise.clock,0);
  assert.equal(noise.preset.echo.enabled,false);assert.equal(noise.sample,null);
  assert(noise.warnings.some(warning=>warning.includes('clock 0 holds')));
  assert(noise.warnings.some(warning=>warning.includes('PMON is not imported')));
  assert(noise.warnings.some(warning=>warning.includes('does not tune hardware Noise')));
  assert(noise.echoVariant.preset.echo.enabled);assert(noise.echoVariant.preset.echo.send);
  assert.equal(noise.echoVariant.preset.echo.delay,3);assert.equal(noise.echoVariant.preset.echo.feedback,-20);
  assert.deepEqual(noise.echoVariant.preset.echo.fir,[100,20,-10,5,0,0,0,0]);
  data[DSP+0x6c]=0xe5;
  const disabled=parseSpcVoices(data).candidates[1].echoVariant.preset;
  assert.equal(disabled.noise.clock,5,'upper flag bits do not become Noise clock bits');
  assert.equal(disabled.echo.enabled,false);assert.equal(disabled.echo.feedback,-20);
});

test('SPC Noise renders real shared hardware Noise independently of captured musical PITCH and retains clock zero', async t => {
  const data=image();data[DSP+0x3d]=1;data[DSP+0x6c]=0x20|31;
  voice(data,0,{sourceNumber:255,pitch:0,adsr1:0,adsr2:0,gain:96,left:20,right:16});
  const preset=parseSpcVoices(data).candidates[0].preset;assert(preset);
  const wasmBinary=await readFile(new URL('../generated/spc_wasm.wasm',import.meta.url));
  const create=async()=>{const core=await SnesDspCore.create({moduleFactory:factory,moduleOptions:{wasmBinary}});const instrument=new SnesInstrument(core);t.after(()=>instrument.dispose());instrument.loadPreset(preset);return {core,instrument};};
  const a=await create(),b=await create();
  assert.equal(a.instrument.read().noiseRegisters.non,255);assert.equal(a.instrument.read().noiseRegisters.clock,31);
  assert.equal(a.instrument.read().sample.byteLength,9,'Noise uses the safe internal carrier rather than the invalid SRCN');
  a.instrument.noteOn('low',36);b.instrument.noteOn('high',96);b.instrument.setPitch(2);
  const al=new Float32Array(2048),ar=new Float32Array(2048),bl=new Float32Array(2048),br=new Float32Array(2048);
  a.instrument.renderInto(al,ar);b.instrument.renderInto(bl,br);
  assert.deepEqual(al,bl);assert.deepEqual(ar,br,'note / Pitch are not Noise tuning controls');
  assert(al.every(Number.isFinite));assert(al.some(value=>Math.abs(value)>.001));
  assert(new Set(al.slice(512)).size>100,'clock 31 advances the hardware Noise sequence');
  const owner=a.instrument.read().voices[0].id,generation=a.instrument.generation,frames=a.core.nativeFrames;
  a.instrument.setPreset({...preset,noise:{clock:0}});
  assert.equal(a.instrument.read().voices[0].id,owner);assert.equal(a.instrument.generation,generation);assert.equal(a.core.nativeFrames,frames);
  a.instrument.renderInto(al,ar);assert(al.slice(128).every(value=>value===al[128]),'clock zero holds the current shared generator value');
});

test('SPC Noise with captured Echo survives JSON and executable code with the same stereo PCM and tail', async t => {
  const data=echoRegisters(image(),{flags:31,delay:2,feedback:40,left:48,right:-20,sendMask:1,fir:[90,16,-8,4,0,0,0,0]});
  data[DSP+0x3d]=1;voice(data,0,{sourceNumber:255,pitch:0,adsr1:0,adsr2:0,gain:96,left:24,right:16});
  const candidate=parseSpcVoices(data).candidates[0],preset=candidate.echoVariant.preset;
  assert(preset);assert.equal(preset.source,'noise');assert.equal(preset.noise.clock,31);
  assert.deepEqual(readPreset(JSON.parse(JSON.stringify(preset))),preset);
  const wasmBinary=await readFile(new URL('../generated/spc_wasm.wasm',import.meta.url));
  const createCore=()=>SnesDspCore.create({moduleFactory:factory,moduleOptions:{wasmBinary}});
  const core=await createCore(),instrument=new SnesInstrument(core);t.after(()=>instrument.dispose());instrument.loadPreset(preset);
  assert.equal(instrument.read().noiseRegisters.flg,31);assert.equal(instrument.read().echoRegisters.eon,255);
  assert.equal(instrument.read().sample.byteLength,9);assert.equal(instrument.read().memory.directoryAddress,0x7800);
  instrument.noteOn('noise',60);
  const left=new Float32Array(2048),right=new Float32Array(2048);instrument.renderInto(left,right);
  const exportedCore=await createCore(),exported=new SnesSynth({core:exportedCore});t.after(()=>exported.dispose());
  const code=presetToCode(preset);assert.match(code,/writeDsp/);
  const run=Object.getPrototypeOf(async function(){}).constructor('useSoundChip',code);
  await run(async kind=>{assert.equal(kind,'snes');return exported;});
  const codeLeft=new Float32Array(2048),codeRight=new Float32Array(2048);exported.renderInto(codeLeft,codeRight);
  assert.deepEqual(codeLeft,left);assert.deepEqual(codeRight,right);
  instrument.noteOff('noise');const tail=new Float32Array(4096),tailRight=new Float32Array(4096);instrument.renderInto(tail,tailRight);
  assert(tail.slice(512,3072).some(value=>Math.abs(value)>.00001),'Noise is routed through the actual shared Echo path');
  instrument.loadPreset(candidate.preset);instrument.noteOn('dry-noise',60);instrument.renderInto(left,right);instrument.noteOff('dry-noise');instrument.renderInto(tail,tailRight);
  assert(tail.slice(512).every(value=>value===0),'dry import leaves no prior Echo tail');
});

test('Echo-imported preset renders the captured parameters in real S-DSP, starts empty and survives JSON / executable JS export', async t => {
  const data=echoRegisters(image(),{delay:2,feedback:40,left:48,right:-32,fir:[80,16,-8,4,0,0,0,0]});
  voice(data,0,{pitch:3072,left:24,right:16,adsr1:0x8f,adsr2:0xe0,gain:96});
  sample(data,0,0x2000,BRR,0x2009);
  data.fill(0x66,RAM+0x4000,RAM+0x4100); // Captured Echo contents deliberately differ from a fresh buffer.
  const candidate=parseSpcVoices(data).candidates[0],preset=candidate.echoVariant.preset;
  assert(preset);assert.deepEqual(readPreset(JSON.parse(JSON.stringify(preset))),preset);
  const wasmBinary=await readFile(new URL('../generated/spc_wasm.wasm',import.meta.url));
  const createCore=()=>SnesDspCore.create({moduleFactory:factory,moduleOptions:{wasmBinary}});
  const core=await createCore(),instrument=new SnesInstrument(core);t.after(()=>instrument.dispose());
  instrument.loadPreset(preset);
  const state=instrument.read();assert.deepEqual(state.echoRegisters,{flg:0,esa:0,edl:2,efb:40,eon:255,
    volumeLeft:48,volumeRight:224,fir:[80,16,248,4,0,0,0,0]});
  assert.equal(state.memory.directoryAddress,0x7800);assert.equal(state.sample.startAddress,0x7c00);
  assert.equal(state.preset.brr.loopStartSamples,16);
  assert(core.snapshot().ram.subarray(0,0x7800).every(value=>value===0),'past Echo RAM is not restored');
  instrument.noteOn('captured-echo',60);
  const left=new Float32Array(2048),right=new Float32Array(2048);instrument.renderInto(left,right);
  assert(left.every(Number.isFinite));assert(left.some(value=>Math.abs(value)>.001));
  assert(right.every(Number.isFinite));

  const exportedCore=await createCore(),exported=new SnesSynth({core:exportedCore});t.after(()=>exported.dispose());
  const code=presetToCode(preset);
  assert(code.indexOf('setEcho')<code.indexOf('loadBRR'));
  const run=Object.getPrototypeOf(async function(){}).constructor('useSoundChip',code);
  await run(async kind=>{assert.equal(kind,'snes');return exported;});
  const codeLeft=new Float32Array(2048),codeRight=new Float32Array(2048);exported.renderInto(codeLeft,codeRight);
  assert.deepEqual(codeLeft,left);assert.deepEqual(codeRight,right,'exported code uses the actual same Echo / BRR path');

  instrument.noteOff('captured-echo');
  const tail=new Float32Array(4096),tailRight=new Float32Array(4096);instrument.renderInto(tail,tailRight);
  assert(tail.slice(512,3072).some(value=>Math.abs(value)>.00001),'captured Echo continues after dry KOFF release');
  instrument.loadPreset(candidate.preset);instrument.noteOn('dry',60);instrument.renderInto(left,right);instrument.noteOff('dry');instrument.renderInto(tail,tailRight);
  assert(tail.slice(512).every(value=>value===0),'dry variant does not pick up imported Echo settings');
});
