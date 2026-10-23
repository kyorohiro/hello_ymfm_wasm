import assert from 'node:assert/strict';
import test from 'node:test';
import {FM_CALIBRATION_KINDS,buildFmCalibrationReference,buildYm2610bPrimaryCalibrationReference,createFmCalibrationPrograms} from './soundchip_calibration_fm.mjs';
import {YM2612Synth} from '../web/ym2612synth.js';
import {YM2203Synth} from '../web/ym2203synth.js';
import {YM2608Synth} from '../web/ym2608synth.js';
import {YM2610BSynth,NeoGeoFMSynth} from '../web/ym2610bsynth.js';
import {YM2151Synth} from '../web/ym2151synth.js';
import {YM2413Synth} from '../web/ym2413synth.js';
import {OPLSynth} from '../web/opl_synth.js';
import {presetToVoice,voiceToPreset} from '../web/msfa_dx7/src/preset.js';

const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const opnKinds=['ym2612','ym2203','ym2608','ym2610','ym2610b'];
const oplKinds=['ym3526','ym3812','y8950','ymf262'];

// Execute the shipped source against the actual public authoring synths. The
// asynchronous facade prevents the fixture from accidentally relying on sync
// return values that are unavailable through Playground's MessagePort clients.
function fixture(kind){
  const registers=new Uint8Array(512),gates=new Map(),calls=[];
  const write=(port,register,value)=>{
    registers[port*256+register]=value;calls.push([port,register,value]);
    if(opnKinds.includes(kind)&&port===0&&register===0x28)gates.set(value&7,value&0xf0);
    if(kind==='ym2151'&&register===8)gates.set(value&7,value&0x78);
  };
  const transport={
    write,
    writeRegister:(register,value,port=0)=>write(port,register,value),
    reset(){registers.fill(0);gates.clear();calls.length=0;},
  };
  let synth;
  if(kind==='ym2612')synth=new YM2612Synth({transport});
  else if(kind==='ym2203')synth=new YM2203Synth({transport});
  else if(kind==='ym2608')synth=new YM2608Synth({transport});
  else if(kind==='ym2610')synth=new NeoGeoFMSynth(new YM2610BSynth({transport}));
  else if(kind==='ym2610b')synth=new YM2610BSynth({transport});
  else if(kind==='ym2151')synth=new YM2151Synth({transport});
  else if(kind==='ym2413')synth=new YM2413Synth({transport});
  else if(oplKinds.includes(kind))synth=new OPLSynth({transport,chip:kind});
  else{
    synth={
      panic(){gates.clear();},
      setPreset(preset){synth.preset=voiceToPreset(presetToVoice(preset));},
      noteOn(midi,velocity){assert.ok(Number.isInteger(midi)&&midi>=0&&midi<=127);assert.equal(velocity,127);gates.set(midi,true);},
      noteOff(midi){gates.delete(midi);},
    };
  }
  const source=new Proxy(synth,{get(target,property){
    const value=Reflect.get(target,property,target);
    return typeof value==='function'?async(...args)=>{await Promise.resolve();return value.apply(target,args);}:value;
  }});
  const context={};let creations=0;
  return {registers,gates,calls,synth,source,context,
    async run(program){await new AsyncFunction('createSoundChip','context','fm',program)(async(name,options)=>{
      assert.equal(name,kind);assert.deepEqual(options,{id:'calibration-source'});creations++;return source;
    },context,source);},
    get creations(){return creations;},
  };
}

function assertPitch(actual,expected){
  assert.ok(Math.abs(actual-expected)/expected<0.002,`frequency ${actual} differs from ${expected}`);
}

