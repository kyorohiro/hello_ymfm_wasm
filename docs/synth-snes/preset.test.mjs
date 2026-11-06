// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createDefaultPreset,createDefaultEcho,createDefaultNoise,createDefaultPmon,readPreset,waveShape,envelopeRegisters,modulatorEnvelopeRegisters,presetToCode,echoOptions,ECHO_BRR_MAX_BYTES,PMON_MODULATOR_BYTES,pmonActive,pmonSampleBytes,sampleBudget,presetBankKey} from './preset.js';
import {encodeBase64} from './sample.js';
import {encodeBrr} from '../js/snes_brr_encoder.js';

test('default preset is portable, detached and leaves eight-voice hardware headroom',()=>{
  const preset=createDefaultPreset(),copy=readPreset(JSON.parse(JSON.stringify(preset)));
  assert.deepEqual(copy,preset);assert.equal(copy.format,'tetorica-sdsp-voice');assert.equal(copy.version,5);
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
  const mutations=[x=>x.extra=1,x=>x.version=6,x=>x.source='other',x=>x.name='bad\nname',x=>x.wave.pop(),
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

test('legacy v1 through v4 imports normalize to v5 while preserving voice, Noise, Echo and authored wave PMON',()=>{
  const old=createDefaultPreset();delete old.echo;delete old.noise;delete old.pmon;old.version=1;
  const migrated=readPreset(JSON.parse(JSON.stringify(old)));
  assert.equal(migrated.version,5);assert.deepEqual(migrated.echo,createDefaultEcho());assert.deepEqual(migrated.noise,createDefaultNoise());assert.deepEqual(migrated.pmon,createDefaultPmon());
  const {echo:oldEcho,noise:oldNoise,pmon:oldPmon,...migratedVoice}=migrated;assert.deepEqual({...migratedVoice,version:1},old);
  const p=createDefaultPreset();p.echo={enabled:true,delay:0,feedback:-128,volumeLeft:127,volumeRight:-128,send:false,fir:[-128,127,-1,0,1,2,3,4]};
  const v2={...structuredClone(p),version:2};delete v2.noise;delete v2.pmon;assert.deepEqual(readPreset(v2),p);
  const v3={...structuredClone(p),version:3};delete v3.pmon;assert.deepEqual(readPreset(v3),p);
  const noiseV3={...structuredClone(v3),source:'noise',noise:{clock:7}};const migratedNoise=readPreset(noiseV3);
  assert.equal(migratedNoise.source,'noise');assert.equal(migratedNoise.noise.clock,7);assert.equal(migratedNoise.pmon.enabled,false);
  assert.throws(()=>readPreset({...v3,pmon:createDefaultPmon()}),/unexpected/);
  const current=structuredClone(p);current.pmon.enabled=true;current.pmon.ratio=1.875;current.pmon.wave=waveShape('saw');current.pmon.envelope.gainLevel=81;
  const v4={...structuredClone(current),version:4};delete v4.pmon.source;delete v4.pmon.brr;
  assert.deepEqual(readPreset(v4),current);assert.throws(()=>readPreset({...v4,pmon:current.pmon}),/unexpected/);
  const modernWithOldShape={...structuredClone(v4),version:5};assert.throws(()=>readPreset(modernWithOldShape),/missing/);
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
  const legacy=makeBrr(64512);legacy.version=1;delete legacy.echo;delete legacy.noise;delete legacy.pmon;
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
  const old={...structuredClone(preset),version:2};delete old.noise;delete old.pmon;
  assert.throws(()=>readPreset(old),/v3 Noise/,'old formats cannot silently invent a new source mode');
});

test('PMON defaults and nested data are portable, detached and share exact hardware envelope mapping',()=>{
  const p=createDefaultPreset(),copy=readPreset(p);
  assert.deepEqual(p.pmon,createDefaultPmon());assert.equal(pmonActive(p),false);
  assert.deepEqual(modulatorEnvelopeRegisters(p),{adsr1:47,adsr2:224,gain:64});
  p.pmon.enabled=true;p.pmon.ratio=.125;p.pmon.envelope.mode='adsr';
  assert.equal(pmonActive(p),true);assert.equal(modulatorEnvelopeRegisters(p).adsr1,175);
  for(const [gainMode,gain]of[['direct',64],['linear-decrease',144],['exponential-decrease',176],['linear-increase',208],['bent-increase',240]]) {
    p.pmon.envelope.gainMode=gainMode;assert.equal(modulatorEnvelopeRegisters(p).gain,gain);
  }
  copy.pmon.wave[0]=1;copy.pmon.envelope.gainLevel=0;
  assert.equal(p.pmon.wave[0],0);assert.equal(p.pmon.envelope.gainLevel,64);
  p.pmon.ratio=8;assert.equal(readPreset(p).pmon.ratio,8);
});

test('PMON rejects missing, unknown, sparse and invalid nested data before acceptance',()=>{
  const p=createDefaultPreset();
  const changes=[x=>delete x.pmon,x=>x.pmon=null,x=>x.pmon.extra=true,x=>x.pmon.enabled=1,
    x=>x.pmon.ratio=.124,x=>x.pmon.ratio=8.001,x=>x.pmon.ratio=NaN,x=>x.pmon.ratio=Infinity,x=>x.pmon.ratio='1',
    x=>x.pmon.wave.pop(),x=>delete x.pmon.wave[1],x=>x.pmon.wave[0]=NaN,x=>x.pmon.wave[0]=1.1,
    x=>x.pmon.wave.extra=1,x=>x.pmon.wave=new Float32Array(128),x=>x.pmon.envelope.extra=0,
    x=>x.pmon.envelope.gainLevel=128,x=>x.pmon.envelope.gainRate=-1,x=>x.pmon.envelope.mode='other',
    x=>x.pmon.envelope.attack=16,x=>x.pmon.envelope.decay=8,x=>x.pmon.envelope.sustainLevel=8,
    x=>x.pmon.envelope.sustainRate=32,x=>x.pmon.envelope.gainMode='other'];
  for(const change of changes){const draft=structuredClone(p);change(draft);assert.throws(()=>readPreset(draft));}
  assert.deepEqual(p,createDefaultPreset());
});

test('PMON carrier budgets include its complete 72-byte modulator before any dry or Echo bank adoption',()=>{
  const make=bytes=>{const p=createDefaultPreset(),data=new Uint8Array(bytes);data[bytes-9]=1;
    p.source='brr';p.brr.data=encodeBase64(data);p.pmon.enabled=true;return p;};
  assert.equal(PMON_MODULATOR_BYTES,encodeBrr(Float32Array.from(waveShape('sine')),{loopStartSamples:0}).brr.length);
  for(const [echo,budget]of[[false,64440],[true,33714]]) {
    const p=make(budget);p.echo.enabled=echo;assert.equal(sampleBudget(p),budget);assert.deepEqual(readPreset(p),p);
    const extra=make(budget+9);extra.echo.enabled=echo;assert.throws(()=>readPreset(extra),/PMON reserves 72/);
    extra.pmon.enabled=false;assert.deepEqual(readPreset(extra),extra);
    extra.pmon.enabled=true;extra.source='wave';assert.deepEqual(readPreset(extra),extra,'inactive BRR does not consume carrier RAM');
  }
  const noise=make(64512);noise.source='noise';noise.echo.enabled=true;
  assert.equal(pmonActive(noise),false);assert.equal(sampleBudget(noise),33786);assert.deepEqual(readPreset(noise),noise);
});

test('bank keys distinguish active PMON layout and waves while preserving live or inactive edits',()=>{
  const p=createDefaultPreset(),before=presetBankKey(p);
  p.pmon.ratio=2;p.pmon.wave[0]=.5;p.pmon.envelope.gainLevel=30;
  assert.equal(presetBankKey(p),before,'disabled PMON drafts do not replace the bank');
  p.pmon.enabled=true;const active=presetBankKey(p);assert.notEqual(active,before);
  p.pmon.ratio=3;p.pmon.envelope.attack=5;p.envelope.decay=4;p.volume.left=30;p.brr.rootNote=40;
  assert.equal(presetBankKey(p),active,'ratio, envelopes, level and tuning are live');
  p.pmon.wave[0]=.25;assert.notEqual(presetBankKey(p),active);
  p.source='noise';const noise=presetBankKey(p);p.pmon.enabled=false;p.pmon.wave[0]=1;
  assert.equal(presetBankKey(p),noise);
  p.echo.enabled=true;assert.notEqual(presetBankKey(p),noise);
});

test('PMON JavaScript explicitly pairs silent modulator0 with carrier1 and preserves authored wave, ratio and Echo routing',async()=>{
  for(const source of ['wave','brr','noise']) {
    const p=createDefaultPreset();p.source=source;p.pmon.enabled=true;p.pmon.ratio=1.375;p.pmon.wave=waveShape('triangle');
    p.echo.enabled=true;
    if(source==='brr')p.brr={...p.brr,data:encodeBase64(Uint8Array.of(1,0,0,0,0,0,0,0,0)),rootNote:57,basePitch:2048};
    let nextSample=0;const calls=[],snes=Object.fromEntries(['allNotesOff','setEcho','loadBRR','writeDsp','readDsp','setPreset','noteOn','noteOff','keyOn'].map(method=>[method,(...args)=>{
      calls.push([method,...args]);return method==='loadBRR'?{id:nextSample++}:method==='readDsp'?0:undefined;
    }]));
    await vm.runInContext(`(async()=>{${presetToCode(p)}\n})()`,vm.createContext({useSoundChip:async()=>snes,pg:{encodeBrr},Float32Array,Uint8Array}));
    const active=source!=='noise';assert.deepEqual(calls.find(c=>c[0]==='writeDsp'&&c[1]===0x2d),['writeDsp',0x2d,active?2:0]);
    assert.equal(calls.find(c=>c[0]==='setEcho')[1].sendMask,active?2:255);
    assert.equal(calls.filter(c=>c[0]==='loadBRR').length,active?2:1);
    if(active) {
      const assignments=calls.filter(c=>c[0]==='setPreset'),mod=assignments[0],carrier=assignments[1];
      assert.equal(mod[1],0);assert.equal(mod[2].sample.id,1);assert.equal(mod[2].volumeLeft,0);assert.equal(mod[2].volumeRight,0);assert.equal(mod[2].gain,64);
      assert.equal(mod[2].pitch,Math.round(4096*440*2**((60-69)/12)*1.375/250));
      assert.equal(carrier[1],1);assert.equal(carrier[2].sample.id,0);assert.equal(carrier[2].volumeLeft,16);
      assert.deepEqual(calls.at(-2),['keyOn',0]);assert.deepEqual(calls.at(-1),['noteOn',1,'C4']);
      assert.deepEqual(Array.from(calls.filter(c=>c[0]==='loadBRR')[1][1]),Array.from(encodeBrr(Float32Array.from(p.pmon.wave),{loopStartSamples:0}).brr));
    }else assert.deepEqual(calls.at(-1),['noteOn',0,'C4']);
  }
});

function brrAsset(length,{rootNote=60,basePitch=4096}={}) {
  const bytes=new Uint8Array(length);bytes[length-9]=3;
  return {name:'Authored loop',data:encodeBase64(bytes),rootNote,basePitch,loopStartSamples:0};
}

test('v5 PMON BRR metadata validates independently, detaches and preserves empty inactive drafts',()=>{
  const p=createDefaultPreset();p.pmon.source='brr';p.pmon.brr=brrAsset(18,{rootNote:47,basePitch:1234});
  const copy=readPreset(p);assert.deepEqual(copy,p);copy.pmon.brr.rootNote=70;assert.equal(p.pmon.brr.rootNote,47);
  assert.equal(pmonSampleBytes(p),0);p.pmon.enabled=true;assert.equal(pmonSampleBytes(p),18);
  const changes=[x=>delete x.pmon.source,x=>delete x.pmon.brr,x=>x.pmon.source='noise',x=>x.pmon.brr.extra=1,
    x=>x.pmon.brr.rootNote=128,x=>x.pmon.brr.basePitch=0,x=>x.pmon.brr.basePitch=16384,x=>x.pmon.brr.name='bad\nname',
    x=>x.pmon.brr.loopStartSamples=1,x=>x.pmon.brr.loopStartSamples=32,x=>x.pmon.brr.loopStartSamples=null,
    x=>x.pmon.brr.data='not base64',x=>x.pmon.brr.data=encodeBase64(Uint8Array.of(1,0)),
    x=>x.pmon.brr.data=Buffer.alloc(64521).toString('base64'),x=>x.pmon.brr=null];
  for(const mutate of changes)for(const inactive of [false,true]) {
    const draft=structuredClone(p);mutate(draft);if(inactive){draft.source='noise';draft.pmon.enabled=false;}
    assert.throws(()=>readPreset(draft));
  }
  const empty=createDefaultPreset();empty.pmon.enabled=true;empty.pmon.source='brr';
  assert.deepEqual(readPreset(empty),empty);assert.equal(pmonSampleBytes(empty),0);assert.throws(()=>presetToCode(empty),/modulator BRR/);
  empty.source='noise';assert.doesNotThrow(()=>presetToCode(empty),'inactive modulator drafts do not prevent Noise export');
  empty.echo.enabled=true;empty.brr=brrAsset(64512);empty.pmon.brr=brrAsset(64512);
  assert.deepEqual(readPreset(empty),empty,'separately valid inactive assets do not consume Noise or Echo sample RAM');
});

test('active carrier and modulator BRR budgets sum complete assets without deduplicating shared bytes',()=>{
  for(const [echo,total]of[[false,64512],[true,33786]]) {
    const p=createDefaultPreset();p.echo.enabled=echo;p.pmon.enabled=true;p.pmon.source='brr';
    p.pmon.brr=brrAsset(total-72);assert.equal(pmonSampleBytes(p),total-72);assert.equal(sampleBudget(p),72);assert.deepEqual(readPreset(p),p);
    p.pmon.brr=brrAsset(total-63);assert.equal(sampleBudget(p),63);assert.throws(()=>readPreset(p),/PMON reserves/,'the wave carrier still consumes 72 bytes');
    p.source='brr';p.brr=brrAsset(9);p.pmon.brr=brrAsset(total-9);assert.deepEqual(readPreset(p),p);
    p.pmon.brr=brrAsset(total);assert.throws(()=>readPreset(p),/PMON reserves/);
    p.pmon.enabled=false;assert.deepEqual(readPreset(p),p,'disabled PMON has no active RAM cost');
    p.pmon.enabled=true;p.source='noise';assert.equal(pmonSampleBytes(p),0);assert.deepEqual(readPreset(p),p);
  }
  const p=createDefaultPreset();p.echo.enabled=true;p.pmon.enabled=true;p.pmon.source='brr';p.source='brr';
  p.brr=brrAsset(16893);p.pmon.brr=structuredClone(p.brr);assert.deepEqual(readPreset(p),p);
  p.brr=brrAsset(16902);p.pmon.brr=structuredClone(p.brr);assert.throws(()=>readPreset(p),/PMON reserves/,'equal samples still occupy two uploads');
});

test('BRR modulator bank keys distinguish source, data and loop while retaining live tuning and inactive waves',()=>{
  const p=createDefaultPreset();p.pmon.enabled=true;const wave=presetBankKey(p);
  p.pmon.source='brr';p.pmon.brr=brrAsset(18);const brr=presetBankKey(p);assert.notEqual(brr,wave);
  p.pmon.brr.rootNote=37;p.pmon.brr.basePitch=8192;p.pmon.brr.name='Renamed';p.pmon.ratio=2;p.pmon.wave[0]=.8;
  assert.equal(presetBankKey(p),brr);
  p.pmon.brr.loopStartSamples=16;assert.notEqual(presetBankKey(p),brr);p.pmon.brr.loopStartSamples=0;
  p.pmon.brr=brrAsset(27);assert.notEqual(presetBankKey(p),brr);
  p.source='noise';const noise=presetBankKey(p);p.pmon.source='wave';assert.equal(presetBankKey(p),noise);
});

test('BRR modulator export uploads declared bytes and tuning with captured C4 PITCH and no wave encoding',async()=>{
  const p=createDefaultPreset();p.source='brr';p.brr=brrAsset(18,{basePitch:3072});p.pmon.enabled=true;p.pmon.source='brr';
  p.pmon.brr=brrAsset(27,{basePitch:1234});p.pmon.envelope.gainLevel=77;p.echo.enabled=true;
  const calls=[];let next=0;const snes=Object.fromEntries(['allNotesOff','setEcho','loadBRR','writeDsp','setPreset','keyOn','noteOn'].map(method=>[method,(...args)=>{calls.push([method,...args]);if(method==='loadBRR')return{id:next++};}]));
  await vm.runInContext(`(async()=>{${presetToCode(p)}\n})()`,vm.createContext({useSoundChip:async()=>snes,pg:{encodeBrr(){throw Error('BRR must not be encoded');}},Float32Array,Uint8Array}));
  const loads=calls.filter(call=>call[0]==='loadBRR'),mod=calls.find(call=>call[0]==='setPreset');
  assert.deepEqual(Array.from(loads[1][1]),Array.from(new Uint8Array(27).fill(0).map((value,index)=>index===18?3:value)));
  assert.deepEqual(JSON.parse(JSON.stringify(loads[1][2])),{rootNote:60,basePitch:1234,loopStartSamples:0});
  assert.equal(mod[2].pitch,1234);assert.equal(mod[2].gain,77);assert.equal(calls.find(call=>call[0]==='setEcho')[1].sendMask,2);
  p.pmon.brr.rootNote=48;p.pmon.ratio=2;assert.match(presetToCode(p),/volumeRight:0, pitch:4936/);
});
