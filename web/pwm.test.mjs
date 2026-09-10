import test from 'node:test';
import assert from 'node:assert/strict';
import {SimplePwm, GenesisAudioEngine} from './genesisaudioengine.js';
import {VgmPlayer} from './vgmplayer.js';
import {Ym2612VGM, decodePwmBlock} from './ym2612vgm.js';

function file(commands) {
  const bytes = new Uint8Array(256 + commands.length), view = new DataView(bytes.buffer);
  bytes.set([86,103,109,32]); view.setUint32(8,0x171,true);
  view.setUint32(0x34,0xcc,true); view.setUint32(0x70,23011361,true);
  bytes.set(commands,256); return bytes;
}
const write = (r,v) => [0xb2,(r<<4)|(v>>8),v&255];
const setup = [...write(0,5),...write(1,100)];
test('dense direct writes fill the requested audio without budget-induced silence',()=>{
  const commands=[...setup,...write(4,75)];
  for(let i=0;i<5000;i++)commands.push(...write(4,75),0x73);
  commands.push(0x66);
  const {l,p}=render(commands,4096,53267);
  assert.equal(l.length,4096);assert.ok(l.every(v=>v===.5));
  assert.ok(p.processedEvents>512);
});
test('dense writes do not interrupt other audio when PWM is muted',()=>{
  const commands=[];for(let i=0;i<5000;i++)commands.push(...write(4,75),0x73);commands.push(0x66);
  const e=engine(53267);e.setPwmMuted(true);
  e.ym2612.generateStereo=n=>({left:new Float32Array(n).fill(.25),right:new Float32Array(n).fill(.25)});
  const p=new VgmPlayer(e);p.load(file(commands));p.play();
  const l=new Float32Array(4096);p.process(l,new Float32Array(4096),4096);
  assert.ok([...l].every(v=>Math.abs(v-.225)<1e-6));
});
function engine(rate=44100) {
  const chip = () => ({reset(){},generateStereo(n){return {left:new Float32Array(n),right:new Float32Array(n)};}});
  return new GenesisAudioEngine(chip(),chip(),rate);
}
function render(commands, n, rate=44100) {
  const e=engine(rate), p=new VgmPlayer(e); p.load(file(commands)); p.setPrefetchFactor(1);p.play();
  const l=new Float32Array(n),r=new Float32Array(n);p.process(l,r,n);return {e,p,l:[...l],r:[...r]};
}
test('direct PWM holds stereo values over waits, Mono replaces both; header and raw scan',()=>{
  const commands=[...setup,...write(2,75),...write(3,25),0x71,...write(4,50),0x71,0x66];
  const parser=new Ym2612VGM(file(commands));assert.equal(parser.header.pwmClock,23011361);
  assert.equal(parser.analyzeCommandUsage().get('0xb2'),5);
  const {l,r,p}=render(commands,4);assert.deepEqual(l,[.5,.5,0,0]);assert.deepEqual(r,[-.5,-.5,0,0]);
  p.reset();assert.deepEqual(p.engine.pwm.output(),[0,0]);
});
test('silence, routing, cycle changes, clipping and mute',()=>{
  const p=new SimplePwm();assert.deepEqual(p.output(),[0,0]);
  p.writeRegister(0,10);p.writeRegister(1,100);p.writeRegister(2,75);p.writeRegister(3,25);
  assert.deepEqual(p.output(),[-.5,.5]);p.writeRegister(1,200);assert.deepEqual(p.output(),[-.75,-.25]);
  p.writeRegister(2,4095);assert.equal(p.output()[1],1);
  p.writeRegister(2,0);assert.equal(p.output()[1],0);
  p.muted=true;assert.deepEqual(p.output(),[0,0]);p.muted=false;p.writeRegister(0,0);assert.deepEqual(p.output(),[0,-.75]);
});
test('n-bit PWM decompression, legacy control and malformed blocks',()=>{
  const data=[0,4,0,0,0,12,8,0,0xa0,1,97,98];
  assert.deepEqual([...decodePwmBlock(new Uint8Array(data))],[1,2,2,2]);
  assert.throws(()=>decodePwmBlock(new Uint8Array(data.slice(0,-1))),/Invalid/);
  const {l}=render([...write(1,1024),...write(0,0x300),0x67,0x66,0x43,data.length,0,0,0,...data,
    ...stream(0,4),0x95,0,0,0,0,0x71,0x66],2);
  assert.deepEqual(l,[1/512,2/512]);
});
test('engine master volume and PWM mute apply to mix',()=>{
  const {e}=render([...setup,...write(4,75),0x70,0x66],1);
  e.setMasterVolume(.5);assert.equal(e.processFrames(1).left[0],.25);
  e.setPwmMuted(true);assert.equal(e.processFrames(1).left[0],0);
});
const block=data=>[0x67,0x66,3,data.length,0,0,0,...data];
const stream=(id,reg,base=0,step=1)=>[0x90,id,0x11,0,reg,0x91,id,3,step,base,0x92,id,0x44,0xac,0,0];
test('PWM streams read little endian 16-bit units, interleave and never write YM2612',()=>{
  const commands=[...setup,...block([75,0,25,0,50,0,100,0]),
    ...stream(0,2,0,2),...stream(1,3,1,2),
    0x93,0,0,0,0,0,1,2,0,0,0,0x93,1,0,0,0,0,1,2,0,0,0,0x71,0x66];
  const {l,r}=render(commands,2);assert.deepEqual(l,[.5,0]);assert.deepEqual(r,[-.5,1]);
});
test('PWM fast stream uses bank-local block IDs, reverse/loop/stop and reset',()=>{
  const commands=[...setup,0x67,0x66,0,1,0,0,0,99,...block([75,0,25,0]),...stream(0,4),
    0x95,0,0,0,0x11,0x72,0x94,0xff,0x71,0x66];
  const {l,p}=render(commands,5);assert.deepEqual(l,[-.5,.5,-.5,.5,.5]);
  p.reset();p.play();const out=new Float32Array(5);p.process(out,new Float32Array(5),5);assert.deepEqual([...out],l);
});
