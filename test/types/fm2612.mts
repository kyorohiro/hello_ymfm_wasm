import {createSoundChip, encodeWav} from 'tetorica-fm2612';
import {runtimeAssetUrl} from 'tetorica-fm2612/assets';
import {YM2612Synth, YM2612DirectTransport, YM2612WorkletTransport} from 'tetorica-fm2612/ym2612synth.js';
import {YM2612Synth as ExtensionlessSynth} from 'tetorica-fm2612/ym2612synth';
import {PWM32XWorkletTransport, PWM32XDirectTransport} from 'tetorica-fm2612/pwm32x_transport.js';
import {MegaSynth} from 'tetorica-fm2612/megasynth.js';
import {Playground} from 'tetorica-fm2612/playground_runtime.js';
import {GameboySynth} from 'tetorica-fm2612/gameboysynth.js';
import {GameboyWorkletTransport} from 'tetorica-fm2612/chip_worklet_transport.js';
import {createMegaSynthOffline} from 'tetorica-fm2612/megasynth_offline.js';
import {MegaSynthNode} from 'tetorica-fm2612/node';
import {YM2612AudifyTransport, PWM32XAudifyTransport} from 'tetorica-fm2612/node/transports';
import {YM2151AudifyTransport} from 'tetorica-fm2612/node/transports';
import {YM2151Synth, YM2151DirectTransport} from 'tetorica-fm2612/ym2151synth.js';
import {FM_PRESETS} from 'tetorica-fm2612/megasynth-fm-presets.js';

const opmChip = await createSoundChip('ym2151');
const opm = new YM2151Synth({transport: new YM2151DirectTransport(opmChip)});
opm.setPreset(0, FM_PRESETS.sine);
opm.noteOn(0, 'A4');
opm.setOperator(0, 1, {dt2: 2, multi: 3, am: true});
opm.setPan(0, true, false, 2, 3);
opm.setLFO({frequency: 128, amDepth: 50, pmDepth: 60, waveform: 2});
opm.setFrequency(0, 440);
new YM2151Synth({transport: new YM2151AudifyTransport(opmChip)});
// @ts-expect-error Notes are strings or MIDI numbers.
opm.noteOn(0, {});
// @ts-expect-error Pan is boolean.
opm.setPan(0, 'left', true);
// @ts-expect-error OPM has no SSG envelope.
opm.setOperator(0, 1, {ssg: 2});
// @ts-expect-error LFO depths are numeric.
opm.setLFO({pmDepth: 'high'});

const chip = await createSoundChip('ym2612', {sampleRate: 48000, signal: new AbortController().signal});
chip.writeRegister(0x28, 0xf0);
const fm = new YM2612Synth({transport: new YM2612DirectTransport(chip)});
fm.noteOn(0, 4, 553);
const alsoFM: ExtensionlessSynth = fm;
void alsoFM;
new YM2612AudifyTransport(chip, {outputModule: 'file:///output.mjs', outputOptions: {deviceId: 1}});
// @ts-expect-error Unknown chip names must not become any.
await createSoundChip('typo');
// @ts-expect-error A direct chip has no AudioWorklet output node.
chip.node.connect(new AudioContext().destination);
// @ts-expect-error FM parameters are numbers.
fm.noteOn('zero', 4, 553);
// @ts-expect-error Unsupported Worklet chip.
await createSoundChip('ym2203', {execution: 'worklet'});

const worklet = await createSoundChip('ym2612', {execution: 'worklet'});
new YM2612Synth({transport: new YM2612WorkletTransport(worklet)});
await worklet.start();
// @ts-expect-error Worklet endpoints cannot synchronously render PCM on Main.
worklet.generateStereo(128);
const pwm = await createSoundChip('pwm', {outputMode: 'duty', gain: 1});
const direct = new PWM32XDirectTransport(pwm);
direct.scheduleWrites([{frame: 32, register: 4, value: 700}]);
new PWM32XAudifyTransport(pwm);
const pw = new PWM32XWorkletTransport(await createSoundChip('pwm', {execution: 'worklet'}));
const value: number = await pw.read(0);
const frame: number = await pw.scheduleWrites([{frame: 0, register: 0, value: 5}]);
void value; void frame;
// @ts-expect-error A malformed scheduled write must fail type checking.
await pw.scheduleWrites([{frame: 'later', register: 4, value: 700}]);
const browser = new MegaSynth({mega32X: true});
await browser.pwm?.write(4, 700);
const node = new MegaSynthNode({mega32X: true, outputModule: null});
await node.fm.noteOn(0, 4, 553);
await node.pwm.scheduleWrites([{frame: 0, register: 4, value: 700}]);
const pcm = await node.render(128);
const bytes: Uint8Array = encodeWav(pcm);
const url: URL = runtimeAssetUrl('generated/ym2612_wasm.wasm');
void bytes; void url;
// @ts-expect-error Worker FM must retain parameter types.
await node.fm.noteOn('zero', 4, 553);
// @ts-expect-error PCM frame counts are numeric.
await node.render('128');
// @ts-expect-error Unsupported Node options must be caught.
new MegaSynthNode({bufferFrames: '512'});
// @ts-expect-error WAV input requires a sample rate and PCM channels.
encodeWav({sampleRate: 48000});

