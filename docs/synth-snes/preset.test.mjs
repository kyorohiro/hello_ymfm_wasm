// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createDefaultPreset,createDefaultEcho,createDefaultNoise,readPreset,waveShape,envelopeRegisters,presetToCode,echoOptions,ECHO_BRR_MAX_BYTES} from './preset.js';
import {encodeBase64} from './sample.js';
import {encodeBrr} from '../js/snes_brr_encoder.js';

test('default preset is portable, detached and leaves eight-voice hardware headroom',()=>{
  const preset=createDefaultPreset(),copy=readPreset(JSON.parse(JSON.stringify(preset)));
  assert.deepEqual(copy,preset);assert.equal(copy.format,'tetorica-sdsp-voice');assert.equal(copy.version,3);
  assert.deepEqual(copy.volume,{left:16,right:16});assert.equal(copy.wave.length,128);
  copy.wave[0]=.3;copy.volume.left=127;copy.envelope.attack=0;copy.echo.fir[0]=0;
  assert.equal(preset.wave[0],0);assert.equal(preset.volume.left,16);assert.equal(preset.envelope.attack,15);
  assert.deepEqual(envelopeRegisters(preset),{adsr1:175,adsr2:224,gain:96});
  assert.deepEqual(preset.echo,createDefaultEcho());
});

test('ADSR and all five GAIN modes map to exact register bit fields',()=>{
  const p=createDefaultPreset();p.envelope={...p.envelope,mode:'gain',attack:3,decay:5,sustainLevel:4,sustainRate:17,gainLevel:93,gainRate:19};
  for(const [mode,gain]of[['direct',93],['linear-decrease',147],['exponential-decrease',179],['linear-increase',211],['bent-increase',243]]) {
    p.envelope.gainMode=mode;assert.deepEqual(envelopeRegisters(p),{adsr1:83,adsr2:145,gain});
  }
  p.envelope.mode='adsr';assert.equal(envelopeRegisters(p).adsr1,211);
});

test('strict preset validation rejects unknown fields, invalid floats and malformed BRR atomically',()=>{
  const p=createDefaultPreset();
  const mutations=[x=>x.extra=1,x=>x.version=4,x=>x.source='other',x=>x.name='bad\nname',x=>x.wave.pop(),
    x=>delete x.wave[1],x=>x.wave[0]=NaN,x=>x.wave[0]=1.01,x=>x.volume.left=128,x=>x.volume.right=-129,
    x=>x.volume.left=1.5,x=>x.envelope.extra=true,x=>x.envelope.mode='software',x=>x.envelope.attack=16,
    x=>x.envelope.decay=8,x=>x.envelope.sustainLevel=8,x=>x.envelope.sustainRate=32,x=>x.envelope.gainMode='unknown',
    x=>x.envelope.gainLevel=128,x=>x.envelope.gainRate=32,x=>x.brr.rootNote=-1,x=>x.brr.basePitch=0,
    x=>x.brr.data='not base64',x=>x.brr.loopStartSamples=0];
  for(const mutate of mutations){const value=structuredClone(p);mutate(value);assert.throws(()=>readPreset(value));}
  const original=structuredClone(p);assert.deepEqual(p,original);
});

test('BRR presets require matching END/LOOP metadata and preserve declared root rather than guessing it',()=>{
  const encoded=encodeBrr(Float32Array.from(waveShape('sine')),{loopStartSamples:0});
  const p=createDefaultPreset();p.source='brr';p.brr={name:'custom.brr',data:encodeBase64(encoded.brr),rootNote:42,basePitch:2048,loopStartSamples:0};
  assert.deepEqual(readPreset(p),p);
  for(const loop of [null,1,16*128]) {const value=structuredClone(p);value.brr.loopStartSamples=loop;assert.throws(()=>readPreset(value));}
  const noLoop=encodeBrr(Float32Array.of(.1,.2,.3));p.brr.data=encodeBase64(noLoop.brr);p.brr.loopStartSamples=null;
  assert.deepEqual(readPreset(p),p);p.brr.loopStartSamples=0;assert.throws(()=>readPreset(p));
});

