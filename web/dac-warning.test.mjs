import test from 'node:test';
import assert from 'node:assert/strict';
import {Ym2612VGM} from './ym2612vgm.js';
import {Ym2612VGM as DocsVGM} from '../docs/js/ym2612vgm.js';
import {VgmPlayer} from './vgmplayer.js';
function file(commands) {
  const data=new Uint8Array(0x100+commands.length),view=new DataView(data.buffer);
  data.set([86,103,109,32]);view.setUint32(8,0x171,true);view.setUint32(0x34,0xcc,true);data.set(commands,0x100);return data;
}
const bank=[0x67,0x66,0,2,0,0,0,17,34];
const start=[0x91,0,0,1,0,0x92,0,0x44,0xac,0,0,0x93,0,0,0,0,0,1,2,0,0,0];
for(const Parser of [Ym2612VGM,DocsVGM])test(`unsupported streams warn, cannot restart or corrupt ordinary writes (${Parser===DocsVGM?'docs':'web'})`,()=>{
  for(const type of [0x80,1,3,6,9,10,11,12,13,16,18,0x82,0x91,0x7f]){
    const warnings=[],writes=[];
    const parser=new Parser(file([...bank,0x90,0,type,0,0x2a,...start,0x61,10,0,0x95,0,0,0,1,0x61,10,0,0x52,0x22,8,0x66]),{logger:{warn:m=>warnings.push(m)}});
    const targets={ym2612:{writeRegister:(...args)=>writes.push(args)}};
    let time=0;
    while(!parser.ended){const event=parser.playStep(targets);if(event.type==='wait')parser.consumeWait(targets,event.samples,n=>time+=n);}
    assert.deepEqual(writes,[[0x22,8,0]]);assert.equal(time,20);
    assert.equal(warnings.length,1);assert.match(warnings[0],/instance=\d, stream=0.*Playback continues/);
  }
});
test('player continues output after unsupported stream and supported YM2612 setup can reuse its ID',()=>{
  const warnings=[],writes=[];
  const engine={reset(){},sampleRate:()=>44100,writeYm2612:(...args)=>writes.push(args),processFrames:n=>({left:new Float32Array(n).fill(.25),right:new Float32Array(n).fill(.25)})};
  const p=new VgmPlayer(engine);
  p.load(file([...bank,0x90,0,0x12,0,8,...start,0x61,4,0,0x90,0,2,0,0x2a,...start,0x61,4,0,0x66]),{logger:{warn:m=>warnings.push(m)}});
  p.play();const left=new Float32Array(8);p.process(left,new Float32Array(8),8);
  assert(left.every(x=>x===.25));assert.equal(warnings.length,1);
  assert.deepEqual(writes,[[0,0x2a,17],[0,0x2a,34]]);
});
