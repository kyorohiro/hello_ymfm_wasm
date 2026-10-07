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
