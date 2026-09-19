import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,renderSource} from '../cli/index.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {GenesisAudioEngine} from '../docs/js/genesisaudioengine.js';
import {createPlaybackPlayer} from '../docs/vgm_analyzer/playback_core.js';
import {Ym2612VGM} from '../docs/js/ym2612vgm.js';
import {renderVgmToWav} from '../docs/vgm_analyzer/vgm_wav.js';
const fixture=name=>new URL(`./fixtures/pwm-${name}.vgz`,import.meta.url);
test('32X PWM direct/stream/stereo and Genesis combinations match Browser engine and reset',async()=>{
  const outputs={};
  for(const name of ['direct','stream','stereo','fm','psg','pcm','all']){
    const source=await readSource(fixture(name)),h=new Ym2612VGM(source).header;
    const result=await renderSource(source,{maxSeconds:.05});outputs[name]=result.bytes;
    assert.deepEqual(result.warnings,[]);assert(result.bytes.subarray(44).some(v=>v!==0),name);
    const e=await GenesisAudioEngine.create({
      ym2612ModuleFactory:await getNodePlaybackFactory('ym2612'),segaPsgModuleFactory:await getNodePlaybackFactory('segapsg'),
      ym2612Clock:h.ym2612Clock||undefined,psgClock:h.psgClock||undefined,
      rf5c164Clock:h.rf5c164Clock,rf5c164ModuleFactory:h.rf5c164Clock?await getNodePlaybackFactory('rf5c164'):undefined,
    });
    try{
      const p=createPlaybackPlayer(e,source);
      if(name==='stereo'){p.play();const l=new Float32Array(100),r=new Float32Array(100);p.process(l,r,100);for(let i=0;i<100;i++)assert.equal(l[i]-r[i],1);}
      for(let run=0;run<2;run++){p.reset();p.play();assert.deepEqual(result.bytes,(await renderVgmToWav(p,{maxSeconds:.05})).bytes);}
      if(name==='all')for(const mute of [()=>e.setPwmMuted(true),()=>e.setPcmMuted(true),()=>e.setPsgMuted(true)]){
        p.reset();mute();p.play();assert.notDeepEqual(result.bytes,(await renderVgmToWav(p,{maxSeconds:.05})).bytes);
        e.setPwmMuted(false);e.setPcmMuted(false);e.setPsgMuted(false);
      }
    }finally{e.dispose();}
  }
  assert.deepEqual(outputs.direct,outputs.stream,'stream scheduling must equal timed writes');
  const v=new DataView(outputs.stereo.buffer,outputs.stereo.byteOffset);
  for(let i=44;i<outputs.stereo.length;i+=4){assert(v.getInt16(i,true)>0);assert(v.getInt16(i+2,true)<0);}
  for(const name of ['fm','psg','pcm','all'])assert.notDeepEqual(outputs[name],outputs.direct,name);
});
test('32X PWM rejects dual/variant flags and unsupported mixed chip families',async()=>{
  const source=await readSource(fixture('direct'));
  for(const [offset,value] of [[0x70,0x40000000+23011361],[0x70,0x80000000+23011361],[0x30,3579545],[0x74,1789773]]){
    const bad=source.slice();new DataView(bad.buffer).setUint32(offset,value,true);
    await assert.rejects(renderSource(bad),e=>e.code==='UNSUPPORTED_CONFIGURATION');
  }
});
