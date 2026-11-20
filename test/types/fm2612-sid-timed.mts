// Public installed SID timed operations, reusable baselines and real physical APIs.
import {createSidClient} from 'tetorica-fm2612/playground_sid.js';
import type {SidClient} from 'tetorica-fm2612/playground_sid';
import type {SidOperationProgram,SidStateSnapshot,SidCompiledWrite,SidOperationRecorder,SidTimedApi} from 'tetorica-fm2612/sid_timed_client.js';
import {buildSidOperations,compileSidOperations} from 'tetorica-fm2612/sid_operations.js';
import {createSidTimedSnapshot} from 'tetorica-fm2612/sid_timed_state.js';
import {SidSynth} from 'tetorica-fm2612/sidsynth.js';

type IsAny<T> = 0 extends (1 & T) ? true : false;
type Assert<T extends true> = T;
type ClientIsTyped=Assert<IsAny<ReturnType<SidClient['build']>> extends false?true:false>;
type CaptureIsTyped=Assert<IsAny<Awaited<ReturnType<SidClient['captureState']>>['state']['registers']> extends false?true:false>;
type BuilderIsTyped=Assert<IsAny<Parameters<SidOperationRecorder['setVoice']>[1]> extends false?true:false>;
const sid:SidClient=createSidClient(new MessageChannel().port1,{model:'8580'});
sid.initialize();
const plan:SidOperationProgram=sid.build(b=>{
  b.atSample(0).setVoice(0,{waveform:'triangle+saw',attack:4,ring:true,sync:true}).noteOn(0,'E2');
  b.atSeconds(.1).setFilter({mode:'lowpass+bandpass',routing:1,cutoff:700}).keyOn(0);
  b.atSample(8820).keyOff(0).allNotesOff();
},{referenceSampleRate:44100});
const snapshot:SidStateSnapshot=await sid.captureState();
const a:SidCompiledWrite[]=await sid.compile(plan,{initialState:snapshot});
const b:SidCompiledWrite[]=await sid.compile(plan,{initialState:'client'});
const c:SidCompiledWrite[]=await sid.compile(plan,{initialState:'reset'});
const d:SidCompiledWrite[]=await sid.compile(plan);
const receipt=await sid.schedule(plan,{name:'motion',repeatSeconds:1});
const sampleRate:number=receipt.sampleRate;const cleared:boolean=await sid.clearSchedule('motion');
const timed:SidTimedApi=sid;
const raw=buildSidOperations(rec=>rec.writeRegister(4,0x21).atSample(4).writeRegister(4,0x21));
const direct=new SidSynth({transport:{writeRegister(){},reset(){}}});direct.initialize();
const local:SidCompiledWrite[]=compileSidOperations(raw,direct._getState(),{model:'6581',clock:985248});
const detached:SidStateSnapshot=createSidTimedSnapshot(direct._getState(),{instanceId:'local',frame:0,sampleRate:48000});
void [a,b,c,d,sampleRate,cleared,timed,local,detached];
// @ts-expect-error physical channels are only0..2
sid.build(rec=>rec.keyOn(3));
// @ts-expect-error patch uses actual SID flag names
sid.build(rec=>rec.setVoice(0,{waveform:'sine'}));
// @ts-expect-error build callback records synchronously
sid.build(async rec=>rec.keyOn(0));
// @ts-expect-error recorder excludes lifecycle operations
sid.build(rec=>rec.initialize());
// @ts-expect-error schedule must have a name
sid.schedule(plan,{repeatSeconds:1});
// @ts-expect-error unsupported baseline name
sid.compile(plan,{initialState:'latest'});
// @ts-expect-error snapshots and their data are immutable
snapshot.state.registers[4]=0;
// @ts-expect-error this operation program belongs to SID, not YM2149
const wrongChip:SidOperationProgram={...plan,chip:'ay8910'};
// @ts-expect-error typed compiler output always includes a register number
const wrongWrite:SidCompiledWrite={offsetSeconds:0,value:1,operationIndex:0,writeIndex:0};
// @ts-expect-error immediate CPU-free Synth does not acquire a scheduler
await direct.schedule(plan,{name:'wrong'});
// @ts-expect-error source-builder exported declarations retain typed patch arguments
buildSidOperations(rec=>rec.setVoice(0,{attack:'fast'}));
