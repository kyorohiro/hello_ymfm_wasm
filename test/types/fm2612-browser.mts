import {createSoundChip, encodeWav, SoundChipMixer} from 'tetorica-fm2612';
import {YM2612Synth, YM2612WorkletTransport} from 'tetorica-fm2612/ym2612synth';
import {MegaSynth} from 'tetorica-fm2612/megasynth';
import {Playground} from 'tetorica-fm2612/playground_runtime';
import {createDeadlineScheduler} from 'tetorica-fm2612/playground_clock';
const chip = await createSoundChip('ym2612', {execution: 'worklet'});
const fm = new YM2612Synth({transport: new YM2612WorkletTransport(chip)});
fm.noteOn(0, 4, 553);
const synth = new MegaSynth({mega32X: true});
await synth.pwm?.read(0);
const pg = Playground({execution: 'worker'});
await pg.playSource('fm.noteOn(0, 4, 553);');
createDeadlineScheduler({now: () => performance.now()});
const bytes: Uint8Array = encodeWav({sampleRate: 48000, left: new Float32Array(128)});
void bytes;

const mixer = new SoundChipMixer();
mixer.set('gb1', {volume:0.28, pan:0, muted:false});
mixer.reset();
const mixedChip = await createSoundChip('gameboy', {execution:'worklet', mixer, id:'gb1'});
mixedChip.mixer.get(mixedChip.id).volume.toFixed(2);
const mixedSynth = new MegaSynth({mixer});
mixedSynth.mixer.set('ym2612', {volume:0.5});
// @ts-expect-error Mixer volume is a number.
mixer.set('gb1', {volume:'quiet'});
await mixedChip.dispose();

const autoChip = await createSoundChip('gameboy', {execution:'worklet', mixer});
autoChip.mixer.set(autoChip.id, {volume:0.3});
// @ts-expect-error Chip IDs cannot be reassigned.
autoChip.id = 'other';
import {YM2151Synth, YM2151WorkletTransport} from 'tetorica-fm2612/ym2151synth.js';
const opmEndpoint = await createSoundChip('ym2151', {execution: 'worklet'});
const opm = new YM2151Synth({transport: new YM2151WorkletTransport(opmEndpoint)});
opm.noteOn(7, 'C4', {operatorMask: 8});
opm.noteOff(7);
// @ts-expect-error Raw key fraction is numeric.
opm.setPitch(0, 0x4a, 'quarter');

import {NesApuSynth, NesApuWorkletTransport} from 'tetorica-fm2612/nesapusynth.js';
const nesEndpoint = await createSoundChip('nes', {execution: 'worklet', fds: true});
const nes = new NesApuSynth({transport: new NesApuWorkletTransport(nesEndpoint)});
nes.fds.noteOn('C4');
nes.pulse.noteOn(0, 'E4');
// @ts-expect-error FDS wave is an array of samples.
nes.fds.setWave('sine');
