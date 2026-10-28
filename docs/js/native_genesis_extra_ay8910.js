import {createAy8910RegisterClient} from './playground_ay8910.js?v=pokey-prepare-1';
import {Ay8910VoiceInspector} from './playground_ay8910_inspector.js?v=ps1-mode-1';
import {CHIP_CLOCKS} from './playground_chip_clock.js?v=pokey-prepare-1';
import {nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=ps1-mode-1';
import {createNativeExtraRegisterVoice} from './native_genesis_extra_register_voice.js?v=ps1-mode-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=ps1-native-1';

export const EXTRA_AY8910_CLOCK_HELD_ERROR='Release the manually held additional AY8910 voices before changing the clock';
export function createNativeGenesisAy8910Endpoint(synth){
  return createNativeExtraRegisterVoice(synth,{kind:'ay8910',label:'AY8910',clock:CHIP_CLOCKS.ay8910,registerCount:16,voiceCount:3,
    createClient:createAy8910RegisterClient,
    createInspector(options){const inspector=new Ay8910VoiceInspector(options),invoke=inspector.invoke.bind(inspector),read=inspector.read.bind(inspector);inspector.invoke=(method,args)=>{const before=[...inspector.levels],result=invoke(method,args);for(let channel=0;channel<3;channel++)if(before[channel]!==inspector.levels[channel])inspector.dispatch({method:'setRetainedLevel',args:[channel,inspector.levels[channel]]},undefined,{preserveOwner:true});return result;};inspector.read=()=>{const result=read();if(inspector.nativeGates)for(let channel=0;channel<3;channel++)result.channels[channel].active&&=inspector.nativeGates[channel];return result;};return inspector;},
    validate(data){nativeSnapshotArray(data.levels,3,31,'AY8910 retained levels');if(!Array.isArray(data.gates)||data.gates.length!==3||data.gates.some(value=>typeof value!=='boolean'))throw new Error('Native additional AY8910 returned invalid gates');},
    adoptInspector(inspector,data){inspector.levels=[...data.levels];inspector.nativeGates=[...data.gates];},
    editChannel(method,args,command){if(command.method==='writeRegister'&&command.args[0]===7&&Number.isInteger(args[0]))return args[0];},
    track(registers,owners,{register:r,value:v,group}){if(r>=8&&r<=10){if(v&31)owners.set(r-8,group);else owners.delete(r-8);}},
    cancelAuthor(state,owners,group){for(const [channel,owner]of owners)if(owner===group){state.registers[8+channel]=0;owners.delete(channel);}},
  });
}
export function createNativeGenesisExtraAy8910(synth,options={}){return createNativeGenesisExtraChip(synth,{...options,kind:'ay8910',label:'AY-3-8910',clock:CHIP_CLOCKS.ay8910,createEndpoint:createNativeGenesisAy8910Endpoint});}
