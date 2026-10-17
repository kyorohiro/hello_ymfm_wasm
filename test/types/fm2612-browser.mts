import {createSoundChip, encodeWav, SoundChipMixer} from 'tetorica-fm2612';
import {YM2612Synth, YM2612WorkletTransport} from 'tetorica-fm2612/ym2612synth';
import {MegaSynth} from 'tetorica-fm2612/megasynth';
import {Playground} from 'tetorica-fm2612/playground_runtime';
import {createDeadlineScheduler} from 'tetorica-fm2612/playground_clock';
const chip = await createSoundChip('ym2612', {execution: 'worklet'});
const fm = new YM2612Synth({transport: new YM2612WorkletTransport(chip)});
fm.noteOn(0, 4, 553);
const synth = new MegaSynth({mega32X: true});
synth.setOutputEnvelopeOptions({samplesPerPoint:128, pointsPerMessage:16});
synth.setOutputEnvelopeOptions({enabled:false});
// @ts-expect-error Sample counts are numbers.
synth.setOutputEnvelopeOptions({samplesPerPoint:'128'});
await synth.pwm?.read(0);
const pg = Playground({execution: 'worker', workerLookaheadSeconds: 0.15});
pg.setTiming({workerLookaheadSeconds: 0});
pg.getTiming().workerLookaheadSeconds.toFixed(3);
// @ts-expect-error Worker lead is specified in numeric seconds.
pg.setTiming({workerLookaheadSeconds: '150ms'});
// @ts-expect-error Constructor lead is specified in numeric seconds.
Playground({workerLookaheadSeconds: 'fast'});
await pg.playSource('fm.noteOn(0, 4, 553);');
createDeadlineScheduler({now: () => performance.now()});
const bytes: Uint8Array = encodeWav({sampleRate: 48000, left: new Float32Array(128)});
void bytes;

const mixer = new SoundChipMixer();
mixer.set('gb1', {volume:0.28, pan:0, muted:false, solo:true});
const stopMixChanges = mixer.subscribe(entries => {entries[0]?.effectiveMuted.valueOf();});
const stopMixMeters = mixer.subscribeMeters(entries => {entries[0]?.left.toFixed(2); entries[0]?.id.toUpperCase();});
stopMixChanges(); stopMixMeters();
// @ts-expect-error Solo is a boolean.
mixer.set('gb1', {solo:'yes'});
// @ts-expect-error Meter peaks are numbers.
mixer.subscribeMeters(entries => entries[0]?.right.toUpperCase());
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

import {createSnesClient} from 'tetorica-fm2612/playground_snes.js';
import {SpcRuntimeSynth} from 'tetorica-fm2612/spc_audio.js';
import {SpcCore, SnesDspCore} from 'tetorica-fm2612/spc.js';
import {SnesSynth} from 'tetorica-fm2612/snessynth.js';
import spcFactory from 'tetorica-fm2612/generated/spc_wasm.js';
const spcCore = await SpcCore.create({moduleFactory:spcFactory});
spcCore.load(new Uint8Array());
spcCore.nativeFrames.toFixed();
const snesCore = await SnesDspCore.create({moduleFactory:spcFactory});
const offlineSnes = new SnesSynth({core:snesCore});
offlineSnes.renderInto(new Float32Array(128), new Float32Array(128));
// @ts-expect-error Explicit factory/asset initialization is required.
await SpcCore.create();
// @ts-expect-error PCM output is Float32.
spcCore.renderInto(new Int16Array(128), new Int16Array(128));
const snes = createSnesClient(new MessageChannel().port1);
const brr = new Uint8Array([3,0,0,0,0,0,0,0,0]);
const snesSample = await snes.loadBRR(brr, {rootNote:'C4', loopStartSamples:0});
snes.setPreset(0, {sample:snesSample, volumeLeft:90});
snes.noteOn(0, 'C4');
(await snes.getPreset(0)).pitch.toFixed();
(await snes.getState()).nextAddress.toFixed();
// @ts-expect-error Explicit musical tuning is required.
await snes.loadBRR(brr, {loopStartSamples:0});
// @ts-expect-error Root note and measured frequency are mutually exclusive.
await snes.loadBRR(brr, {rootNote:60, baseFrequencyHz:440});
// @ts-expect-error No variable S-DSP clock.
snes.setClock(1024000);
const spc = new SpcRuntimeSynth({audioContext:new AudioContext()});
await spc.seek(1.5, {signal:new AbortController().signal, resume:false, onProgress:progress=>progress.toFixed(2)});
(await spc.getState()).positionSeconds.toFixed(3);
(await spc.snapshot()).ram.byteLength.toFixed();
// @ts-expect-error Seek is in elapsed seconds, not unit strings.
await spc.seek('1 beat');
