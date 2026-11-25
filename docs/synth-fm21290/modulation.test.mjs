import test from 'node:test';
import assert from 'node:assert/strict';
import {createInstrument} from './instrument.js';
import {presetToVoice,voiceToPreset} from '../js/msfa_dx7/src/preset.js';
import {AM,PM,Fm21290} from './chip.js';
import {ModulatedChip} from './modulation.js';

const patch={speed:0,delay:0,sync:true,waveform:0,ampModDepth:99,pitchModDepth:99,pitchModSensitivity:7};
function fixture(sampleRate, settings={}) {
  let frame=0;
  const writes=[];
  const lfo=new ModulatedChip({sampleRate,renderInto(buffer){frame+=buffer.length;},
    writeRegister(address,data){writes.push([frame,address,data]);}});
  lfo.configure({...patch,...settings});
  lfo.keyOn();
  return {lfo,writes};
}
test('first post-sync tick follows all six ROM wave branches and the modulation write order',()=>{
  for(const [waveform,expected] of [127,127,128,128,253,17].entries()){
    const {lfo,writes}=fixture(48000,{waveform});
    lfo.tick();
    assert.equal(lfo.wave,expected);
    assert.deepEqual(writes.map(([,address])=>address),[AM,PM,PM+1]);
    const signed=(expected^128)-128;
    const word=(Math.trunc(signed*255/256)*254 >> 1)&65535;
    assert.deepEqual(writes.slice(1).map(([, ,data])=>data),[word>>8,word&255]);
    if(waveform===0)assert.equal(writes[0][2],0);
  }
});
test('identical register stream at 44.1/48 kHz across irregular render boundaries',()=>{
  function run(rate,block){
    const {lfo,writes}=fixture(rate,{waveform:5,speed:99});
    const buffer=new Float32Array(block);
    for(let n=0;n<rate;n+=block)lfo.renderInto(buffer.subarray(0,Math.min(block,rate-n)));
    const count=Math.floor(2356625/6280);
    assert.equal(writes.length,count*3);
    for(let i=0;i<count;i++)
      assert.equal(writes[i*3][0],Math.ceil((i+1)*rate*6280/2356625));
    assert.equal(lfo.phase,(0x7fff+count*8670)&65535);
    return writes.map(([,address,data])=>[address,data]);
  }
  assert.deepEqual(run(44100,37),run(48000,128));
});
test('delay gates modulation, sync and bend survive patch and depth changes',()=>{
  const {lfo,writes}=fixture(48000,{waveform:3,delay:99});
  lfo.setBend(-256);
  lfo.tick();
  assert.deepEqual(writes.slice(-3).map(x=>x[2]),[0,255,0]);
  for(let i=1;i<1023;i++)lfo.tick();
  assert.equal(lfo.fade,0);
  lfo.tick();assert.equal(lfo.fade,1);
  for(let i=0;i<254;i++)lfo.tick();
  assert.equal(lfo.fade,255);
  lfo.configure({...patch,sync:false,delay:99});
  const phase=lfo.phase;lfo.keyOn();assert.equal(lfo.phase,phase);assert.equal(lfo.fade,0);
  lfo.configure({...patch,ampModDepth:0,pitchModDepth:0});
  assert.deepEqual(writes.slice(-3).map(x=>x[2]),[0,255,0]);
  const before=writes.length;lfo.tick();assert.equal(writes.length,before);
});

test('patch LFO reaches rendered PCM through the shared EGS modulation registers',()=>{
  function play(amp,pitch) {
    const core=new Fm21290(48000),cpu=new ModulatedChip(core);
    const preset=voiceToPreset(presetToVoice({operators:{1:{ampModSensitivity:3}},
      lfo:{...patch,waveform:3,ampModDepth:amp,pitchModDepth:pitch,pitchModSensitivity:4}}));
    cpu.configure(preset.lfo);
    const keys=createInstrument((addr,data)=>core.writeRegister(addr,data),()=>cpu.keyOn());
    keys.setPatch(preset);keys.keyOn(0,69,127);
    const pcm=new Float32Array(24000);cpu.renderInto(pcm);
    let peak=0, crossings=0;
    for(let i=12000;i<pcm.length;i++){
      peak=Math.max(peak,Math.abs(pcm[i]));
      if(pcm[i-1]<=0 && pcm[i]>0)crossings++;
    }
    return {peak,hz:crossings*4};
  }
  const dry=play(0,0), am=play(99,0), pm=play(0,99);
  assert.ok(Math.abs(dry.hz-440)<=4 && dry.peak>0);
  assert.ok(am.peak<dry.peak/2 && am.hz===dry.hz);
  assert.ok(pm.hz<dry.hz-20);
});