test('shapes return independent normalized 128-frame cycles',()=>{
  for(const shape of ['sine','triangle','saw','square']) {
    const values=waveShape(shape);assert.equal(values.length,128);assert(values.every(v=>Number.isFinite(v)&&v>=-1&&v<=1));
    values[0]=9;assert.notEqual(waveShape(shape)[0],9);
  }
  assert.throws(()=>waveShape('noise'));
});

test('copied JavaScript uses the initialized SNES API and explicit raw BRR tuning',async()=>{
  const empty=createDefaultPreset();empty.source='brr';assert.throws(()=>presetToCode(empty),/Load a BRR/);
  for(const source of ['wave','brr','noise']) {
    const p=createDefaultPreset();p.source=source;
    if(source==='brr'){const encoded=encodeBrr(Float32Array.of(.1,.2,.3));p.brr={name:'test',data:encodeBase64(encoded.brr),rootNote:61,basePitch:2048,loopStartSamples:null};}
    p.echo={...p.echo,enabled:true,delay:3,feedback:-40,volumeLeft:40,volumeRight:-32,send:false,fir:[80,32,16,0,0,0,0,0]};
    const calls=[],snes=Object.fromEntries(['allNotesOff','setEcho','loadBRR','writeDsp','readDsp','setPreset','noteOn','noteOff'].map(method=>[method,(...args)=>{calls.push([method,...args]);return method==='loadBRR'?{id:0}:method==='readDsp'?0:undefined;}]));
    const context=vm.createContext({useSoundChip:async mode=>{assert.equal(mode,'snes');return snes;},pg:{encodeBrr},Float32Array,Uint8Array});
    await vm.runInContext(`(async()=>{${presetToCode(p)}\n})()`,context);
    assert.equal(calls[0][0],'allNotesOff');assert.equal(calls[1][0],'setEcho');assert.equal(calls[2][0],'loadBRR');assert.deepEqual(calls[3],['writeDsp',0x3d,source==='noise'?1:0]);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1])),echoOptions(p.echo));
    assert.deepEqual(calls.at(-1),['noteOn',0,'C4']);assert.equal(calls.find(call=>call[0]==='setPreset')[2].adsr1,175);
    const options=calls[2][2];
    if(source==='wave'){assert.equal(options.baseFrequencyHz,250);assert.equal(options.loopStartSamples,0);}
    else if(source==='noise'){assert.equal(options.rootNote,60);assert.equal(options.basePitch,4096);assert.equal(options.loopStartSamples,0);assert.deepEqual(calls.find(call=>call[0]==='writeDsp'&&call[1]===0x6c),['writeDsp',0x6c,31]);}
    else {assert.equal(options.rootNote,61);assert.equal(options.basePitch,2048);assert(!('loopStartSamples'in options));}
  }
});

test('legacy v1 and v2 imports normalize to v3 with Noise defaults while preserving their voice and Echo',()=>{
  const old=createDefaultPreset();delete old.echo;delete old.noise;old.version=1;
  const migrated=readPreset(JSON.parse(JSON.stringify(old)));
  assert.equal(migrated.version,3);assert.deepEqual(migrated.echo,createDefaultEcho());assert.deepEqual(migrated.noise,createDefaultNoise());
  const {echo:oldEcho,noise:oldNoise,...migratedVoice}=migrated;assert.deepEqual({...migratedVoice,version:1},old);
  const p=createDefaultPreset();p.echo={enabled:true,delay:0,feedback:-128,volumeLeft:127,volumeRight:-128,send:false,fir:[-128,127,-1,0,1,2,3,4]};
  const v2={...structuredClone(p),version:2};delete v2.noise;assert.deepEqual(readPreset(v2),p);
  const copy=readPreset(p);assert.deepEqual(copy,p);copy.echo.fir[0]=5;assert.equal(p.echo.fir[0],-128);
  assert.deepEqual(echoOptions(p.echo),{enabled:true,delay:0,feedback:-128,volumeLeft:127,volumeRight:-128,fir:[-128,127,-1,0,1,2,3,4],sendMask:0});
  assert.throws(()=>readPreset({...old,echo:createDefaultEcho()}),/unexpected/);
  const missing=structuredClone(p);delete missing.echo;assert.throws(()=>readPreset(missing),/missing/);
});

