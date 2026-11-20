import {buildGameboyOperations,compileGameboyOperations,createGameboyOperationResetState} from 'tetorica-fm2612/gameboy_operations';
import {createGameboyClient,createPrimaryGameboyApi} from 'tetorica-fm2612/playground_gameboy.js';

const operations=buildGameboyOperations(b=>{
  b.pulse.setEnvelope(0,{volume:8,period:2});
  b.atSample(441).pulse.noteOn(0,'E4');
  b.atSeconds(.1).wave.setWaveform(new Uint8Array(32));
  b.wave.noteOn('E3');b.atSeconds(.25).keyOff(0);
});
const chip:'gameboy'=operations.chip;
// Reset is powered off: a raw trace can establish power without initializing
// or changing a live instrument. High-level operations require initialized state.
const raw=buildGameboyOperations(b=>{b.writeRegister(0x16,0x80);});
const writes=compileGameboyOperations(raw,createGameboyOperationResetState());
const offset:number=writes[0].offsetSeconds;
const register:number=writes[0].register;
const client=createGameboyClient({postMessage(){},close(){}});
client.initialize();
const recorded=client.build(b=>b.pulse.setDuty(0,.25));
const snapshot=await client.captureState();
const format:'tetorica-gameboy-state'=snapshot.format;
for(const initialState of ['current','client','reset',snapshot] as const)await client.compile(raw,{initialState});
await client.schedule(recorded,{name:'test',repeatSeconds:.2});await client.clearSchedule('test');
const primary=createPrimaryGameboyApi(client);primary.build(b=>b.keyOn(3));
// @ts-expect-error primary aliases do not own disposal
primary.dispose();
// @ts-expect-error lifecycle operations remain immediate
client.build(b=>b.initialize());
// @ts-expect-error callbacks run synchronously
client.build(async b=>b.keyOff(0));
// @ts-expect-error Noise has no note pitch
client.build(b=>b.noteOn(3,'C4'));
// @ts-expect-error Pulse channels are 0 and 1
client.build(b=>b.pulse.setDuty(2,.25));
// @ts-expect-error snapshots are immutable
snapshot.state.voice[0]=0;
// @ts-expect-error unsupported state cannot silently become current
await client.compile(operations,{initialState:'cached'});
client.dispose();void [chip,offset,register,format];
