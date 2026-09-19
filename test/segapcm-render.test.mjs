import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,renderSource} from '../cli/index.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {SegaPcmAudioEngine} from '../docs/js/segapcmaudioengine.js';
import {Ym2151AudioEngine} from '../docs/js/ym2151audioengine.js';
import {createPlaybackPlayer} from '../docs/vgm_analyzer/playback_core.js';
import {renderVgmToWav} from '../docs/vgm_analyzer/vgm_wav.js';
const fixture=name=>new URL(`./fixtures/segapcm-${name}.vgz`,import.meta.url);
test('Sega PCM embedded banks and OPM/PSG compositions match Browser engines and reset',async()=>{
  const outputs={};
  for(const name of ['bank0','bank1','psg','opm','opm-psg']) {
    const source=await readSource(fixture(name));
    const result=await renderSource(source,{maxSeconds:.05});outputs[name]=result.bytes;
    assert.deepEqual(result.warnings,[]);assert(result.bytes.subarray(44).some(v=>v!==0),name);
    const pcmFactory=await getNodePlaybackFactory('segapcm');
    const common={segaPsgModuleFactory:await getNodePlaybackFactory('segapsg'),psgClock:name.includes('psg')?3579545:0};
    const e=name.startsWith('opm')
      ?await Ym2151AudioEngine.create({...common,ym2151ModuleFactory:await getNodePlaybackFactory('ym2151'),ym2151Clock:3579545,segaPcmModuleFactory:pcmFactory,segaPcmClock:4000000,segaPcmBankShift:8,segaPcmBankMask:4})
      :await SegaPcmAudioEngine.create({...common,moduleFactory:pcmFactory,clock:4000000,bankShift:8,bankMask:4});
    try {
      const p=createPlaybackPlayer(e,source);
      for(let run=0;run<2;run++){p.reset();p.play();assert.deepEqual(result.bytes,(await renderVgmToWav(p,{maxSeconds:.05})).bytes);}
    }finally{e.dispose();}
  }
  // Bank selection must actually change the sampled data, not just parse the header.
  for(const [name,sign] of [['bank0',-1],['bank1',1]]){
    const view=new DataView(outputs[name].buffer,outputs[name].byteOffset);
    const left=view.getInt16(44+100*4,true),right=view.getInt16(46+100*4,true);
    assert(left*sign>0,name);assert(right*sign>0,name);assert(Math.abs(left)>Math.abs(right),'stereo volumes');
  }
  for(const name of ['psg','opm','opm-psg'])assert.notDeepEqual(outputs[name],outputs.bank1);
  assert.notDeepEqual(outputs['opm-psg'],outputs.opm);assert.notDeepEqual(outputs['opm-psg'],outputs.psg);
});
test('Sega PCM rejects unsupported configurations and invalid embedded ROM ranges',async()=>{
  const source=await readSource(fixture('bank1'));
  for(const [offset,value] of [[0x38,0x40000000+4000000],[0x38,0x80000000+4000000],[0x2c,7670454]]){
    const bad=source.slice();new DataView(bad.buffer).setUint32(offset,value,true);
    await assert.rejects(renderSource(bad),e=>e.code==='UNSUPPORTED_CONFIGURATION');
  }
  for(const [offset,value] of [[267,2048],[263,0x200001]]){
    const bad=source.slice();new DataView(bad.buffer).setUint32(offset,value,true);
    await assert.rejects(renderSource(bad),/range/i);
  }
});
