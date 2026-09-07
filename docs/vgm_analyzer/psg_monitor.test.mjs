import test from 'node:test';
import assert from 'node:assert/strict';
import {createPsgMonitor, applySsgWrite, applyPsgWrite, describePsgMonitor, observePsgEngine} from './psg_monitor.js';

test('SSG channels, masks, mixer and envelope match register semantics', () => {
  for (const chip of ['ym2203','ym2608']) {
    const s = createPsgMonitor(chip);
    for (let ch=0;ch<3;ch++) {
      applySsgWrite(s,0,ch*2,0x23+ch,1);
      applySsgWrite(s,0,ch*2+1,0xf1,2);
      applySsgWrite(s,0,8+ch,ch === 2 ? 16 : 15,3);
    }
    applySsgWrite(s,0,7,0x11,4);
    applySsgWrite(s,0,6,255,5);
    applySsgWrite(s,0,11,0x34,6); applySsgWrite(s,0,12,0x12,6);
    applySsgWrite(s,0,13,0x0e,7); applySsgWrite(s,0,13,0x0e,8);
    assert.equal(s.changedAt[13],8);
    const view=describePsgMonitor(s);
    assert.deepEqual(view.channels.map(c=>c.period),[0x123,0x124,0x125]);
    assert.equal(view.channels[0].toneEnabled,false);
    assert.equal(view.channels[1].noiseEnabled,false);
    assert.equal(view.channels[2].envelope,true);
    assert.equal(view.noisePeriod,31);
    assert.deepEqual(view.envelope,{period:0x1234,shape:14,continue:true,attack:true,alternate:true,hold:false});
    const saved=JSON.stringify(s);
    assert.equal(applySsgWrite(s,1,8,0,9),false);
    assert.equal(applySsgWrite(s,0,0x30,0,9),false);
    assert.equal(JSON.stringify(s),saved);
  }
});

test('PSG latch/data, attenuation, noise and snapshots remain independent', () => {
  const s=createPsgMonitor('ym2612');
  assert.deepEqual(s.registers,[0,15,0,15,0,15,0,15]);
  [0x85,0x12,0x91,0x07,0xc3,0x20,0xe7,0xf2].forEach((v,i)=>applyPsgWrite(s,v,i+1));
  const view=describePsgMonitor(s,true);
  assert.equal(view.channels[0].period,0x125);
  assert.equal(view.channels[0].attenuation,7);
  assert.equal(view.channels[2].period,0x203);
  assert.deepEqual(view.noise,{mode:'White',rate:3,tone3Linked:true,attenuation:2});
  assert.equal(view.muted,true);
  applyPsgWrite(s,15,20);
  assert.equal(s.registers[7],15);
  assert.equal(view.registers[7],2);
  applyPsgWrite(s,0xe0,21); applyPsgWrite(s,6,22);
  assert.equal(s.registers[6],6);
});

test('engine observers forward once across attachment/restart and reset latch state', () => {
  for (const chip of ['ym2203','ym2608','ym2612']) {
    let state=createPsgMonitor(chip), changes=0, writes=0, resets=0;
    const engine={writeYm2203(){writes++;},writeYm2608(){writes++;},writePsg(){writes++;},reset(){resets++;}};
    const attach=()=>observePsgEngine(engine,()=>state,()=>changes++,()=>{state=createPsgMonitor(chip);},()=>42);
    attach();attach();
    if(chip==='ym2203') engine.writeYm2203(8,15);
    else if(chip==='ym2608') engine.writeYm2608(0,8,15);
    else engine.writePsg(0x92);
    assert.equal(writes,1);assert.equal(changes,1);
    engine.reset();assert.equal(resets,1);
    assert.deepEqual(state,createPsgMonitor(chip));
    attach(); engine.writePsg(0x83); assert.equal(writes,2);
  }
});

import { VgmPlayer } from '../js/vgmplayer.js';
test('VGM playback observes chip writes, pause, loop continuation and reset', () => {
  for (const chip of ['ym2203','ym2608','ym2612']) {
    let state=createPsgMonitor(chip), writes=0;
    const engine={reset(){},sampleRate(){return 44100;},writePsg(){writes++;},
      processFrames(n){return {left:new Float32Array(n),right:new Float32Array(n)};}};
    if(chip==='ym2203') engine.writeYm2203=()=>writes++;
    if(chip==='ym2608') engine.writeYm2608=()=>writes++;
    observePsgEngine(engine,()=>state,()=>{},()=>{state=createPsgMonitor(chip);},()=>100);
    const init=chip==='ym2612'?[0x50,0x85,0x50,0x12]:[chip==='ym2203'?0x55:0x56,0,0x25];
    // Loop begins with a continuation byte (PSG) / volume write (SSG).
    const loop=chip==='ym2612'?[0x50,0x22]:[chip==='ym2203'?0x55:0x56,8,15];
    const commands=[...init,...loop,0x61,16,0,0x66];
    const bytes=new Uint8Array(256+commands.length);bytes.set([86,103,109,32]);
    const view=new DataView(bytes.buffer);view.setUint32(8,0x171,true);view.setUint32(0x34,0xcc,true);
    view.setUint32(0x1c,256+init.length-0x1c,true);bytes.set(commands,256);
    const player=new VgmPlayer(engine);player.load(bytes);player.reset();player.setLoopEnabled(true);player.play();
    const left=new Float32Array(32),right=new Float32Array(32);
    player.process(left,right,32);
    assert.equal(state.registers[0],chip==='ym2612'?0x225:0x25);
    assert.ok(writes>2);
    const snapshot=JSON.stringify(state);player.pause();player.process(left,right,32);assert.equal(JSON.stringify(state),snapshot);
    player.stop();assert.deepEqual(state,createPsgMonitor(chip));
    player.play();player.process(left,right,32);assert.equal(state.registers[0],chip==='ym2612'?0x225:0x25);
  }
});
