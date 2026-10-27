import {createSoundChip, encodeWav, SoundChipMixer, SOUNDCHIP_MIXER_PRESETS} from 'tetorica-fm2612';
import {SOUNDCHIP_MIXER_PRESETS as mixerPresetsSubpath} from 'tetorica-fm2612/soundchip_mixer_presets.js';
import {SOUNDCHIP_MIXER_PRESETS as mixerPresetsExtensionless} from 'tetorica-fm2612/soundchip_mixer_presets';
import type {SoundChipMixerOptions} from 'tetorica-fm2612/soundchip_mixer.js';
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
import {OPLSynth, OPLDirectTransport, OPL_PRESETS} from 'tetorica-fm2612/opl_synth.js';
import {YM3812Synth, YM3812DirectTransport} from 'tetorica-fm2612/ym3812synth.js';
import {OPLAudifyTransport} from 'tetorica-fm2612/node/transports';
import {YM2413Synth,YM2413DirectTransport,YM2413_INSTRUMENTS,YM2413_USER_PRESETS} from 'tetorica-fm2612/ym2413synth.js';
import {AY8910Synth,AY8910DirectTransport} from 'tetorica-fm2612/ay8910synth.js';
import {WonderSwan} from 'tetorica-fm2612/wonderswan.js';
import {WonderSwanSynth,WonderSwanDirectTransport} from 'tetorica-fm2612/wonderswansynth.js';
const calibratedOptions: SoundChipMixerOptions = mixerPresetsSubpath.calibrated;
const calibratedMixer = new SoundChipMixer(SOUNDCHIP_MIXER_PRESETS.calibrated);
new SoundChipMixer(calibratedOptions);
new SoundChipMixer(mixerPresetsExtensionless.calibrated);
calibratedOptions.factoryDefaults?.kinds[0]?.volume?.toFixed(6);
calibratedOptions.factoryEngines?.engines[0]?.engine.toUpperCase();
calibratedMixer.getKindDefault('ym2612', 'nuked').volume.toFixed(6);
// @ts-expect-error Calibration is an explicitly named optional preset.
SOUNDCHIP_MIXER_PRESETS.automatic;
// @ts-expect-error The exported preset binding is readonly.
SOUNDCHIP_MIXER_PRESETS.calibrated = {};
const ayChip=await createSoundChip('ay8910');
const ay=new AY8910Synth({transport:new AY8910DirectTransport(ayChip)});
ay.initialize();ay.tone(0,{note:'A4',volume:9});ay.setMixer(0,{noise:true});
ay.setEnvelope({period:2000,shape:10});ay.setVolume(1,12,true);ay.setNoisePeriod(12);
const ayPeriod:number=ay.setFrequency(2,440);ay.noteOn(2,'C4');ay.noteOff(2);
ay.adoptRegisterSnapshot(ay.getRegisterSnapshot());void ayPeriod;
// @ts-expect-error AY uses tone/noise booleans, not an FM instrument number
ay.setVoice(0,{instrument:1});
// @ts-expect-error AY noise has a period rather than a pitched note
ay.noise(0,{note:'C4'});

