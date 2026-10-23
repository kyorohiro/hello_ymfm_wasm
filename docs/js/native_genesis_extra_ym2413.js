import {createYm2413RegisterClient} from './playground_ym2413.js?v=native-extra-opll-ay-1';
import {Ym2413VoiceInspector} from './playground_ym2413_inspector.js?v=audio-numeric-bindings-1';
import {CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {nativeInteger as integer} from './native_genesis_voice_endpoint.js?v=native-msx-1';
import {createNativeExtraRegisterVoice} from './native_genesis_extra_register_voice.js?v=native-extra-opll-ay-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=native-extra-opll-ay-1';

export const EXTRA_YM2413_CLOCK_HELD_ERROR='Release the manually held additional YM2413 voices before changing the clock';
const physicalDrums=[6,7,8,8,7];
const logical=key=>typeof key==='string'&&key.startsWith('rhythm:')?9+Number(key.slice(7)):Number(key);
const physical=key=>logical(key)<9?logical(key):physicalDrums[logical(key)-9];
export function createNativeGenesisYm2413Endpoint(synth){
  return createNativeExtraRegisterVoice(synth,{kind:'ym2413',label:'YM2413',clock:CHIP_CLOCKS.ym2413,registerCount:64,voiceCount:14,
    createClient:createYm2413RegisterClient,createInspector:options=>new Ym2413VoiceInspector(options),logical,physical,
    voiceKey:channel=>channel<9?channel:`rhythm:${channel-9}`,
    validate(data){integer(data.status,255,'YM2413 status');if(typeof data.irq!=='boolean')throw new Error('Native additional YM2413 returned invalid IRQ');},
    editChannel(method,args,command,registers){if(command.method!=='writeRegister'||!['setRhythmLevel','setRhythmLevels'].includes(method))return;const [r,v]=command.args;if(r<54||r>56)return;if(method==='setRhythmLevel')return 9+['bassDrum','snare','tom','cymbal','hiHat'].indexOf(args[0]);if(r===54)return 9;const high=!!((registers[r]^v)&240);return r===55?(high?13:10):(high?11:12);},
    track(registers,owners,message){const {register:r,value:v,group,intentMask=0}=message;if(r>=32&&r<=40){if(v&16)owners.set(r-32,group);else owners.delete(r-32);}if(r===14)for(let drum=0;drum<5;drum++){const bit=16>>drum;if(v&32&&v&bit){if(intentMask&bit||!(registers[14]&bit))owners.set(9+drum,group);}else owners.delete(9+drum);}},
    cancelAuthor(state,owners,group){for(const [channel,owner]of owners)if(owner===group){if(channel<9)state.registers[32+channel]&=~16;else state.registers[14]&=~(16>>(channel-9));owners.delete(channel);}},
  });
}
export function createNativeGenesisExtraYm2413(synth,options={}){return createNativeGenesisExtraChip(synth,{...options,kind:'ym2413',label:'YM2413',clock:CHIP_CLOCKS.ym2413,createEndpoint:createNativeGenesisYm2413Endpoint});}
