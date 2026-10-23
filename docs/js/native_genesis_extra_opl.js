import {createOplRegisterClient} from './playground_opl.js?v=native-extra-opl-1';
import {OplVoiceInspector} from './playground_opl_inspector.js?v=native-extra-opl-1';
import {keyboardChannels} from './playground_keyboard_channels.js?v=native-extra-opl-1';
import {CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {nativeInteger as integer} from './native_genesis_voice_endpoint.js?v=native-msx-1';
import {createNativeExtraRegisterVoice} from './native_genesis_extra_register_voice.js?v=native-extra-opl-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=native-extra-opl-1';

export const EXTRA_OPL_CHIPS=Object.freeze(['ym3526','ym3812','y8950']);
export const extraOplClockHeldError=kind=>`Release the manually held additional ${kind.toUpperCase()} voices before changing the clock`;
const DRUM_PHYSICAL=[6,7,8,8,7];
const physical=channel=>channel>=18?DRUM_PHYSICAL[channel-18]:channel;
const identity=value=>{if(typeof value!=='string'||!value.length||value.length>128)throw new TypeError('Audition identity must contain 1..128 characters');return `voice-editor:${value}`;};

/** Additional instances expose percussion previews without changing the
 * primary OPL / Browser inspector's existing melodic channel contract. */
class AdditionalOplInspector extends OplVoiceInspector{
  voice(input){const channel=typeof input==='string'&&/^rhythm:[0-4]$/.test(input)?18+Number(input.slice(7)):typeof input==='string'&&/^[0-8]$/.test(input)?Number(input):input;if(!Number.isInteger(channel)||channel<0||channel>22||channel>=9&&channel<18)throw new RangeError('OPL voice must be 0..8 or rhythm:0..4');return channel;}
  invoke(method,args=[]){
    if(method==='auditionAllOff'){for(const [channel,id]of [...this.auditions])this.invoke('auditionOff',[channel,id]);return true;}
    if(method==='auditionOff'){const channel=this.voice(args[0]),id=args[1],owner=identity(id);if(this.auditions.get(channel)!==id)return false;try{this.dispatch({method:channel>=18?'forceRhythmOff':'forceKeyOff',args:[channel>=18?channel-18:channel]},owner);}finally{this.auditions.delete(channel);this.endAudition(physical(channel),owner);}return true;}
    if(method==='auditionOn'){
      const channel=this.voice(args[0]),midi=args[1],id=args[2],owner=identity(id);integer(midi,127,'MIDI note');const prepared=[];
      if(channel>=18){if(!(this.registers[0xbd]&32))throw new Error('Enable OPL rhythm mode before auditioning a drum');}
      else this.stage((api,commands)=>{api.keyOff(channel);commands.length=0;api.setNote(channel,midi);const count=commands.length;api.keyOn(channel);commands.length=count;prepared.push(...commands);commands.length=0;});
      for(const [old,oldId]of [...this.auditions])if(physical(old)===physical(channel))this.invoke('auditionOff',[old,oldId]);
      this.auditions.set(channel,id);this.beginAudition(physical(channel),owner);
      this.dispatch({method:'forceKeyOff',args:[physical(channel)]},owner);
      for(let drum=0;drum<5;drum++)if(DRUM_PHYSICAL[drum]===physical(channel))this.dispatch({method:'forceRhythmOff',args:[drum]},owner);
      for(const command of prepared)this.dispatch(command,owner);
      this.dispatch({method:channel>=18?'auditionRhythmOn':'auditionKeyOn',args:[channel>=18?channel-18:channel]},owner);return true;
    }
    return super.invoke(method,args);
  }
  read(){return {...super.read(),keyboardChannels:keyboardChannels(this.kind,{registers:this.registers,rhythmVoices:true})};}
}

export function createNativeGenesisExtraOplEndpoint(synth,{kind='ym3812'}={}){
  if(!EXTRA_OPL_CHIPS.includes(kind))throw new RangeError('Additional Native OPL requires YM3526, YM3812 or Y8950');
  return createNativeExtraRegisterVoice(synth,{kind,label:kind.toUpperCase(),clock:CHIP_CLOCKS[kind],registerCount:256,voiceCount:23,melodicChannels:9,rhythmBase:18,layoutRegister:0xbd,physical,
    createClient:(send,options)=>createOplRegisterClient(send,{...options,chip:kind}),createInspector:options=>new AdditionalOplInspector({...options,chip:kind}),
    validate(data){if(data.chip!==kind||data.channels!==9||typeof data.irq!=='boolean'||data.held?.some(channel=>channel>=9&&channel<18))throw new Error(`Native additional ${kind.toUpperCase()} returned an invalid voice snapshot`);integer(data.status,255,'OPL status');},
    track(registers,owners,{register:r,value:v,group,intentMask=0}){
      if(r>=0xb0&&r<=0xb8){if(v&32)owners.set(r-0xb0,group);else owners.delete(r-0xb0);}
      if(r===0xbd)for(let drum=0;drum<5;drum++){const bit=16>>drum;if(v&32&&v&bit){if(intentMask&bit||!(registers[r]&bit))owners.set(18+drum,group);}else owners.delete(18+drum);}
      if(r===4&&!(v&128))owners.set('timer-loads',{value:v&3});
      if(r===8||r===4&&!(v&128)){const mode=r===8?v:registers[8];if(mode&128&&((owners.get('timer-loads')?.value??0)&1))owners.set('csm',group);else if(owners.get('csm')===group)owners.delete('csm');}
      if(kind==='y8950'&&r===7){if(v&128&&!(v&65))owners.set('adpcm',group);else if(v&1&&owners.get('adpcm')===group)owners.delete('adpcm');}
    },
    cancelAuthor(state,owners,group){for(const [channel,owner]of owners)if(owner===group){if(channel==='csm'){const loads=owners.get('timer-loads')?.value??0;state.registers[8]&=127;state.registers[4]=(state.registers[4]&~131)|(loads&2);owners.set('timer-loads',{value:loads&2});}else if(channel==='adpcm')state.registers[7]=1;else if(channel>=18)state.registers[0xbd]&=~(16>>(channel-18));else state.registers[0xb0+channel]&=223;owners.delete(channel);}},
    editChannel(method,args,command,registers){if(!(registers[0xbd]&32)||command.method!=='writeRegister')return;const [r]=command.args;if(!((r>=0x20&&r<=0x35)||(r>=0x40&&r<=0x55)||(r>=0x60&&r<=0x75)||(r>=0x80&&r<=0x95)||(r>=0xe0&&r<=0xf5)))return;return ({16:18,19:18,17:22,20:19,18:20,21:21})[r&31];},
  });
}
export function createNativeGenesisExtraOpl(synth,{kind='ym3812',...options}={}){return createNativeGenesisExtraChip(synth,{...options,kind,label:kind.toUpperCase(),clock:CHIP_CLOCKS[kind],layout:{rhythmVoices:true},createEndpoint:value=>createNativeGenesisExtraOplEndpoint(value,{kind})});}
