import {buildWonderSwanOperations,compileWonderSwanOperations,createWonderSwanOperationResetState} from 'tetorica-fm2612/wonderswan_operations';
import {createWonderSwanClient,createPrimaryWonderSwanApi} from 'tetorica-fm2612/playground_wonderswan.js';
const operations=buildWonderSwanOperations(b=>{
  b.setNote(0,'C4').keyOn(0);
  b.atSample(441).setNoise({enabled:true,type:3,reset:true});
  b.atSeconds(.1).keyOff(0);
});
const chip:'wonderswan'=operations.chip;
const bytes=compileWonderSwanOperations(operations,createWonderSwanOperationResetState());
const register:number=bytes[0].register;
const mask:number|undefined=bytes[0].controlMask;
const client=createWonderSwanClient({postMessage(){},close(){}});
client.initialize();
client.build(b=>b.setPan(0,7,9));
const snapshot=await client.captureState();
const frame:number=snapshot.frame;
const format:'tetorica-wonderswan-state'=snapshot.format;
for(const initialState of ['current','client','reset',snapshot] as const)await client.compile(operations,{initialState});
await client.schedule(operations,{name:'test',repeatSeconds:.2});await client.clearSchedule('test');
const primary=createPrimaryWonderSwanApi(client);primary.build(b=>b.keyOn(3));
// @ts-expect-error primary aliases do not own disposal
primary.dispose();
// @ts-expect-error no Synth software note API on the hardware recorder
client.build(b=>b.noteOn(0,'C4'));
// @ts-expect-error four channels
client.build(b=>b.keyOn(4));
// @ts-expect-error callbacks must run synchronously
client.build(async b=>b.keyOff(0));
// @ts-expect-error no RAM transfer in register-operation programs
buildWonderSwanOperations(b=>b.setWaveform(0,new Uint8Array(32)));
// @ts-expect-error snapshot data is immutable
snapshot.state.registers[0]=0;
// @ts-expect-error unsupported baseline must not become current silently
await client.compile(operations,{initialState:'cached'});
client.dispose();void [register,mask,frame,format,chip];
