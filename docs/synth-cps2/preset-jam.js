// SPDX-License-Identifier: BSD-3-Clause
import {pcmRate} from './demo.js';

const bank = {
  source: null, bank: 0, clock: 4000000,
  bankHash: '29aa9de219134b11beccebe8a16f1810ff4168e1514b055324a11508fdf5d287',
};
const bass = {format: 'qsound-pcm-1', rate: pcmRate(60), loop: 256, volume: 7900, pan: 0x11e, send: 0};
function preset(name, fields) {
  return {path: '/presets/' + name, data: JSON.stringify({...bank, ...fields}, null, 2)};
}

const source = `// Change round-bass to bright-bass and press Apply. Play along on PCM CH3.
const bass = '/presets/round-bass.pcm.json';
await qsound.loadPreset(1, bass);
await livePrepare('jam-drum', () => qsound.loadPreset(2, '/presets/pulse-hit.adpcm.json'));
setBpm(116);

liveLoop('bass', async () => {
  for (const note of [36, 43, 46, 41]) {
    qsound.noteOn(1, note);
    await beat(0.75);
    qsound.noteOff(1);
    await beat(0.25);
  }
});

liveLoop('backbeat', async () => {
  await beat(1);
  qsound.trigger(2);
  await beat(1);
});
`;

export const presetJamFiles = [
  {path: '/examples/preset-jam.js', data: source},
  preset('round-bass.pcm.json', {...bass, start: 0, end: 256}),
  preset('bright-bass.pcm.json', {...bass, start: 256, end: 512}),
  preset('pulse-hit.adpcm.json', {format: 'qsound-adpcm-1', start: 1024, end: 1536, volume: 22000, pan: 0x122}),
];
