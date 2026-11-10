// Physical WASM rendering stays in arrays; no audio device is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/rf5c164_wasm.js';
import {Rf5c164} from '../js/rf5c164.js';
import {RF5C164Synth} from '../js/rf5c164synth.js';
import {createSynthPcmRelease} from './synth_pcm_release.js';
import {createSynthPcmMuteTransport} from './synth_pcm_mute.js';

const wasmBinary=await readFile(new URL('../generated/rf5c164_wasm.wasm',import.meta.url));
async function native() {
  const chip=await Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:48000}),writes=[];
  const mute=createSynthPcmMuteTransport({write:(r,v)=>{writes.push([r,v]);chip.writeRegister(r,v);},
    loadMemory:(...args)=>chip.loadMemory(...args),reset:()=>chip.reset()});
  const raw=new RF5C164Synth({transport:mute});
  const release=createSynthPcmRelease({pcm:raw,sampleRate:48000,renderAudio:(left,right)=>{
    const pcm=chip.generateStereo(left.length);left.set(pcm.left);right.set(pcm.right);
  }});
  const pcm=release.pcm;pcm.reset();
  const bank=new Uint8Array(65536).fill(255);
  for(let i=0;i<193;i++)bank[i]=i%2?128+1+i%126:1+i%126;
  pcm.loadMemory(bank);
  for(const ch of [0,1])pcm.setChannel(ch,{start:0,loopStart:0,step:1700+ch*313,volume:96,pan:{left:ch?0:15,right:ch?15:0}});
  pcm.keyOn(0);pcm.keyOn(1);
  return {chip,pcm,mute,release,writes,generate(frames){const left=new Float32Array(frames),right=new Float32Array(frames);release.render(left,right);return{left,right};},dispose(){mute.dispose();chip.dispose();}};
}

test('PCM output mute preserves physical sample position, other voices, latest pan and release-volume shadows',async()=>{
  const a=await native(),b=await native();
  try {
    assert.deepEqual(a.generate(303),b.generate(303));const state=a.release.getState();
    a.mute.setChannelMuted(0,true);assert.deepEqual(a.release.getState(),state,'mute cannot change logical or release-volume state');
    const writes=a.writes.length;a.pcm.setChannel(0,{pan:{left:7,right:0},volume:77});b.pcm.setChannel(0,{pan:{left:7,right:0},volume:77});
    assert(a.writes.slice(writes).some(([register,value])=>register===1&&value===0));
    const muted=a.generate(1703),reference=b.generate(1703);assert(muted.left.every(value=>value===0));assert.deepEqual(muted.right,reference.right);
    const before=a.release.getState();a.mute.setChannelMuted(0,false);assert.deepEqual(a.release.getState(),before);
    assert.deepEqual(a.generate(2000),b.generate(2000),'unmute restores authored pan at the continuing native sample position');
    assert.equal(a.mute.getState().pans[0],7);assert.equal(a.release.getState().baseVolumes[0],77);
    for(const target of [a,b])target.pcm.releaseNote(0);
    a.mute.setChannelMuted(0,true);a.generate(70);b.generate(70);a.mute.setChannelMuted(0,false);
    assert.deepEqual(a.generate(300),b.generate(300),'release keeps fading while muted, without restoring the authored full volume');
    assert.deepEqual(a.release.getState().heldChannels,[1]);
  } finally {a.dispose();b.dispose();}
});

test('PCM muting restores register selection, global enable and RAM window and never writes key/volume registers',()=>{
  const writes=[],mute=createSynthPcmMuteTransport({write:(r,v)=>writes.push([r,v]),loadMemory:()=>{},reset:()=>writes.push(['reset'])});
  mute.write(7,0xc3);mute.write(1,0xa5);mute.write(7,0xc6);mute.write(1,0xf2);mute.write(7,0x8b);
  const before=writes.length;mute.setChannelMuted(3,true);
  assert.deepEqual(writes.slice(before),[[7,0xc3],[1,0],[7,0xc6],[7,0x8b]]);
  assert.equal(mute.getState().selected,6);assert.equal(mute.getState().control,0x8b);
  mute.write(1,0xe4);assert.deepEqual(writes.at(-1),[1,0xe4],'the author still targets the original selected channel');
  mute.setChannelMuted(3,false);assert.deepEqual(writes.slice(-4),[[7,0xc3],[1,0xa5],[7,0xc6],[7,0x8b]]);
  mute.write(7,0x0d);mute.setChannelMuted(1,true);assert.deepEqual(writes.slice(-4),[[7,0x41],[1,0],[7,0x46],[7,0x0d]],'mute cannot turn a globally-disabled chip on');
  const count=writes.length;
  for(const ch of [-1,8,1.5,'0'])assert.throws(()=>mute.setChannelMuted(ch,true));
  for(const value of [0,1,'false',null])assert.throws(()=>mute.setChannelMuted(0,value));assert.equal(writes.length,count);
  mute.reset();assert.equal(mute.getState().muted[1],true);mute.write(7,0xc1);mute.write(1,0xff);assert.deepEqual(writes.at(-1),[1,0]);
  mute.setChannelMuted(1,false);assert.deepEqual(writes.slice(-3),[[7,0xc1],[1,0xff],[7,0xc1]]);
  mute.dispose();assert(mute.getState().muted.every(value=>value===false));
});