const gb = await createSoundChip('gameboy', {execution: 'worklet'});
new GameboySynth({transport: new GameboyWorkletTransport(gb)});
const offline = await createMegaSynthOffline({mega32X: true});
offline.pwm?.scheduleWrites([{frame: 0, register: 4, value: 700}]);
encodeWav(offline.render(128));
const playground = Playground({execution: 'worker'});
await playground.playSource("const pwm = await useSoundChip('pwm');", {execution: 'main'});
await node.recording.play({format: 'megasynth-recording-v1', commands: []}, {loop: true});
const recordingState: {recording: boolean, playing: boolean} = await node.recording.getState();
void recordingState;
await node.looper.exportAudio('unit-1');
// @ts-expect-error Recording commands are an explicit method set.
await node.recording.nonexistent();
// @ts-expect-error Source is JavaScript text, not a callback.
await playground.playSource(() => {});

chip.id.toUpperCase();
// @ts-expect-error Direct chip IDs are readonly.
chip.id = 'other';

import {NesApuSynth, NesApuDirectTransport} from 'tetorica-fm2612/nesapusynth.js';
import {NesApuAudifyTransport} from 'tetorica-fm2612/node/transports';
const nesChip = await createSoundChip('nes', {fds: true});
const nesSynth = new NesApuSynth({transport: new NesApuDirectTransport(nesChip)});
nesSynth.pulse.setVoice(0, {duty: 0.5, volume: 10});
nesSynth.triangle.noteOn('C3');
nesSynth.fds.setWave(new Uint8Array(64));
nesSynth.fds.setModulation({table: new Uint8Array(32), rate: 120, depth: 4});
await nesSynth.dmc.loadSample(new Uint8Array(33));
new NesApuAudifyTransport(nesChip);
// @ts-expect-error Pulse duty is a discrete hardware value.
nesSynth.pulse.setVoice(0, {duty: 0.3});
// @ts-expect-error Noise mode is boolean.
nesSynth.noise.setVoice({shortMode: 'short'});
// @ts-expect-error DMC loads encoded bytes, not note names.
await nesSynth.dmc.loadSample('C4');

// Engine factory options retain their native loader types through convenience exports.
import {createGameboyApuAudioEngine, GameboyApuAudioEngine} from 'tetorica-fm2612/gameboyapuaudioengine.js';
import {createGenesisAudioEngine} from 'tetorica-fm2612/genesisaudioengine.js';
import {createYm2610BAudioEngine} from 'tetorica-fm2612/ym2610baudioengine.js';
import {createMsxAudioEngine} from 'tetorica-fm2612/msxaudioengine.js';
import type {WasmModuleFactory} from 'tetorica-fm2612';
declare const wasmFactory: WasmModuleFactory;
type IsAny<T> = 0 extends (1 & T) ? true : false;
const gameboyEngineOptionsAreAny: IsAny<Parameters<typeof createGameboyApuAudioEngine>[0]> = false;
const engine = await createGameboyApuAudioEngine({moduleFactory: wasmFactory, clock: 4194304, outputSampleRate: 48000});
new GameboyApuAudioEngine(engine.gameboy, 0.5);
await createGameboyApuAudioEngine({moduleFactory: wasmFactory});
await createGenesisAudioEngine({ym2612ModuleFactory: wasmFactory, segaPsgModuleFactory: wasmFactory, pwmModel: 'mame'});
await createYm2610BAudioEngine({moduleFactory: wasmFactory, clock: 8000000, variant: false});
await createMsxAudioEngine({chips: [{type: 'ay8910', options: {moduleFactory: wasmFactory, clock: 1789773}}]});
// @ts-expect-error Sample rates are numbers.
await createGameboyApuAudioEngine({moduleFactory: wasmFactory, clock: 4194304, outputSampleRate: '48000'});
// @ts-expect-error Factories return native chip modules, not arbitrary values.
await createGameboyApuAudioEngine({moduleFactory: () => 42, clock: 4194304});
// @ts-expect-error An engine borrows a Game Boy chip, not a channel number.
new GameboyApuAudioEngine(0);
// @ts-expect-error Explicit MSX descriptors must match their selected chip's options.
await createMsxAudioEngine({chips: [{type: 'ay8910', options: {ym2151ModuleFactory: wasmFactory}}]});
// @ts-expect-error Game Boy duty is one of the four hardware ratios.
new GameboySynth({transport: new GameboyWorkletTransport(gb)}).pulse.setDuty(0, 0.3);
