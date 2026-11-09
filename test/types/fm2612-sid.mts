// Public installed SID subpaths. The generic package-root factory is separate.
import {createSoundChip} from 'tetorica-fm2612';
import {SidCore,SID_PAL_CLOCK,SID_NTSC_CLOCK,sidFrequency} from 'tetorica-fm2612/sid.js';
import {SidCore as BareSidCore} from 'tetorica-fm2612/sid';
import type {SidCoreOptions,SidCoreState} from 'tetorica-fm2612/sid.js';
import {Sid8580Core} from 'tetorica-fm2612/sid8580.js';
import {Sid8580Core as Bare8580Core} from 'tetorica-fm2612/sid8580';
import type {Sid8580Options} from 'tetorica-fm2612/sid8580.js';
import {SidSynth,SidDirectTransport,validateSidClock,SID_WAVEFORMS,sidWaveformBits,sidWaveformFromBits} from 'tetorica-fm2612/sidsynth.js';
import {SidSynth as BareSidSynth} from 'tetorica-fm2612/sidsynth';
import type {SidChannel,SidState,SidVoiceOptions,SidFilterOptions,SidModel,SidWaveform,SidFilterMode} from 'tetorica-fm2612/sidsynth.js';
import {sidWaveformBits as pureBits,sidWaveformFromBits as pureWaveform} from 'tetorica-fm2612/sid_waveforms.js';
import {createSidClient,createSidRegisterClient} from 'tetorica-fm2612/playground_sid.js';
import type {SidClient} from 'tetorica-fm2612/playground_sid.js';
import {SidVoiceInspector,receiveSidInspector} from 'tetorica-fm2612/playground_sid_inspector.js';
import {NativeRuntimeSynth} from 'tetorica-fm2612/native_runtime_synth.js';
import {createPlaygroundRuntime} from 'tetorica-fm2612/playground_runtime.js';

type IsAny<T> = 0 extends (1 & T) ? true : false;
type Assert<T extends true> = T;
type CoreIsTyped = Assert<IsAny<Awaited<ReturnType<typeof SidCore.create>>> extends false ? true : false>;
type CoreStateIsTyped = Assert<IsAny<ReturnType<SidCore['getState']>['cycles']> extends false ? true : false>;
type PreviewIsTyped = Assert<IsAny<Awaited<ReturnType<typeof Sid8580Core.create>>> extends false ? true : false>;
type WaveformIsTyped = Assert<IsAny<ReturnType<typeof pureWaveform>> extends false ? true : false>;
type RuntimeSidIsTyped = Assert<IsAny<NativeRuntimeSynth['sid']> extends false ? true : false>;
const coreConstructor:typeof SidCore = BareSidCore;
const previewConstructor:typeof Sid8580Core = Bare8580Core;
const synthConstructor:typeof SidSynth = BareSidSynth;
const primary6581 = new NativeRuntimeSynth({chip:'sid',model:'6581',clock:SID_PAL_CLOCK});
primary6581.sid?.setVoice(0,{waveform:'triangle+pulse'});
const selectedModel:'6581'|undefined = primary6581.options.model;
const mainSession = createPlaygroundRuntime({chip:'sid',model:'6581',execution:'main'});
const workerSession = createPlaygroundRuntime({chip:'sid',model:'6581',execution:'worker'});
const options:SidCoreOptions = {clockHz:SID_NTSC_CLOCK,sampleRate:48000,wasmBinary:new ArrayBuffer(8)};
const previewOptions:Sid8580Options = {clockHz:SID_PAL_CLOCK,sampleRate:48000,model:'8580',signal:new AbortController().signal};
const core = await SidCore.create(options);
const preview = await Sid8580Core.create(previewOptions);
const coreModel:'6581' = core.model, previewModel:'8580' = preview.model;
const pal:985248 = preview.clockHz;
const coreState:SidCoreState = core.getState();
const envelope:number = coreState.voices[0].envelope;
const unavailable:null = preview.getState().voices[0].envelope;
const cpuFree:true = preview.getState().cpuFree;
const hostDc:12 = preview.getState().hostDcHz;
const owned:Float32Array = core.render(512), rendered:Float32Array = preview.renderInto(new Float32Array(512));
core.writeRegister(24,15);preview.writeRegister(24,15);
const coreRead:number = core.readRegister(28), previewRead:number = preview.readRegister(27);
sidFrequency(440,SID_PAL_CLOCK).toFixed();
const direct = new SidSynth({core});
const other = new SidSynth({core:preview});
new SidSynth({transport:new SidDirectTransport(core),clock:SID_PAL_CLOCK});
new SidSynth({transport:new SidDirectTransport(preview),clock:SID_PAL_CLOCK,model:'8580'});
direct.initialize();other.initialize();
const voice:SidVoiceOptions = {waveform:'triangle+saw+pulse',pulseWidth:2048,attack:2,decay:6,sustain:12,release:5,sync:true};
const filter:SidFilterOptions = {mode:'lowpass+bandpass+highpass',cutoff:1000,resonance:7,routing:7,volume:8,voice3off:false};
direct.setVoice(0,voice);direct.setVoice(1,{waveform:'off'});other.setVoice(2,{waveform:'pulse+noise'});direct.setFilter(filter);
const flags:readonly ('triangle'|'saw'|'pulse'|'noise')[] = SID_WAVEFORMS;
const bits:number = sidWaveformBits('saw+triangle');
const combined:SidWaveform = sidWaveformFromBits(bits);
const pureCombined:SidWaveform = pureWaveform(pureBits('triangle+noise'));
const clock:number = direct.clock;
const chip:'sid' = direct.chip, model:SidModel = direct.model, channels:3 = direct.channels;
const channel:SidChannel = 2;
const hz:number = direct.setNote(channel,'A4');direct.setFrequency(1,hz*2);
direct.noteOn(0,60);direct.keyOff(0);direct.noteOff(1);direct.allNotesOff();
const snapshot:Uint8Array = direct.getRegisterSnapshot();
const state:SidState = direct._getState();
direct._adoptState({clock,initialized:true,registers:snapshot,model});
const read:number = direct.readRegister(27);
const ack:boolean = await direct.setClock(SID_PAL_CLOCK);
validateSidClock(clock).toFixed();

