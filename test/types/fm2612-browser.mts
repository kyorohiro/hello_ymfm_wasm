import {createSoundChip, encodeWav, SoundChipMixer, SOUNDCHIP_MIXER_PRESETS} from 'tetorica-fm2612';
import {SOUNDCHIP_MIXER_PRESETS as browserMixerPresets} from 'tetorica-fm2612/soundchip_mixer_presets.js';
import {YM2612Synth, YM2612WorkletTransport} from 'tetorica-fm2612/ym2612synth';
import {MegaSynth} from 'tetorica-fm2612/megasynth';
import {Playground} from 'tetorica-fm2612/playground_runtime';
import {createDeadlineScheduler} from 'tetorica-fm2612/playground_clock';
import {WonderSwanSynth,WonderSwanDirectTransport} from 'tetorica-fm2612/wonderswansynth';
import {WonderSwanWorkletTransport} from 'tetorica-fm2612/chip_worklet_transport';
const wsChip=await createSoundChip('wonderswan',{sampleRate:48000,clock:3072000});
const wsId:string=wsChip.id;
wsChip.loadMemory(new Uint8Array([0x10,0x32]),0);
wsChip.writeRegister(0x91,8);wsChip.writeMemory(0x3fff,0xab);
const wsByte:number=wsChip.readMemory(0x3fff),wsRegister:number=wsChip.readRegister(0x91);
const wsPcm:{left:Float32Array;right:Float32Array}=wsChip.generateStereo(128);
new WonderSwanSynth({transport:new WonderSwanDirectTransport(wsChip)}).initialize();
void [wsId,wsByte,wsRegister,wsPcm];
const wsWorklet=await createSoundChip('wonderswan',{execution:'worklet',clock:3072000});
const wsWorkletTransport=new WonderSwanWorkletTransport(wsWorklet);
new WonderSwanSynth({transport:wsWorkletTransport,clock:wsWorklet.clock}).initialize();
await wsWorkletTransport.loadMemory(new Uint8Array([0x10,0x32]),0);
const wsAsyncByte:number=await wsWorkletTransport.readMemory(0);
const wsAsyncRegister:number=await wsWorkletTransport.readRegister(0x90);
const wsScheduled:number=await wsWorkletTransport.scheduleWrites([{time:1,register:0x89,value:128}]);
await wsWorkletTransport.setChannelMuted(3,false);
await wsWorkletTransport.clearScheduledWrites();await wsWorkletTransport.flush();
new WonderSwanWorkletTransport(wsWorklet.createTransportPort()).writeMemory(0,0x10);
void [wsAsyncByte,wsAsyncRegister,wsScheduled];
// @ts-expect-error Worklet readback returns a Promise.
wsWorkletTransport.readMemory(0).toFixed();
// @ts-expect-error Worklet transport parameters keep numeric types.
wsWorkletTransport.writeRegister('0x90',1);
// @ts-expect-error Worklet endpoints cannot render synchronously on Main.
wsWorklet.generateStereo(128);
// @ts-expect-error Direct chips do not expose an AudioWorklet output node.
wsChip.node.connect(new AudioContext().destination);
// @ts-expect-error Browser direct IDs are readonly too.
wsChip.id='other';
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
const balancedMixer = new SoundChipMixer(SOUNDCHIP_MIXER_PRESETS.calibrated);
new SoundChipMixer(browserMixerPresets.calibrated);
balancedMixer.getKindDefault('rf5c164').volume.toFixed(6);
// @ts-expect-error The preset namespace is readonly in browser declarations too.
browserMixerPresets.calibrated = {};
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
import {OPLSynth,OPL_PRESETS} from 'tetorica-fm2612/opl_synth.js';
import {YMF262WorkletTransport} from 'tetorica-fm2612/chip_worklet_transport.js';
import {YM2413Synth,YM2413_USER_PRESETS} from 'tetorica-fm2612/ym2413synth.js';
import {YM2413WorkletTransport} from 'tetorica-fm2612/chip_worklet_transport.js';
import {AY8910Synth,AY8910WorkletTransport} from 'tetorica-fm2612/ay8910synth.js';
const ayEndpoint=await createSoundChip('ay8910',{execution:'worklet'});
const ay=new AY8910Synth({transport:new AY8910WorkletTransport(ayEndpoint)});
ay.initialize();ay.tone(0,{note:'A4',volume:9});ay.keyOff(0);
// @ts-expect-error AY envelope shape is a number
ay.setEnvelope({shape:'saw'});
import {keyboardChannels} from 'tetorica-fm2612/playground_keyboard_channels.js';
keyboardChannels('ym2413',{rhythmEnabled:true})[0]?.id.toUpperCase();
// @ts-expect-error Applied OPLL rhythm layout is a boolean.
keyboardChannels('ym2413',{rhythmEnabled:'on'});
const opllEndpoint=await createSoundChip('ym2413',{execution:'worklet'});
const opll=new YM2413Synth({transport:new YM2413WorkletTransport(opllEndpoint)});
opll.initialize();opll.setUserPatch(YM2413_USER_PRESETS.sine);opll.setVoice(0,{instrument:0,attenuation:4});opll.noteOn(0,'A4');
// @ts-expect-error OPLL drum level uses numeric attenuation
opll.setRhythmLevel('snare','loud');
const oplEndpoint=await createSoundChip('ymf262',{execution:'worklet'});
const opl=new OPLSynth({chip:'ymf262',transport:new YMF262WorkletTransport(oplEndpoint)});
opl.initialize();opl.setPreset(0,OPL_PRESETS['four-op-bell']);opl.noteOn(0,'A4');
opl.setOperator(0,3,{waveform:7,tl:20});opl.setPan(0,true,false);opl.noteOff(0);
// @ts-expect-error waveform must be numeric
opl.setOperator(0,0,{waveform:'sine'});
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
import {Ps1Spu,PS1_SPU_SAMPLE_RATE,PS1_SPU_RAM_BYTES} from 'tetorica-fm2612/ps1_spu.js';
import {Ps1Spu as ExtensionlessPs1Spu} from 'tetorica-fm2612/ps1_spu';
import ps1Factory from 'tetorica-fm2612/generated/ps1_spu_wasm.js';
const ps1=await Ps1Spu.create({moduleFactory:ps1Factory});
const samePs1:ExtensionlessPs1Spu=ps1;
samePs1.sampleRate.toFixed();ps1.nativeFrames.toFixed();
PS1_SPU_SAMPLE_RATE.toFixed();PS1_SPU_RAM_BYTES.toFixed();
ps1.write(0x180,0x3fff);ps1.read(0x180).toFixed();
ps1.loadRam(new Uint8Array(16),0x2000);ps1.readRam(0x2000,16).byteLength.toFixed();
ps1.renderInto(new Float32Array(256),new Float32Array(256),128,64);
ps1.generateStereo(128).left.byteLength.toFixed();ps1.reset({clearRam:true});ps1.dispose();
// @ts-expect-error The standalone SPU requires its explicit generated factory.
await Ps1Spu.create();
// @ts-expect-error Register values are unsigned numeric words.
ps1.write(0x180,'0x3fff');
// @ts-expect-error Sample RAM uploads are bytes, not decoded float PCM.
ps1.loadRam(new Float32Array(16),0x2000);
// @ts-expect-error Stereo PCM output uses Float32 arrays.
ps1.renderInto(new Int16Array(128),new Int16Array(128));
// @ts-expect-error RAM reset is explicitly boolean.
ps1.reset({clearRam:1});
// @ts-expect-error Output sample rate is fixed and readonly.
ps1.sampleRate=48000;
import {SpcRuntimeSynth} from 'tetorica-fm2612/spc_audio.js';
import {SpcCore, SnesDspCore} from 'tetorica-fm2612/spc.js';
import {SnesSynth} from 'tetorica-fm2612/snessynth.js';
import {renderPs1Sample,renderPs1SampleComparison} from 'tetorica-fm2612/playground_sample_ps1.js';
import {renderPs1SamplePreview} from 'tetorica-fm2612/playground_sample_ps1_preview.js';
import {createSampleInstrument} from 'tetorica-fm2612/playground_sample_instrument.js';
const ps1Edited=renderPs1Sample({channels:[new Float32Array(112)],sampleRate:44100},{rootMidi:69,loopEnabled:true});
ps1Edited.adpcm.byteLength.toFixed();ps1Edited.alignment.applied.startFrame.toFixed();
renderPs1SampleComparison({channels:[new Float32Array(112)],sampleRate:44100}).decodedDisplay.byteLength.toFixed();
renderPs1SamplePreview({channels:[new Float32Array(112)],sampleRate:44100},{},{moduleFactory:async()=>({})});
createSampleInstrument({pg:{},audio:ps1Edited,chip:'ps1',target:'ps1',volume:192});
// @ts-expect-error Preview needs an actual factory instead of a textual identifier.
renderPs1SamplePreview(ps1Edited,{}, {moduleFactory:'ps1'});
// @ts-expect-error Only supported instrument targets may be selected.
createSampleInstrument({pg:{},audio:ps1Edited,target:'psf'});
import {encodePs1Adpcm,DEFAULT_PS1_ADPCM_MAX_BYTES} from 'tetorica-fm2612/ps1_adpcm_encoder.js';
const encodedPs1 = encodePs1Adpcm(new Float32Array(112), {loopStartSamples:0, maxBytes:64});
encodedPs1.adpcm.byteLength.toFixed(); encodedPs1.blockCount.toFixed();
encodedPs1.metrics.snrDb?.toFixed(); DEFAULT_PS1_ADPCM_MAX_BYTES.toFixed();
// @ts-expect-error Mono normalized Float32 PCM is required.
encodePs1Adpcm(new Int16Array(28));
// @ts-expect-error Tuning belongs to the instrument upload rather than this codec.
encodePs1Adpcm(new Float32Array(28), {rootNote:'C4'});
// @ts-expect-error The encoder does not resample.
encodePs1Adpcm(new Float32Array(28), {sampleRate:44100});
import {encodeAdpcmA} from 'tetorica-fm2612/adpcm_a_sample.js';
const encodedA=encodeAdpcmA(new Float32Array(512),{maxBytes:256});
encodedA.bytes.byteLength.toFixed();encodedA.paddingFrames.toFixed();encodedA.metrics.snrDb?.toFixed();
// @ts-expect-error Normalized mono PCM must be Float32.
encodeAdpcmA(new Int16Array(512));
// @ts-expect-error ADPCM-A has no hardware loop.
encodeAdpcmA(new Float32Array(512),{loop:true});
import {encodeBrr} from 'tetorica-fm2612/snes_brr_encoder.js';
const encodedBrr = encodeBrr(new Float32Array(32), {loopStartSamples:0, maxBytes:18});
encodedBrr.brr.byteLength.toFixed();
encodedBrr.metrics.snrDb?.toFixed();
encodedBrr.paddingFrames.toFixed();
// @ts-expect-error Normalized PCM must be Float32.
encodeBrr(new Int16Array(32));
// @ts-expect-error Use an explicit sample index for the loop.
encodeBrr(new Float32Array(32), {loop:true});
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
const nativeMasterSystem=new NativeRuntimeSynth({chip:'segapsg',stereoEnabled:false,ym2413:true,opllOptions:{wasmUrl:'ym2413.wasm'}});
nativeMasterSystem.opll?.setInstrument(8,3,4);
nativeMasterSystem.psg?.tone(0,{note:'A4',attenuation:8});
Playground({chip:'segapsg',stereoEnabled:false,ym2413:true,opllOptions:{workletUrl:'opll-worklet.js'}});
const nativeMsx=new NativeRuntimeSynth({chip:'msx-audio',ayOptions:{wasmUrl:'ay.wasm'},opllOptions:{workletUrl:'opll-worklet.js'},oplOptions:{wasmUrl:'y8950.wasm'}});
nativeMsx.ay?.noteOn(2,'A4');nativeMsx.opll?.noteOn(8,'A4');nativeMsx.opl?.noteOn(8,'A4');
Playground({chip:'msx',ayOptions:{workletUrl:'ay-worklet.js'}});
Playground({chip:'msx-audio',oplOptions:{workletUrl:'opl-worklet.js'}});
// @ts-expect-error Audio assets are URLs, not raw numeric IDs
Playground({chip:'msx',ayOptions:{wasmUrl:12}});
// @ts-expect-error The OPLL expansion is enabled with a boolean.
Playground({chip:'segapsg',ym2413:'on'});
const nativeDx7 = new NativeRuntimeSynth({chip:'dx7'});
await nativeDx7.dx7?.setPreset({name:'BELL',operators:{1:{coarse:2}}});
nativeDx7.dx7?.noteOn(60,100);nativeDx7.dx7?.noteOff(60);
// @ts-expect-error DX7 uses integer MIDI note numbers.
nativeDx7.dx7?.noteOn('C4');
// @ts-expect-error DX7 velocity is numeric MIDI.
nativeDx7.dx7?.noteOn(60,'loud');
import {createTetoricaSynth} from 'tetorica-fm2612/tetorica_synth.js';
createTetoricaSynth({chip:'segapsg',stereoEnabled:false,clock:3579545,fetch:globalThis.fetch});
createTetoricaSynth({chip:'x68000',extraOki:{wasmUrl:'oki.wasm'}});
createTetoricaSynth({chip:'dx7'});
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
for (const chip of ['nes','snes','x68000','segapsg','gameboy','dx7'] as const) Playground({chip});
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

