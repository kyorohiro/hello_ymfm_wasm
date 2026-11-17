// Installed consumer coverage under NodeNext, Bundler and browser DOM types.
import {assembleScspDsp, disassembleScspDsp} from 'tetorica-fm2612/scsp_dsp_assembler.js';
import {assembleScspDsp as assembleBare, disassembleScspDsp as disassembleBare} from 'tetorica-fm2612/scsp_dsp_assembler';
import {ScspSynth} from 'tetorica-fm2612/scspsynth.js';
import {ScspSynth as BareScspSynth} from 'tetorica-fm2612/scspsynth';
import {createScspClient,validateScspDspCommand,scspCommandArgs} from 'tetorica-fm2612/playground_scsp.js';
import {createScspClient as createBareScspClient} from 'tetorica-fm2612/playground_scsp';
import {createPerformanceSender} from 'tetorica-fm2612/playground_performance_sender.js';
import type {ScspClient, ScspClientPort} from 'tetorica-fm2612/playground_scsp.js';
import type {Scsp} from 'tetorica-fm2612/scsp';
import type {
  ScspDspProgram, ScspDspCoefficients, ScspDspCoefficientPatch,
  ScspDspApplyOptions, ScspDspReturn, ScspMix, ScspState,
  ScspDspDelayPatch, ScspDspDelaySettings, ScspDspRam,
} from 'tetorica-fm2612/scspsynth';

type IsAny<T> = 0 extends (1 & T) ? true : false;
type Assert<T extends true> = T;
type WordsAreTyped = Assert<IsAny<ReturnType<typeof assembleScspDsp>> extends false ? true : false>;
type SourceIsTyped = Assert<IsAny<ReturnType<typeof disassembleScspDsp>> extends false ? true : false>;

const source = '003: EWT=1 COEF=1';
const words:Uint16Array = assembleScspDsp(source);
const sameAssembly:typeof assembleScspDsp = assembleBare;
const sameDisassembly:typeof disassembleScspDsp = disassembleBare;
const listing:string = disassembleScspDsp(words);
const full:string = disassembleBare(words, {includeTrailingZeros:true});
const readonlyWords:readonly number[] = Array.from(words);
const fromReadonly:string = disassembleScspDsp(readonlyWords, {includeTrailingZeros:false});
const fromNumbers:string = disassembleBare(Array.from(words));
void [sameAssembly, sameDisassembly, listing, full, fromReadonly, fromNumbers];

// @ts-expect-error Assembly source is text.
assembleScspDsp(new Uint8Array(512));
// @ts-expect-error Assembly does not accept an object through string coercion.
assembleBare({toString:() => source});
// @ts-expect-error Assembly is synchronous and returns an owned word image.
const pending:Promise<Uint16Array> = assembleScspDsp(source);
// @ts-expect-error Disassembly reads 16-bit words or numeric arrays.
disassembleScspDsp(new Uint8Array(1024));
// @ts-expect-error A raw byte buffer must first be decoded into logical words.
disassembleBare(new ArrayBuffer(1024));
// @ts-expect-error DataView is not the logical MPRO word representation.
disassembleScspDsp(new DataView(new ArrayBuffer(1024)));
// @ts-expect-error The trailing-zero option is boolean.
disassembleScspDsp(words, {includeTrailingZeros:'all'});
// @ts-expect-error Options retain their public spelling.
disassembleBare(words, {trailingZeros:true});
// @ts-expect-error Disassembly options are optional objects.
disassembleScspDsp(words, null);
// @ts-expect-error A listing is text.
const numericListing:number = disassembleBare(words);
void [pending, numericListing];

