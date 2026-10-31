import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {restoreMixerCalibrationKeyboardOctaveRevision,assertMixerCalibrationSourceFreshness} from './mixer_calibration_sources.mjs';
import {createFretboardState,createFretboardLayout} from '../docs/synth/synth_keyboard.js';

const path='synth/synth_keyboard.js';
const bytes=await readFile(new URL('../docs/'+path,import.meta.url));
const original=restoreMixerCalibrationKeyboardOctaveRevision(path,bytes);
const record={bytes:9982,sha256:'ba14f89680e240e2ccda1e13f7df6345f8e1ebec876613df9f1294eff93d83fc'};

test('reviewed optional octave UI reconstructs the complete measured keyboard',()=>{
  assert.notEqual(original,bytes);
  assert.equal(original.length,record.bytes);
  assert.equal(createHash('sha256').update(original).digest('hex'),record.sha256);
  assert.equal(assertMixerCalibrationSourceFreshness({path,bytes,record}),'ui-keyboard-octave');
});

test('unreviewed keyboard, import, gain, default or path changes still fail freshness',()=>{
  for(const changed of [Buffer.concat([bytes,Buffer.from('\n')]),
    Buffer.from(bytes.toString().replace('octave = 0','octave = 1')),
    Buffer.from(bytes.toString().replace('octave * 12','octave * 24')),
    Buffer.from(bytes.toString().replace('soundchip_pitch.js','other.js'))]){
    assert.equal(restoreMixerCalibrationKeyboardOctaveRevision(path,changed),changed);
    assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes:changed,record}),/remeasure/);
  }
  assert.equal(restoreMixerCalibrationKeyboardOctaveRevision('js/renderer.js',bytes),bytes);
  assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes,record:{...record,sha256:'0'.repeat(64)}}),/remeasure/);
});

test('Playground default layouts preserve every measured key, note and chip pitch',async()=>{
  const pitchUrl=new URL('../docs/js/soundchip_pitch.js',import.meta.url).href;
  const source=original.toString().replace('../js/soundchip_pitch.js',pitchUrl);
  const previous=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  for(const horizontalFretPosition of [0,5,12])for(const verticalStringPosition of [0,2]){
    const state={...createFretboardState(),horizontalFretPosition,verticalStringPosition};
    for(const clock of [4000000,7670454]){
      const options={state,clock};
      assert.deepEqual(createFretboardLayout(options),previous.createFretboardLayout(options));
    }
  }
});