import {Pokey, POKEY_CLOCK} from 'tetorica-fm2612/pokey.js';
import {PokeySynth, PokeyDirectTransport, PokeyWorkletTransport} from 'tetorica-fm2612/pokeysynth.js';
import {PokeyAudioEngine} from 'tetorica-fm2612/pokeyaudioengine.js';
const pokeyA=await createSoundChip('pokey',{id:'pokey:a',clock:POKEY_CLOCK,sampleRate:48000});
const pokeyB=await createSoundChip('pokey',{id:'pokey:b',execution:'direct'});
const pokeyRaw:Pokey=pokeyA;
const pokeyId:string=pokeyA.id;
const pokeyRead:number=pokeyA.readRegister(10);
const pokeyPcm:{left:Float32Array;right:Float32Array}=pokeyA.generateStereo(128);
pokeyA.generateStereoInto(new Float32Array(128),new Float32Array(128),128);
pokeyA.reserveFrames(128);pokeyB.setChannelMuted(3,true);
const pokeySynth=new PokeySynth({transport:new PokeyDirectTransport(pokeyA),clock:pokeyA.clock});
pokeySynth.initialize();
const pokeyHz:number=pokeySynth.setNote(0,'A4');pokeySynth.setVolume(0,6);pokeySynth.keyOn(0);
const pokeySpeaker=new PokeyAudioEngine(pokeyA,1);
pokeySpeaker.generateStereoView(128);
const pokeyWorklet=await createSoundChip('pokey',{execution:'worklet',id:'pokey:audio'});
const pokeyTransport=new PokeyWorkletTransport(pokeyWorklet);
new PokeySynth({transport:pokeyTransport,clock:pokeyWorklet.clock}).initialize();
const pokeyAsyncRead:number=await pokeyTransport.readRegister(10);
const pokeyQueued:number=await pokeyTransport.scheduleWrites([{time:1,register:1,value:0xaf}]);
await pokeyTransport.setChannelMuted(0,false);await pokeyTransport.clearScheduledWrites();await pokeyTransport.flush();
new PokeyWorkletTransport(pokeyWorklet.createTransportPort()).writeRegister(1,0xaf,0);
void [pokeyRaw,pokeyId,pokeyRead,pokeyPcm,pokeyHz,pokeyAsyncRead,pokeyQueued];
// @ts-expect-error Raw POKEY IDs are readonly.
pokeyA.id='changed';
// @ts-expect-error Direct hardware readback is a number, not a string.
pokeyA.readRegister(10).toUpperCase();
// @ts-expect-error Worklet register reads require awaiting the audio thread.
const pokeySyncRead:number=pokeyTransport.readRegister(10);
// @ts-expect-error A Worklet endpoint does not render synchronously on Main.
pokeyWorklet.generateStereo(128);
// @ts-expect-error A direct chip has no browser audio output node.
pokeyA.node.connect(new AudioContext().destination);
// @ts-expect-error Physical-channel monitoring uses a boolean mute.
pokeyA.setChannelMuted(0,1);
// @ts-expect-error Render lengths are numeric.
pokeyA.generateStereo('128');