const port = new MessageChannel().port1;
const client:SidClient = createSidClient(port,{clock:SID_PAL_CLOCK,model:'8580',state});
const registerClient = createSidRegisterClient((method,args,channel) => {
  method.toUpperCase();void args;channel?.toFixed();
},{clock:SID_PAL_CLOCK,request:async (method,args) => {void args;return method === 'getState' ? state : 0;}});
const promiseRead:Promise<number> = client.readRegister(27);
const applied:SidState = await registerClient.getState();
const mode:SidFilterMode|'combined' = applied.filter.mode;
const waveform:'triangle'|'saw'|'pulse'|'noise'|'off'|'combined' = applied.channels[0].waveform;
const inspector = new SidVoiceInspector({synth:direct,sampleRate:48000});
const readOnly:true = inspector.read().readOnly;
receiveSidInspector({type:'chip-inspector',action:'read',id:1},port,inspector);
const ackClient:boolean = await client.setClock(SID_PAL_CLOCK);
client._setLifecycle({captureContext:() => 'run',isStopped:context => context !== 'run'});
client._forceKeyOff(1);await client._stopVoices();
direct.dispose();other.dispose();client.dispose();registerClient.dispose();core.dispose();preview.dispose();
void [coreConstructor,previewConstructor,synthConstructor,selectedModel,mainSession,workerSession,coreModel,previewModel,pal,envelope,unavailable,cpuFree,hostDc,owned,rendered,coreRead,previewRead,flags,combined,pureCombined,chip,channels,read,ack,ackClient,promiseRead,mode,waveform,readOnly];

// @ts-expect-error SID has dedicated subpaths, not a generic factory ID.
await createSoundChip('sid');
// @ts-expect-error The 6581 core has no model selector; use Sid8580Core.
await SidCore.create({model:'8580'});
// @ts-expect-error Preview requires the literal PAL clock.
await Sid8580Core.create({clockHz:SID_NTSC_CLOCK});
// @ts-expect-error Preview is the dedicated 8580 core.
await Sid8580Core.create({model:'6581'});
// @ts-expect-error Raw construction is internal to async create.
new SidCore();
// @ts-expect-error Raw construction is internal to async create.
new Sid8580Core();
// @ts-expect-error Model selection stays fixed after creation.
preview.model = '6581';
// @ts-expect-error Core clocks are creation-fixed.
core.clockHz = 1022727;
// @ts-expect-error Synth clock is creation-fixed.
direct.clock = 1022727;
// @ts-expect-error SID has only three physical voices.
direct.keyOn(3);
// @ts-expect-error Sine is not a SID waveform flag.
client.setVoice(0,{waveform:'sine'});
// @ts-expect-error Combined is an observation label; select the actual flags.
direct.setVoice(0,{waveform:'combined'});
// @ts-expect-error Canonical authoring combinations cannot repeat a flag.
other.setVoice(0,{waveform:'pulse+pulse'});
// @ts-expect-error Hardware flag names are a readonly array.
SID_WAVEFORMS.push('noise');
// @ts-expect-error Pure helper input is a string, not a mask.
pureBits(3);
// @ts-expect-error Filter cutoff is a numeric hardware code.
client.setFilter({cutoff:'1000'});
// @ts-expect-error Worklet reads must be awaited.
client.readRegister(27).toFixed();
// @ts-expect-error Direct reads are synchronous numbers.
const wrongRead:Promise<number> = preview.readRegister(27);
// @ts-expect-error Missing observations are null, never a fabricated number.
const fabricated:number = preview.getState().voices[0].envelope;
// @ts-expect-error PCM output uses float32 buffers.
core.renderInto(new Int16Array(512));
// @ts-expect-error Clock validation requires numeric Hz.
validateSidClock('985248');
// @ts-expect-error Unknown model name.
createSidClient(port,{model:'6580'});
// @ts-expect-error Runtime construction accepts the actual SID model union only.
new NativeRuntimeSynth({chip:'sid',model:'8581'});
// @ts-expect-error The primary runtime retains 6581; use an independent 8580 client/core.
new NativeRuntimeSynth({chip:'sid',model:'8580'});
// @ts-expect-error Playground construction accepts the actual SID model union only.
createPlaygroundRuntime({chip:'sid',model:'8581'});
// @ts-expect-error A runtime's applied SID client still has only three voices.
primary6581.sid?.keyOn(3);
// @ts-expect-error Invalid lifecycle result type.
createSidClient(port,{}, {isStopped:() => 'false'});
