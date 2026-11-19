// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createFm2608GuardAudio} from '../../test/helpers/fm2608_adpcm_guard_audio.mjs';
import {waveShape} from './preset.js';

for (const rate of [44100,48000]) test(`actual OPNA ${rate}Hz UI Level/FM edits retain the audio-owned release deadline`,async() => {
  const f=await createFm2608GuardAudio(rate);
  try {
    await f.audio.noteOn('adpcm',0,60);f.render(1000);f.audio.noteOff('adpcm',0);f.render(128);
    const before=f.release.getState(),offset=f.writes.length,next=f.audio.getPreset();
    assert(before.active);
    next.adpcm.volume=191;next.fm[1].feedback=3;
    await f.audio.applyPreset(next);
    const after=f.release.getState();
    assert(after.active);assert.equal(after.endFrame,before.endFrame);
    assert(!f.writes.slice(offset).some(write => write.port===1&&write.register===0),'a parameter edit cannot substitute a raw Stop for a musical release');
    assert.equal(f.audio.capturePreset().adpcm.volume,191);
    assert.equal(f.audio.capturePreset().fm[1].feedback,3);
    const tail=f.render(before.endFrame-f.frame+256).left;
    assert(tail.subarray(-128).every(value => value===0));
    assert.equal(f.release.getState().physicalVolume,0);
    assert.equal(f.chip.adpcm.registers[11],191,'the authored volume remains separate from the rendered fade');
    await f.audio.noteOn('adpcm',0,60);
    assert.equal(f.release.getState().physicalVolume,191);
    assert(f.render(256).left.some(value => Math.abs(value)>.05));
  } finally {await f.dispose();}
});

test('actual PCM replacement cancels the former release without stopping a subsequently triggered sample',async() => {
  const f=await createFm2608GuardAudio();
  try {
    await f.audio.noteOn('adpcm',0,60);f.render(1000);f.audio.noteOff('adpcm',0);f.render(128);
    await f.audio.setWave(waveShape('triangle'),{rootNote:60});
    assert(!f.release.getState().active);
    await f.audio.noteOn('adpcm',0,60);f.writes.length=0;
    const pcm=f.render(1024).left;
    assert(pcm.subarray(-128).some(value => Math.abs(value)>.05));
    assert(!f.writes.some(write => write.port===1&&write.register===0&&write.value===1),'the retired tail cannot stop the replacement');
  } finally {await f.dispose();}
});