const wsChip=await createSoundChip('wonderswan',{clock:3200011,sampleRate:48000,id:'ws-direct'});
const wsRaw:WonderSwan=wsChip;
const wsIsAny:0 extends (1 & typeof wsChip)?true:false=false;
const wsId:string=wsChip.id;
const wsRegister:number=wsChip.readRegister(0x90),wsMemory:number=wsChip.readMemory(0x3fff);
wsChip.writeRegister(0x91,8);wsChip.writeMemory(0x3fff,0xab);
wsChip.loadMemory(new Uint8Array([0x10,0x32]),0);
wsChip.setChannelMuted(3,true);wsChip.reserveFrames(128);
const wsPcm:{left:Float32Array;right:Float32Array}=wsChip.generateStereo(128);
const wsView:{readonly left:Float32Array;readonly right:Float32Array}=wsChip.generateStereoView(128);
wsChip.generateStereoInto(new Float32Array(128),new Float32Array(128),128);
const wsRate:number=wsChip.sampleRate(),wsClock:number=wsChip.clock;
const ws=new WonderSwanSynth({transport:new WonderSwanDirectTransport(wsChip),clock:wsChip.clock});
ws.initialize();ws.setWaveform(0,new Uint8Array(32));ws.noteOn(0,'A4');ws.keyOff(0);
ws.setVoiceMode(true);ws.writeVoice(128);
const wsExplicit=await createSoundChip('wonderswan',{execution:'direct'});
wsExplicit.readMemory(0).toFixed();
void [wsRaw,wsIsAny,wsId,wsRegister,wsMemory,wsPcm,wsView,wsRate,wsClock];
// @ts-expect-error Direct WonderSwan IDs are readonly.
wsChip.id='other';
// @ts-expect-error The synchronous WonderSwan core has no output node.
wsChip.node.connect(new AudioContext().destination);
// @ts-expect-error A generic WonderSwan Worklet endpoint is not implemented.
await createSoundChip('wonderswan',{execution:'worklet'});
// @ts-expect-error Packed wave memory requires bytes, not ordinary number arrays.
wsChip.loadMemory([0,1,2]);
// @ts-expect-error Register reads retain their numeric type.
wsChip.readRegister(0x90).toUpperCase();
// @ts-expect-error RAM reads retain their numeric type too.
wsChip.readMemory(0).toUpperCase();
// @ts-expect-error PCM frame counts are numbers.
wsChip.generateStereo('128');
// @ts-expect-error Channel monitoring mutes are boolean.
wsChip.setChannelMuted(0,1);

const opllChip=await createSoundChip('ym2413');
const opll=new YM2413Synth({transport:new YM2413DirectTransport(opllChip)});
opll.initialize();opll.setUserPatch(YM2413_USER_PRESETS.sine);opll.setInstrument(0,0,4);opll.noteOn(0,'A4');
opll.setUserOperator(0,{tl:30,multi:2});opll.setUserOperator(1,{multi:1,ksl:1,ar:15});
opll.setRhythmLevels({bassDrum:4,snare:6});opll.allNotesOff();
const opllInstrumentName:string=YM2413_INSTRUMENTS[3];
// @ts-expect-error OPLL has no OPN detune parameter
opll.setUserOperator(0,{dt1:2});
// @ts-expect-error instrument uses a numeric ID
opll.setInstrument(0,'piano');

const oplChip = await createSoundChip('ym3812');
const opl = new OPLSynth({chip:'ym3812',transport:new OPLDirectTransport(oplChip)});
opl.initialize();opl.setPreset(0,OPL_PRESETS.sine);opl.noteOn(0,'A4');opl.noteOff(0);
opl.setOperator(0,1,{multi:1,egt:true,waveform:3,tl:4});
const oplPitch: {fnum:number;block:number} = opl.setFrequency(0,440);
opl.adoptRegisterSnapshot(opl.getRegisterSnapshot());
new YM3812Synth({transport:new YM3812DirectTransport(oplChip)});
new OPLAudifyTransport(oplChip);
// @ts-expect-error notes are names or MIDI integers
opl.noteOn(0,{});
// @ts-expect-error no OPN detune field on OPL operators
opl.setOperator(0,0,{dt1:2});
// @ts-expect-error AM depth uses the hardware toggle
opl.setLFO({amDepth:'deep'});
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

// Raw NES import preserves CPU memory and avoids adding Synth voice defaults.
nesSynth.resetRegisters();
await nesSynth.loadMemory(new Uint8Array([0x55, 0xaa]), 0xc000);
// @ts-expect-error Raw RAM uploads require bytes, not strings.
await nesSynth.loadMemory('DPCM', 0xc000);

// Playground accepts the source NES CPU clock independently of FDS expansion.
await createSoundChip('nes', {clock:1662607, fds:false});

