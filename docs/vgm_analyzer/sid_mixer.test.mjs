// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {RsidPlayerCore} from '../sid-player/rsid_core.js';
import {Sid8580PlayerCore} from '../sid-player/core8580.js';
import {createSidReferenceFixture} from '../sid-player/demos/fixture.mjs';

const binary = path => readFile(new URL('../generated/'+path,import.meta.url));
for (const model of ['6581','8580']) test(model+' independent pre-filter voice muting',async () => {
  const create = async mixer => model === '6581'
    ? RsidPlayerCore.create({sampleRate:48000,wasmBinary:await binary(mixer?'sid-analyzer/6581.wasm':'sid-rsid/sid-rsid.wasm')})
    : Sid8580PlayerCore.create({sampleRate:48000,endpointBinary:await binary(mixer?'sid-analyzer/8580.wasm':'sid8580-machine/sid8580-endpoint.wasm'),
      machineBinary:await binary('sid8580-machine/sid8580-machine.wasm')});
  const original = await create(false), mixer = await create(true);
  const set = (mixer.machine?.endpoint.exports ?? mixer.exports).analyzer_set_mute;
  try {
    for (let voice=0;voice<3;voice++) {
      const {bytes} = createSidReferenceFixture('tone');
      if (model==='8580') new DataView(bytes.buffer).setUint16(118,0x24);
      // Move the original fixture's voice-register writes to each physical voice.
      for (let i=126;i+2<bytes.length;i++) if (bytes[i]===0x8d && bytes[i+2]===0xd4 && bytes[i+1]<7) bytes[i+1]+=7*voice;
      for (const core of [original,mixer]) core.load(bytes,{subtune:1,vbiBackend:'c64',model});
      set(0);
      assert.deepEqual(mixer.render(4096),original.render(4096));
      set(7 ^ (1<<voice));
      mixer.render(4096);
      const range = pcm => Math.max(...pcm)-Math.min(...pcm);
      assert(range(mixer.render(4096))>.001,'active voice survives muting its neighbors');
      set(7); mixer.render(24000);
      assert(range(mixer.render(4096)) < .0005,'muted output settles');
      set(0); mixer.render(4096);
      assert(range(mixer.render(4096))>.001,'unmute restores the running voice');
    }
  } finally {original.dispose();mixer.dispose();}
});