type ProgramIsTyped = Assert<IsAny<ReturnType<ScspSynth['getDspProgram']>> extends false ? true : false>;
type CodesAreTyped = Assert<IsAny<ReturnType<ScspSynth['getDspCoefficients']>['codes'][number]> extends false ? true : false>;
declare const core:Scsp;
const sameSynth:typeof ScspSynth = BareScspSynth;
const synth = new ScspSynth(core);
const patch:ScspDspCoefficientPatch = {1:3072, 2:1024};
const options:ScspDspApplyOptions = {coefficients:{0:0, 1:3840, 2:256}};
const setup:ScspDspProgram = synth.applyDspProgram(words, options);
const setupFromReadonly:ScspDspProgram = synth.applyDspProgram(readonlyWords);
const snapshot:ScspDspProgram = synth.getDspProgram();
const profile:'ram-free' | 'delay-ring' = snapshot.profile;
const configured:boolean = snapshot.configured;
const coefficients:ScspDspCoefficients = synth.setDspCoefficients(patch);
const currentCodes:ScspDspCoefficients = synth.getDspCoefficients();
const returned:ScspDspReturn = synth.setDspReturn({level:7});
const panned:ScspDspReturn = synth.setDspReturn({pan:31});
const indexedReturn:ScspDspReturn = synth.setDspReturn(1, {level:7, pan:15});
const optionalReturns:[ScspDspReturn,ScspDspReturn] | undefined = snapshot.returns;
if(snapshot.returns) {const right:ScspDspReturn=snapshot.returns[1];void right;}
const validatedLegacy:ScspDspReturn = validateScspDspCommand(synth,'setDspReturn',[{pan:31}]);
const validatedIndexed:ScspDspReturn = validateScspDspCommand(synth,'setDspReturn',[1,{pan:15}]);
const indexedArgs = scspCommandArgs(synth,'setDspReturn',[1,{level:7}]);
const sourceMix:ScspMix = {totalLevel:0, directLevel:7, pan:0};
synth.setMix(0, {directLevel:0, dspSend:7});
synth.setPreset(0, {dspSend:0});
synth.setMix(1, {dspInput:1, dspSend:7});
synth.setPreset(2, {dspInput:0});
const state:ScspState = synth.getState();
const optionalSetup:ScspDspProgram | undefined = state.dsp;
const optionalRing:ScspDspRam | undefined = state.dspRam;
const delayPatch:ScspDspDelayPatch = {enabled:true, timeMs:240, feedback:.35};
const delaySetup:ScspDspProgram = synth.setDspDelay(delayPatch);
if (delaySetup.profile === 'delay-ring') {
  const settings:ScspDspDelaySettings = delaySetup.delay;
  const ring:ScspDspRam = delaySetup.ram;
  void [settings, ring];
}
snapshot.words[0] = 0;
snapshot.coefficients.codes[0] = 1024;
synth.stopVoices();
synth.reset({clearRam:true});
void [sameSynth, setup, setupFromReadonly, profile, configured, coefficients, currentCodes,
  returned, panned, indexedReturn, optionalReturns, validatedLegacy, validatedIndexed, indexedArgs,
  sourceMix, optionalSetup, optionalRing, delaySetup];

// @ts-expect-error Executable images contain logical 16-bit words.
synth.applyDspProgram(new Uint8Array(1024));
// @ts-expect-error Assemble source before applying an instruction image.
synth.applyDspProgram(source);
// @ts-expect-error Program setup has a complete three-code coefficient table.
synth.applyDspProgram(words, {coefficients:{1:3840, 2:256}});
// @ts-expect-error Coefficient entries are numbers.
synth.setDspCoefficients({0:'2048'});
// @ts-expect-error The execution profile supports coefficient entries 0..2.
synth.setDspCoefficients({3:1024});
// @ts-expect-error There is no implicit cutoff conversion.
synth.setDspCoefficients({cutoff:440});
// @ts-expect-error Return patches use level and pan.
synth.setDspReturn({send:7});
// @ts-expect-error Only output indices 0 and 1 are exposed.
synth.setDspReturn(2, {level:7});
// @ts-expect-error An indexed return requires its patch.
synth.setDspReturn(1);
// @ts-expect-error ISEL is a numeric hardware code.
synth.setMix(0, {dspInput:true});
// @ts-expect-error Generic validation also retains indexed return argument types.
validateScspDspCommand(synth,'setDspReturn',[2,{level:7}]);
// @ts-expect-error Send uses a hardware integer code.
synth.setMix(0, {dspSend:true});
// @ts-expect-error DSP readback takes no arguments.
synth.getDspProgram(words);
// @ts-expect-error The owned local instrument applies DSP synchronously.
const asynchronousSetup:Promise<ScspDspProgram> = synth.applyDspProgram(words);
// @ts-expect-error Program words are numeric logical words.
const byteImage:Uint8Array = snapshot.words;
// @ts-expect-error The initial execution profile has a fixed name.
const delayProfile:'delay' = snapshot.profile;
// @ts-expect-error Delay input uses a boolean enable flag.
synth.setDspDelay({enabled:1});
// @ts-expect-error Delay settings require numeric feedback.
synth.setDspDelay({feedback:'0.5'});
// @ts-expect-error Delay time is given in milliseconds.
synth.setDspDelay({seconds:.24});
// @ts-expect-error Local Delay setup is synchronous.
const asynchronousDelay:Promise<ScspDspProgram> = synth.setDspDelay({timeMs:240});
// @ts-expect-error Ring metadata is available on the Delay profile.
const uncheckedRing:ScspDspRam = snapshot.ram;
void [asynchronousSetup, byteImage, delayProfile, asynchronousDelay, uncheckedRing];