// New standalone PC Engine / X68000 helpers retain useful consumer parameter types.
import {Huc6280Synth, Huc6280DirectTransport} from 'tetorica-fm2612/huc6280synth.js';
import type {Huc6280AudioEngine} from 'tetorica-fm2612/huc6280audioengine.js';
import {Oki6258Synth, encodeOki6258, summarizeOki6258} from 'tetorica-fm2612/okim6258synth.js';
declare const pceEngine: Huc6280AudioEngine;
const pceSynth = new Huc6280Synth({transport:new Huc6280DirectTransport(pceEngine),clock:3579545});
pceSynth.initialize(); pceSynth.setWaveform(0,new Uint8Array(32)); pceSynth.noteOn(0,'A4');
pceSynth.setNoise(5,{enabled:true,frequency:20});
// @ts-expect-error Wave samples must be numeric arrays, not a waveform name.
pceSynth.setWaveform(0,'triangle');
// @ts-expect-error Noise enable is a boolean hardware setting.
pceSynth.setNoise(5,{enabled:'on'});
const okiSynth = new Oki6258Synth({transport:{
  writeRegister(register,value) { register.toFixed(); value.toFixed(); },
  async loadMemory(encoded,metadata) { encoded.byteLength.toFixed(); metadata?.waveform[0]?.toFixed(); },
  play(options) { options.repeat.valueOf(); },stop(){},reset(){},
}});
okiSynth.setDivider(768); okiSynth.setPan(true,false); await okiSynth.loadMemory(new Uint8Array([0x10,0xf8]));
okiSynth.play({repeat:true}); okiSynth.stop();
const encodedOki = encodeOki6258({channels:[new Float32Array(32)],sampleRate:16000},15625);
summarizeOki6258(encodedOki.bytes).frames.toFixed();
// @ts-expect-error Divider rates are numeric.
okiSynth.setDivider('768');
// @ts-expect-error Playback repeat is boolean.
okiSynth.play({repeat:'yes'});
// @ts-expect-error Encoded ADPCM preview requires bytes.
summarizeOki6258('sample.wav');
// @ts-expect-error PCM input must include decoded Float32 channels.
encodeOki6258({channels:['sample.wav'],sampleRate:16000},15625);

// Applied Game Boy channels discriminate their pulse/wave/noise readback fields.
import {GameboyVoiceInspector} from 'tetorica-fm2612/playground_native_voice_inspector.js';
const gbVoiceSnapshot = new GameboyVoiceInspector(await createSoundChip('gameboy'),{clock:4194304}).read();
gbVoiceSnapshot.clock.toFixed(); gbVoiceSnapshot.masterVolume.left.toFixed();
for (const channel of gbVoiceSnapshot.channels) {
  channel.frequency.toFixed(); channel.pan.left.valueOf(); channel.lengthCount.toFixed();
  if (channel.type === 'wave') {
    const samples: number[] = channel.waveform;
    const level: 0|0.25|0.5|1 = channel.level;
    samples[0]?.toFixed(); channel.period.toFixed(); void level;
  } else {
    channel.volume.toFixed(); channel.envelope.period.toFixed();
    const direction: 'up'|'down' = channel.envelope.direction;
    if (channel.type === 'pulse') {
      channel.period.toFixed(); channel.duty.toFixed(); channel.sweep?.shift.toFixed();
    } else {
      channel.divisor.toFixed(); channel.shift.toFixed();
      const width: 7|15 = channel.width; void width;
    }
    void direction;
    // @ts-expect-error Pulse and noise channels have no Wave RAM snapshot.
    channel.waveform;
  }
}

// Binary WAV decoding returns useful PCM channels and sample-rate metadata.
import {decodeSampleWav} from 'tetorica-fm2612/playground_sample_edit.js';
import type {ChannelPCM} from 'tetorica-fm2612/wav.js';
declare const sampleWavBytes: Uint8Array;
const decodedSample: ChannelPCM = await decodeSampleWav(sampleWavBytes);
decodedSample.sampleRate.toFixed();
const decodedChannel: Float32Array = decodedSample.channels[0];
decodedChannel.subarray(0,32);
// @ts-expect-error This binary-only decoder never fetches a path or URL.
await decodeSampleWav('recording.wav');