test('Echo validation is strict and rejects bad scalar / FIR data before accepting a preset',()=>{
  const p=createDefaultPreset();
  const changes=[e=>e.extra=true,e=>e.enabled=1,e=>e.send='yes',e=>e.delay=-1,e=>e.delay=16,e=>e.delay=.5,
    e=>e.feedback=-129,e=>e.feedback=128,e=>e.volumeLeft=NaN,e=>e.volumeRight=1.5,
    e=>e.fir.pop(),e=>delete e.fir[2],e=>e.fir[0]=128,e=>e.fir[1]=-129,e=>e.fir.extra=1];
  for(const change of changes){const draft=structuredClone(p);change(draft.echo);assert.throws(()=>readPreset(draft));}
  assert.deepEqual(p.echo,createDefaultEcho());
});

test('Echo sample capacity is checked on the selected BRR source without trimming legacy dry banks',()=>{
  const makeBrr=bytes=>{const p=createDefaultPreset(),data=new Uint8Array(bytes);data[bytes-9]=1;
    p.source='brr';p.brr={...p.brr,name:'RAM boundary',data:encodeBase64(data)};return p;};
  assert.equal(ECHO_BRR_MAX_BYTES,33786);
  const exact=makeBrr(ECHO_BRR_MAX_BYTES);exact.echo.enabled=true;assert.deepEqual(readPreset(exact),exact);
  const extra=makeBrr(ECHO_BRR_MAX_BYTES+9);extra.echo.enabled=true;assert.throws(()=>readPreset(extra),/33,786/);
  extra.echo.enabled=false;assert.deepEqual(readPreset(extra),extra);
  extra.echo.enabled=true;extra.source='wave';assert.deepEqual(readPreset(extra),extra,'inactive BRR draft does not consume the drawn wave bank');
  const legacy=makeBrr(64512);legacy.version=1;delete legacy.echo;delete legacy.noise;
  const loaded=readPreset(legacy);assert.equal(loaded.echo.enabled,false);assert.equal(loaded.brr.data.length,legacy.brr.data.length);
});

test('v3 Noise clocks are bounded and independent of inactive BRR tuning or Echo sample capacity',()=>{
  const preset=createDefaultPreset();preset.source='noise';preset.echo.enabled=true;
  const bytes=new Uint8Array(64512);bytes[bytes.length-9]=1;
  preset.brr={...preset.brr,data:encodeBase64(bytes)};
  assert.deepEqual(readPreset(preset),preset,'Noise does not upload its inactive BRR draft');
  preset.noise.clock=0;const copy=readPreset(JSON.parse(JSON.stringify(preset)));
  assert.equal(copy.noise.clock,0);copy.noise.clock=25;assert.equal(preset.noise.clock,0);
  for(const clock of [-1,32,.5,NaN,Infinity,'31',null]) assert.throws(()=>readPreset({...preset,noise:{clock}}));
  for(const noise of [null,{},[],{clock:1,extra:true}]) assert.throws(()=>readPreset({...preset,noise}));
  const missing=structuredClone(preset);delete missing.noise;assert.throws(()=>readPreset(missing),/missing/);
  const old={...structuredClone(preset),version:2};delete old.noise;
  assert.throws(()=>readPreset(old),/v3 Noise/,'old formats cannot silently invent a new source mode');
});