import {Ps1Synth,preparePs1ADPCM,createPs1InitSample} from 'tetorica-fm2612/ps1synth.js';
import {Ps1Resampler} from 'tetorica-fm2612/ps1_resampler.js';
import {createPs1Client} from 'tetorica-fm2612/playground_ps1.js';
import {decodePs1Envelope,encodePs1Envelope,patchPs1Envelope,PS1_REVERB_PRESETS} from 'tetorica-fm2612/ps1_parameters.js';
import type {Ps1Envelope,Ps1Reverb} from 'tetorica-fm2612/ps1_parameters.js';
const ps1Envelope:Ps1Envelope=decodePs1Envelope(15,0);
ps1Envelope.attackRate.toFixed();ps1Envelope.attackExponential.valueOf();
encodePs1Envelope({attackRate:24,sustainDecrease:true,releaseRate:12}).adsr1.toFixed();
patchPs1Envelope(15,0x2000,{releaseExponential:true}).adsr2.toFixed();
const ps1Reverb:Ps1Reverb={preset:'room',volumeLeft:.25,volumeRight:.25};
PS1_REVERB_PRESETS[0]?.registers[0]?.toFixed();
// @ts-expect-error Envelope modes are booleans.
encodePs1Envelope({attackExponential:'linear'});
// @ts-expect-error Named envelope rates are numeric.
patchPs1Envelope(15,0,{releaseRate:'12'});
// @ts-expect-error Reverb presets and their registers are immutable.
PS1_REVERB_PRESETS[0]!.registers[0]=1;
// @ts-expect-error Unsupported core reverb presets are excluded from the API.
const ps1BadReverb:Ps1Reverb={preset:'delay',volumeLeft:1,volumeRight:1};
const ps1InstrumentCore=await Ps1Spu.create({moduleFactory:ps1Factory});
const ps1Instrument=new Ps1Synth({core:ps1InstrumentCore});
const {adpcm:ps1Packets,...ps1SampleOptions}=createPs1InitSample();
const ps1Sample=ps1Instrument.loadADPCM(ps1Packets,ps1SampleOptions);
ps1Sample.decodedFrames.toFixed();ps1Sample.repeatAddress.toFixed();
preparePs1ADPCM(ps1Packets,{rootNote:'A4',loopStartSamples:0}).rootFrequencyHz.toFixed();
ps1Instrument.setPreset(23,{sample:ps1Sample,volumeLeft:0.6,volumeRight:-0.6,adsr1:15,adsr2:8});
ps1Instrument.noteOn(23,'A4');ps1Instrument.stopVoices();
ps1Instrument.setEnvelope(23,{attackRate:25,sustainDecrease:true,releaseRate:13});
ps1Instrument.setReverb(ps1Reverb);ps1Instrument.setPreset(23,{reverb:true});
ps1Instrument.getState().channels[23]!.envelopeParameters.releaseRate.toFixed();
ps1Instrument.getState().reverb.volumeLeft.toFixed();
new Ps1Resampler(ps1Instrument,48000).render(new Float32Array(128),new Float32Array(128));
const ps1Client=createPs1Client(new MessageChannel().port1);
const ps1Uploaded=await ps1Client.loadADPCM(ps1Packets,ps1SampleOptions);
ps1Client.setPreset(23,{sample:ps1Uploaded});(await ps1Client.getPreset(23)).pitch.toFixed();
ps1Client.setEnvelope(23,{attackExponential:false,releaseRate:8});
ps1Client.setReverb({preset:'hall',volumeRight:.4});ps1Client.setChannel(23,{reverb:false});
(await ps1Client.getState()).reverb.volumeRight.toFixed();
ps1Client.reset({clearRam:false});ps1Client.dispose();
// @ts-expect-error Encoded SPU samples require explicit musical tuning.
ps1Instrument.loadADPCM(ps1Packets,{});
// @ts-expect-error Tuning declarations are mutually exclusive.
preparePs1ADPCM(ps1Packets,{rootNote:69,baseFrequencyHz:440});
// @ts-expect-error Voice volumes are normalized numbers, not strings.
ps1Instrument.setPreset(0,{volumeLeft:'0.5'});
// @ts-expect-error Destination PCM is Float32.
new Ps1Resampler(ps1Instrument,48000).render(new Int16Array(128),new Int16Array(128));
// @ts-expect-error Fixed-rate SPU has no programmable chip clock.
ps1Instrument.setClock(44100);
// @ts-expect-error Synth ADSR modes retain boolean types.
ps1Instrument.setEnvelope(0,{sustainDecrease:'down'});
// @ts-expect-error Per-voice reverb sends are boolean.
ps1Instrument.setPreset(0,{reverb:1});
// @ts-expect-error Shared returns are normalized numeric levels.
ps1Instrument.setReverb({volumeLeft:'0.5'});
// @ts-expect-error Only effective core presets are exposed.
ps1Client.setReverb({preset:'echo'});
// @ts-expect-error Client envelope edits preserve numeric rate types.
ps1Client.setEnvelope(0,{attackRate:'35'});
// @ts-expect-error Reverb has no arbitrary parameter-register interface.
ps1Client.setReverb({delay:100});