for(const frequency of [220,440,880])for(const kind of FM_CALIBRATION_KINDS){
  test(`${kind} ${frequency} Hz reference uses a single unattenuated carrier and releases it`,async()=>{
    const reference=buildFmCalibrationReference(kind,frequency),f=fixture(kind);
    await f.run(reference.setup);
    assert.equal(f.creations,1);assert.equal(f.context.calibrationSource,f.source);
    const r=f.registers;
    if(opnKinds.includes(kind)){
      const ch=kind==='ym2610'?1:0;
      assert.deepEqual([...f.gates].filter(([,mask])=>mask),[[ch,0x80]]);
      assert.equal(r[0xb0+ch],7);assert.equal(r[0x27],0);
      if(kind!=='ym2203')assert.equal(r[0xb4+ch],0xc0);
      for(const slot of [0,4,8,12]){
        assert.equal(r[0x30+ch+slot],1);assert.equal(r[0x40+ch+slot],slot===12?0:127);
        assert.equal(r[0x50+ch+slot],31);assert.equal(r[0x60+ch+slot],0);
        assert.equal(r[0x70+ch+slot],0);assert.equal(r[0x80+ch+slot],15);assert.equal(r[0x90+ch+slot],0);
      }
      if(kind!=='ym2612'){
        assert.equal(r[7],0x3f);assert.deepEqual([...r.slice(8,11)],[0,0,0]);
      }
      const fnum=r[0xa0+ch]|((r[0xa4+ch]&7)<<8),block=(r[0xa4+ch]>>3)&7;
      const clock=kind==='ym2610'?f.synth.fm.clock:f.synth.clock,divider=kind==='ym2203'?72:144;
      assertPitch(clock*fnum*2**(block-1)/(divider*2**20),frequency);
      // Neo Geo's public channel 0 must address physical channel 1, including
      // pitch; a public/raw channel-number mixup can silently make this mute.
      if(kind==='ym2610')assert.equal(r[0xa0],0);
    }else if(kind==='ym2151'){
      assert.deepEqual([...f.gates].filter(([,mask])=>mask),[[0,0x40]]);
      assert.equal(r[0x20],0xc7);assert.equal(r[0x38],0);assert.equal(r[0x0f],0);
      for(const slot of [0,8,16,24]){
        assert.equal(r[0x40+slot],1);assert.equal(r[0x60+slot],slot===24?0:127);
        assert.equal(r[0x80+slot],31);assert.equal(r[0xa0+slot],0);assert.equal(r[0xc0+slot],0);assert.equal(r[0xe0+slot],15);
      }
      const notes=[0,1,2,4,5,6,8,9,10,12,13,14];
      const semitone=((r[0x28]>>4)*12)+notes.indexOf(r[0x28]&15);
      const midi=13+semitone+(r[0x30]>>2)/64;
      assertPitch(440*2**((midi-69)/12)*f.synth.clock/3579545,frequency);
    }else if(kind==='ym2413'){
      assert.equal(r[0x0e],0);assert.equal(r[0x30],0);
      assert.deepEqual([...r.slice(0,8)],[0x21,0x21,0x3f,0,0,0xf0,15,15]);
      assert.ok(r[0x20]&16);
      for(let ch=1;ch<9;ch++)assert.equal(r[0x20+ch]&16,0);
      const fnum=r[0x10]|((r[0x20]&1)<<8),block=(r[0x20]>>1)&7;
      assertPitch(f.synth.clock/72*fnum*2**(block-19),frequency);
    }else if(oplKinds.includes(kind)){
      assert.equal(r[0xbd],0);assert.equal(r[0xc0],kind==='ymf262'?0x30:0);
      assert.equal(r[0x20],0x21);assert.equal(r[0x23],0x21);
      assert.equal(r[0x40],63);assert.equal(r[0x43],0);assert.equal(r[0x60],0);assert.equal(r[0x63],0xf0);
      assert.equal(r[0x80],15);assert.equal(r[0x83],15);assert.equal(r[0xe3],0);
      assert.ok(r[0xb0]&32);
      for(let ch=1;ch<f.synth.channels;ch++)assert.equal(r[Math.floor(ch/9)*256+0xb0+ch%9]&32,0);
      if(kind==='ymf262'){assert.equal(r[0x105],1);assert.equal(r[0x104],0);}
      const fnum=r[0xa0]|((r[0xb0]&3)<<8),block=(r[0xb0]>>2)&7,divider=kind==='ymf262'?288:72;
      assertPitch(f.synth.clock/divider/2**20*fnum*2**block,frequency);
    }else{
      const p=f.synth.preset;
      assert.equal(p.algorithm,31);assert.equal(p.feedback,0);assert.equal(p.transpose,24);
      assert.deepEqual(p.pitchEnvelope.levels,[50,50,50,50]);assert.equal(p.lfo.pitchModDepth,0);assert.equal(p.lfo.ampModDepth,0);
      assert.deepEqual([...f.gates.keys()],[Math.round(69+12*Math.log2(frequency/440))]);
      for(let op=1;op<=6;op++){
        const voice=p.operators[op];assert.equal(voice.outputLevel,op===1?99:0);
        assert.equal(voice.mode,'ratio');assert.equal(voice.coarse,1);assert.equal(voice.fine,0);assert.equal(voice.detune,7);
        assert.equal(voice.rateScaling,0);assert.equal(voice.velocitySensitivity,0);assert.equal(voice.ampModSensitivity,0);
        assert.equal(voice.keyboardScaling.leftDepth,0);assert.equal(voice.keyboardScaling.rightDepth,0);
        assert.deepEqual(voice.envelope,{rates:[99,99,99,99],levels:[99,99,99,0]});
      }
      assert.equal(reference.effectiveFrequencyHz,frequency);
    }
    await f.run(reference.stop);
    assert.equal(f.creations,1,'stop must release the same instrument');
    if(opnKinds.includes(kind)||kind==='ym2151'||kind==='dx7')assert.equal([...f.gates.values()].filter(Boolean).length,0);
    else if(kind==='ym2413')assert.equal(r[0x20]&16,0);
    else assert.equal(r[0xb0]&32,0);
  });
}