type RemoteProgramIsTyped = Assert<IsAny<Awaited<ReturnType<ScspClient['getDspProgram']>>> extends false ? true : false>;
type RemoteCodesAreTyped = Assert<IsAny<Awaited<ReturnType<ScspClient['getDspCoefficients']>>['codes'][number]> extends false ? true : false>;
declare const port:MessagePort;
const sameClientFactory:typeof createScspClient = createBareScspClient;
const client:ScspClient = createScspClient(port, {sampleRate:48000});
const sender = createPerformanceSender();
const queuedClient:ScspClient = createScspClient(sender.port(port, 'independent'));
const facade:ScspClientPort = {
  postMessage:(message:unknown, transfer?:ArrayBuffer[]) => port.postMessage(message, transfer ?? []),
  onmessage:null,
  onmessageerror:null,
  close:() => port.close(),
};
const facadeClient:ScspClient = createBareScspClient(facade);
const lifecycleState = {stopped:false};
const scopedClient = createBareScspClient(port, {}, {
  captureContext:() => lifecycleState,
  restoreContext:context => {context.stopped = false;},
  isStopped:context => context.stopped,
});
const remoteSetup:Promise<ScspDspProgram> = client.applyDspProgram(words, options);
const remoteReadonly:Promise<ScspDspProgram> = scopedClient.applyDspProgram(readonlyWords);
const remoteSnapshot:Promise<ScspDspProgram> = client.getDspProgram();
const remoteCodes:Promise<ScspDspCoefficients> = client.getDspCoefficients();
const remoteChanged:Promise<ScspDspCoefficients> = client.setDspCoefficients({1:3072});
const remoteReturn:Promise<ScspDspReturn> = client.setDspReturn({pan:31});
const remoteIndexedReturn:Promise<ScspDspReturn> = client.setDspReturn(1,{level:7,pan:15});
const remoteDelay:Promise<ScspDspProgram> = client.setDspDelay(delayPatch);
const remoteState:Promise<ScspState> = client.getState();
const remoteSample = client.loadPCM(new Int16Array(64), {rootNote:'A4', loopStartSamples:0});
client.setMix(0, {directLevel:0, dspSend:7});
client.setPreset(0, {dspSend:0, envelope:{attackRate:31}});
client.setMix(1, {dspInput:1, dspSend:7});
client.setLfo(0, {pitchDepth:3});
client.setModulation(0, {depth:0});
const remoteFrequency:number = client.setNote(0, 'A4');
client.noteOn(0, 'A4');
client.keyOff(0);
client.reset();
client.dispose();
void [sameClientFactory, remoteSetup, remoteReadonly, remoteSnapshot, remoteCodes,
  remoteChanged, remoteReturn, remoteIndexedReturn, remoteDelay, remoteState, remoteSample, remoteFrequency, queuedClient, facadeClient];

// @ts-expect-error Remote results are acknowledged asynchronously.
const immediateRemote:ScspDspProgram = client.getDspProgram();
// @ts-expect-error Remote program application requires logical words.
client.applyDspProgram(source);
// @ts-expect-error Remote optional setup requires the complete three-code table.
client.applyDspProgram(words, {coefficients:{0:1024}});
// @ts-expect-error Remote coefficient keys are 0..2.
client.setDspCoefficients({3:1024});
// @ts-expect-error Remote return level is a hardware numeric code.
client.setDspReturn({level:true});
// @ts-expect-error Only the two exposed effect outputs are indexable.
client.setDspReturn(2,{pan:15});
// @ts-expect-error Remote indexed returns require a patch.
client.setDspReturn(0);
// @ts-expect-error The bus code has no string coercion.
client.setPreset(0,{dspInput:'1'});
// @ts-expect-error Remote Delay requires numeric milliseconds.
client.setDspDelay({timeMs:'240'});
// @ts-expect-error Delay routing uses the slot / return API.
client.setDspDelay({dspSend:7});
// @ts-expect-error Remote Delay setup waits for owner acknowledgement.
const immediateDelay:ScspDspProgram = client.setDspDelay({enabled:true});
// @ts-expect-error Typed PCM data carries its signed sample width.
client.loadPCM(new Uint8Array(64), {rootNote:'A4'});
// @ts-expect-error Existing slot controls retain their parameter types.
client.setEnvelope(0, {releaseRate:'slow'});
void [immediateRemote, immediateDelay];
