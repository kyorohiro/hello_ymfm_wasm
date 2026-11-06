// Application-local prototype paths; SID is not a package-root SDK chip ID.
import {createSoundChip} from 'tetorica-fm2612';
import {SidCore,SID_PAL_CLOCK} from 'tetorica-fm2612/sid.js';
import {SidSynth,SidDirectTransport,validateSidClock} from 'tetorica-fm2612/sidsynth.js';
import type {SidChannel,SidState,SidVoiceOptions,SidFilterOptions} from 'tetorica-fm2612/sidsynth.js';
import {createSidClient,createSidRegisterClient} from 'tetorica-fm2612/playground_sid.js';
import type {SidClient} from 'tetorica-fm2612/playground_sid.js';
import {SidVoiceInspector,receiveSidInspector} from 'tetorica-fm2612/playground_sid_inspector.js';

const core = await SidCore.create({clockHz:SID_PAL_CLOCK,sampleRate:48000});
const direct = new SidSynth({core});
new SidSynth({transport:new SidDirectTransport(core),clock:SID_PAL_CLOCK});
direct.initialize();
const voice:SidVoiceOptions = {waveform:'pulse',pulseWidth:2048,attack:2,decay:6,sustain:12,release:5,sync:true};
const filter:SidFilterOptions = {mode:'lowpass',cutoff:1000,resonance:7,routing:7,volume:8,voice3off:false};
direct.setVoice(0,voice); direct.setFilter(filter);
const clock:number = direct.clock;
const chip:'sid' = direct.chip, model:'6581' = direct.model, channels:3 = direct.channels;
const channel:SidChannel = 2;
const hz:number = direct.setNote(channel,'A4'); direct.setFrequency(1,hz * 2);
direct.noteOn(0,60); direct.keyOff(0); direct.noteOff(1); direct.allNotesOff();
const snapshot:Uint8Array = direct.getRegisterSnapshot();
const state:SidState = direct._getState();
direct._adoptState({clock,initialized:true,registers:snapshot,model});
const read:number = direct.readRegister(27);
const ack:boolean = await direct.setClock(SID_PAL_CLOCK);
validateSidClock(clock).toFixed();

const port = new MessageChannel().port1;
const client:SidClient = createSidClient(port,{clock:SID_PAL_CLOCK,model:'6581',state});
const registerClient = createSidRegisterClient((method,args,channel) => {
  method.toUpperCase(); void args; channel?.toFixed();
},{clock:SID_PAL_CLOCK,request:async (method,args) => {void args;return method === 'getState' ? state : 0;}});
const promiseRead:Promise<number> = client.readRegister(27);
const applied:SidState = await registerClient.getState();
const mode:'off'|'lowpass'|'bandpass'|'highpass'|'notch'|'combined' = applied.filter.mode;
const waveform:'triangle'|'saw'|'pulse'|'noise'|'off'|'combined' = applied.channels[0].waveform;
const inspector = new SidVoiceInspector({synth:direct,sampleRate:48000});
const readOnly:true = inspector.read().readOnly;
receiveSidInspector({type:'chip-inspector',action:'read',id:1},port,inspector);
const ackClient:boolean = await client.setClock(SID_PAL_CLOCK);
client._setLifecycle({captureContext:() => 'run',isStopped:context => context !== 'run'});
client._forceKeyOff(1); await client._stopVoices();
direct.dispose(); client.dispose(); registerClient.dispose(); core.dispose();
void [chip,channels,read,ack,ackClient,promiseRead,mode,waveform,readOnly];

// @ts-expect-error SID stays outside the published SDK's raw factory catalog.
await createSoundChip('sid');
// @ts-expect-error A creation-fixed clock is readonly.
direct.clock = 1022727;
// @ts-expect-error SID has only three physical voices.
direct.keyOn(3);
// @ts-expect-error The four explicit waveforms omit sine.
client.setVoice(0,{waveform:'sine'});
// @ts-expect-error Filter cutoff is a numeric hardware code.
client.setFilter({cutoff:'1000'});
// @ts-expect-error Worklet reads must be awaited.
client.readRegister(27).toFixed();
// @ts-expect-error Clock validation requires numeric Hz.
validateSidClock('985248');
// @ts-expect-error The prototype rejects 8580.
createSidClient(port,{model:'8580'});
// @ts-expect-error Invalid lifecycle result type.
createSidClient(port,{}, {isStopped:() => 'false'});