for(const frequency of [220,440,880])test(`YM2610B primary ${frequency} Hz borrows fm without the Neo Geo channel map`,async()=>{
  const reference=buildYm2610bPrimaryCalibrationReference(frequency),f=fixture('ym2610b');
  await f.run(reference.setup);
  assert.equal(reference.kind,'ym2610b');assert.equal(reference.waveform,'sine');assert.equal(reference.frequencyHz,frequency);
  assert.equal(f.creations,0,'the mode primary is already created and is available as fm');
  assert.equal(f.context.calibrationSource,f.source);
  assert.deepEqual([...f.gates].filter(([,mask])=>mask),[[0,0x80]]);
  const r=f.registers;
  assert.equal(r[0xb0],7);assert.equal(r[0xb4],0xc0);assert.equal(r[0x4c],0);assert.equal(r[0x5c],31);
  assert.equal(r[0x6c],0);assert.equal(r[0x7c],0);assert.equal(r[0x8c],15);assert.equal(r[0x9c],0);
  assert.equal(r[0xa1],0,'physical channel 1 is not the B primary reference');
  const fnum=r[0xa0]|((r[0xa4]&7)<<8),block=(r[0xa4]>>3)&7;
  assertPitch(f.synth.clock*fnum*2**(block-1)/(144*2**20),frequency);
  await f.run(reference.stop);assert.equal([...f.gates.values()].filter(Boolean).length,0);
});

test('reference inventory and frequency validation are deterministic',()=>{
  assert.equal(new Set(FM_CALIBRATION_KINDS).size,11);
  assert.deepEqual(createFmCalibrationPrograms().map(({kind})=>kind),FM_CALIBRATION_KINDS);
  assert.throws(()=>buildFmCalibrationReference('unknown'),/Unsupported/);
  assert.throws(()=>buildFmCalibrationReference('ym2610b'),/Unsupported/);
  for(const frequency of [0,-1,Infinity,NaN,'440'])assert.throws(()=>buildFmCalibrationReference('ym2612',frequency),/positive finite/);
  for(const frequency of [0,-1,Infinity,NaN,'440'])assert.throws(()=>buildYm2610bPrimaryCalibrationReference(frequency),/positive finite/);
  const reference=buildFmCalibrationReference('dx7',450);
  assert.equal(reference.frequencyHz,450);assert.equal(reference.effectiveFrequencyHz,440);assert.match(reference.limitations,/nearest semitone/);
});
