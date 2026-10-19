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

import {NativeRuntimeSynth} from 'tetorica-fm2612/native_runtime_synth.js';
const nativeNes = new NativeRuntimeSynth({chip:'nes',audioContext:new AudioContext()});
nativeNes.nes?.fds.setVolume(24);
nativeNes.nes?.pulse.noteOn(0,'C4');
const nativeSnes = new NativeRuntimeSynth({chip:'snes'});
nativeSnes.snes?.noteOn(7,'C4');
const nativeX68 = new NativeRuntimeSynth({chip:'x68000',extraOki:{wasmUrl:new URL('oki.wasm',location.href)}});
nativeX68.opm?.allNotesOff();
await nativeX68.adpcm?.loadSample({channels:[new Float32Array(32)],sampleRate:15625});
const nativePce = new NativeRuntimeSynth({chip:'huc6280'});
nativePce.pce?.setWaveform(5,new Uint8Array(32));
nativePce.pce?.setNoise(5,{enabled:true,frequency:20});
const nativePsg = new NativeRuntimeSynth({chip:'segapsg',stereoEnabled:true,clock:3579545});
nativePsg.psg?.setStereo(0xf1);
nativePsg.psg?.allNotesOff();
import {createTetoricaSynth} from 'tetorica-fm2612/tetorica_synth.js';
createTetoricaSynth({chip:'segapsg',stereoEnabled:false,clock:3579545,fetch:globalThis.fetch});
createTetoricaSynth({chip:'x68000',extraOki:{wasmUrl:'oki.wasm'}});
// @ts-expect-error Stereo support is a boolean option.
createTetoricaSynth({chip:'segapsg',stereoEnabled:'mono'});
// @ts-expect-error Chip clocks are numeric Hz values.
createTetoricaSynth({chip:'segapsg',clock:'3579545'});
// @ts-expect-error OPN chips use their own primary runtime.
new NativeRuntimeSynth({chip:'ym2612'});

// Native chips and audio/Keyboard hosting are available through the public Playground constructor.
const nativePlayground = Playground({
  chip:'huc6280',clock:3579545,fetch:globalThis.fetch,stereoEnabled:false,wasmUrl:new URL('pce.wasm',location.href),
  inputAudio:async (options,{signal}) => {
    options.asset?.toUpperCase(); options.edit?.valueOf(); signal.throwIfAborted();
    return {name:'microphone',source:'microphone',sampleRate:16000,channels:[new Float32Array(16000)]};
  },
  onKeyboardTargetChange(target) {
    if (!target) return;
    target.name.toUpperCase(); target.noteOn({id:'key-1',midi:60,velocity:100});
    target.noteOff({id:'key-1',midi:60}); target.allNotesOff();
  },
});
for (const chip of ['nes','snes','x68000','segapsg','gameboy'] as const) Playground({chip});
await nativePlayground.playSource('const audio = await inputAudio({asset:"/samples/voice.sample.json",edit:false});');
// @ts-expect-error An OKI stream is part of the X68000 primary, not a standalone primary chip.
Playground({chip:'okim6258'});
// @ts-expect-error Native primary clock is numeric Hz.
Playground({chip:'huc6280',clock:'3579545'});
// @ts-expect-error Keyboard event pitches are numeric MIDI.
Playground({onKeyboardTargetChange:target => target?.noteOn({id:'key',midi:'C4'})});
// @ts-expect-error Audio providers return decoded PCM channels.
Playground({inputAudio:async () => ({name:'invalid',source:'file',sampleRate:16000,channels:['file.wav']})});

import {createHuc6280Client} from 'tetorica-fm2612/playground_huc6280.js';
import {createOki6258Client} from 'tetorica-fm2612/playground_okim6258.js';
const pce = createHuc6280Client(new MessageChannel().port1);pce.initialize();pce.setWaveform(0,new Uint8Array(32));pce.setNote(0,'A4');
const oki = createOki6258Client(new MessageChannel().port1);await oki.loadSample({channels:[new Float32Array(32)],sampleRate:16000});oki.setDivider(512);oki.play({repeat:true});
// @ts-expect-error Pan uses boolean channel routing.
oki.setPan('left',true);
