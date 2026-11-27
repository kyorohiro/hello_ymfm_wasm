// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import {demoVgm} from '../synth-cps2/demo.js';
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
