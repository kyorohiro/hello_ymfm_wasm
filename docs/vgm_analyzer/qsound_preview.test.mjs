// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import {adpcmScore,demoVgm,demoTracks} from '../synth-cps2/demo.js';
import {renderSource} from '../../tetorica_src/cli/render.js';

test('CPS2 demo WAV contains two independently mutable, oppositely panned PCM voices', async () => {
  const demo = demoVgm();
  async function samples(mute) {
    const {bytes} = await renderSource(demo, {mute});
    return new Int16Array(bytes.buffer, bytes.byteOffset + 44, (bytes.length - 44) / 2);
  }
  const mix = await samples([]);
  const bass = await samples(['qsound-ch-2']);
  const lead = await samples(['qsound-ch-1']);
  const silent = await samples(['qsound-ch-1','qsound-ch-2']);
  assert.ok(mix.length > 44100 && mix.length === silent.length);
  assert.ok(silent.every(value => value === 0));
  const bassEnergy = [0,0], leadEnergy = [0,0];
  for (let i = 0; i < mix.length; i++) {
    assert.ok(Math.abs(mix[i] - bass[i] - lead[i]) <= 1);
    bassEnergy[i % 2] += bass[i] ** 2;
    leadEnergy[i % 2] += lead[i] ** 2;
  }
  assert.ok(bassEnergy[0] > bassEnergy[1] && bassEnergy[1] > 0);
  assert.ok(leadEnergy[1] > leadEnergy[0] && leadEnergy[0] > 0);
});

test('QSound rejects a ROM write beyond its declared size before rendering', async () => {
  const demo = demoVgm();
  new DataView(demo.buffer).setUint32(256 + 11, 1, true);
  await assert.rejects(renderSource(demo), /QSound ROM range/);
});

test('ADPCM trio renders each one-shot only on its assigned voice', async () => {
  const bytes = demoVgm(adpcmScore());
  for (const voice of [0,1,2]) {
    const mute = [0,1,2].filter(i => i !== voice).map(i => 'qsound-ch-' + (17+i));
    const wav = await renderSource(bytes, {mute});
    const samples = new Int16Array(wav.bytes.buffer, wav.bytes.byteOffset+44, (wav.bytes.length-44)/2);
    for (const [beat,active] of [0,1,2,0,2,1].entries()) {
      const start = beat*11025*2;
      const pulse = samples.subarray(start, start+11025*2);
      assert.equal(pulse.some(Boolean), active === voice);
      if (active !== voice) continue;
      assert.ok(pulse.subarray(6500*2).every(x=>x===0));
      for (let i=0; i<pulse.length; i+=2) {
        if (voice === 0) assert.equal(pulse[i+1],0);
        if (voice === 1) assert.equal(pulse[i],pulse[i+1]);
        if (voice === 2) assert.equal(pulse[i],0);
      }
    }
  }
});

test('echo demo exports silence after the dry note and a decaying return after the second', async () => {
  const demo = demoVgm(demoTracks.echo.score());
  const {bytes} = await renderSource(demo);
  const pcm = new Int16Array(bytes.buffer, bytes.byteOffset+44, (bytes.length-44)/2);
  function peak(start,end) {
    let amplitude = 0;
    for (const value of pcm.subarray(2*start,2*end)) amplitude = Math.max(amplitude, Math.abs(value));
    return amplitude;
  }
  assert.ok(peak(0,700)>0);
  assert.equal(peak(705,22050),0);
  const firstReturn = peak(23750,24550);
  assert.ok(firstReturn > peak(25500,26350) && peak(25500,26350) > 0);
  const muted = await renderSource(demo,{mute:['qsound-ch-1']});
  assert.ok(muted.bytes.subarray(44).every(x=>x===0));
});
