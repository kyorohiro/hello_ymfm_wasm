// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDefaultPreset,readPreset} from './preset.js';
import {encodeDdaData} from './dda_pcm.js';
import {mergePcmVolumeVariants} from './vgm_pcm_variants.js';

function pcm(id,volume=24,edit=()=>{}) {
  const preset=createDefaultPreset();preset.source='dda';preset.volume=volume;
  preset.envelope.enabled=false;preset.name=`PCM CH${id}`;
  preset.dda={name:`source-${id}`,data:encodeDdaData([0,31,16,7]),sampleRate:5512.5,rootNote:60,loop:false,speed:1};
  edit(preset);
  return {id,kind:'pcm',channel:id,firstTime:id*100,occurrences:id,
    preset:readPreset(preset),origin:id%2?'stream':'direct',warnings:[`note ${id}`]};
}
function freeze(value) {
  if(value&&typeof value==='object') {for(const child of Object.values(value))freeze(child);Object.freeze(value);}
  return value;
}

test('the loudest PCM retains its exact representative while grouping only the library view',()=>{
  const quiet=pcm(1,8),loud=pcm(2,31),medium=pcm(3,21);
  loud.origins=['direct','stream'];loud.warnings.push('note 1');
  const input=freeze([quiet,loud,medium]),before=structuredClone(input);
  const result=mergePcmVolumeVariants(input);
  assert.equal(result.length,1);
  assert.equal(result[0].id,loud.id);assert.equal(result[0].channel,loud.channel);
  assert.equal(result[0].firstTime,loud.firstTime);assert.equal(result[0].preset,loud.preset);
  assert.equal(result[0].preset.name,loud.preset.name);assert.equal(result[0].preset.dda.name,loud.preset.dda.name);
  assert.equal(result[0].occurrences,6);assert.equal(result[0].volumeVariants,3);
  assert.deepEqual(result[0].origins,['stream','direct']);assert.deepEqual(result[0].warnings,['note 1','note 2','note 3']);
  assert.deepEqual(input,before);assert.notEqual(result[0],loud);
});

test('loud-first input and ties are stable, and applying the view twice preserves counts',()=>{
  const loud=pcm(1,30),quiet=pcm(2,2),tie=pcm(3,30);
  const result=mergePcmVolumeVariants([loud,quiet,tie]);
  assert.equal(result[0].id,loud.id);assert.equal(result[0].preset,loud.preset);
  assert.equal(result[0].occurrences,6);assert.equal(result[0].volumeVariants,3);
  assert.deepEqual(mergePcmVolumeVariants(result),result);
  const reversed=mergePcmVolumeVariants([tie,quiet,loud]);
  assert.equal(reversed[0].id,tie.id);assert.equal(reversed[0].preset,tie.preset);
});

test('every non-volume PCM setting remains significant, including pan and inactive chip settings',()=>{
  const edits=[p=>p.dda.data=encodeDdaData([0,31,16,8]),p=>p.dda.sampleRate=7000,
    p=>p.dda.rootNote=61,p=>p.dda.speed=1.5,p=>p.dda.loop=true,
    p=>p.pan.left=14,p=>p.pan.right=14,p=>p.envelope.enabled=true,p=>p.envelope.release=.5,
    p=>p.wave[0]=0,p=>p.noise.frequency=17,p=>p.lfo.frequency=33,p=>p.lfo.output.volume=1,
    p=>p.lfo.wave[0]=0];
  for(const edit of edits) {
    const base=pcm(1,8),different=pcm(2,31,edit);
    const result=mergePcmVolumeVariants([base,different]);
    assert.equal(result.length,2);assert.equal(result[0],base);assert.equal(result[1],different);
  }
});

test('non-PCM voices and singleton PCM retain identity, and groups keep first encounter order',()=>{
  const quiet=pcm(1,8),loud=pcm(2,31),other=pcm(3,12,p=>p.dda.loop=true);
  const nonPcm=['wave','noise','lfo'].flatMap((kind,index)=>[
    {...pcm(index+4,8),kind},{...pcm(index+7,31),kind},
  ]);
  const input=[quiet,...nonPcm,other,loud],result=mergePcmVolumeVariants(input);
  assert.equal(result.length,input.length-1);assert.equal(result[0].id,loud.id);
  for(let index=0;index<nonPcm.length;index++)assert.equal(result[index+1],nonPcm[index]);
  assert.equal(result.at(-1),other);
  assert.deepEqual(mergePcmVolumeVariants([]),[]);
});
