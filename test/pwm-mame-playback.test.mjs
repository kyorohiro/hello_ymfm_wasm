import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {maybeDecodeVgmFile} from '../web/vgm_file.js';
import {Ym2612VGM} from '../web/ym2612vgm.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {createPlaybackEngine,createPlaybackPlayer} from '../docs/vgm_analyzer/playback_core.js';

test('PWM models receive the VGM clock, render and reset reproducibly, and preserve state',async()=>{
 const buffer=await maybeDecodeVgmFile(await readFile(new URL('./fixtures/pwm-stereo.vgz',import.meta.url)));
 const parser=new Ym2612VGM(buffer),outputs={};
 for(const pwmModel of ['legacy','mame',undefined]){
  const engine=await createPlaybackEngine(parser,{getFactory:getNodePlaybackFactory,pwmModel});
  try{
   const player=createPlaybackPlayer(engine,buffer);player.setPrefetchFactor(1);player.play();
   const left=new Float32Array(4096),right=new Float32Array(4096);player.process(left,right,4096);outputs[pwmModel]=left.slice();
   assert.ok(left.every(Number.isFinite));assert.ok(left.some(value=>Math.abs(value)>.01));
   player.reset();player.play();const again=new Float32Array(4096);player.process(again,new Float32Array(4096),4096);assert.deepEqual(again,left);
   if(pwmModel!=='legacy'){
    assert.equal(engine.pwm.constructor.name,'PWM32X');assert.equal(engine.pwm.outputMode,'duty');
    assert.equal(engine.pwm.clock,parser.header.pwmClock);assert.equal(engine.pwm.sampleRate(),engine.sampleRate());
    const state=engine.saveState(),expected=engine.processFrames(100);engine.loadState(state);assert.deepEqual(engine.processFrames(100),expected);
    engine.setPwmMuted(true);assert.ok(engine.pwm.generateStereo(100).left.every(v=>v===0));
   }
  }finally{engine.dispose();}
 }
 assert.notDeepEqual(outputs.legacy,outputs.mame,'the models intentionally use different timing');
 assert.deepEqual(outputs.undefined,outputs.mame,'default VGM playback is the confirmed MAME model');
 await assert.rejects(createPlaybackEngine(parser,{pwmModel:'unknown'}),/PWM model/);
});
