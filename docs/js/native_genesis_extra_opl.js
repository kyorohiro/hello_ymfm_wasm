import {createOplRegisterClient,stageOplAuthorEdit} from './playground_opl.js?v=wonderswan-pcm-timeline-1';
import {OplVoiceInspector} from './playground_opl_inspector.js?v=wonderswan-pcm-timeline-1';
import {keyboardChannels} from './playground_keyboard_channels.js?v=wonderswan-pcm-timeline-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=wonderswan-pcm-timeline-1';
import {CHIP_CLOCKS} from './playground_chip_clock.js?v=wonderswan-pcm-timeline-1';
import {nativeInteger as integer,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=wonderswan-pcm-timeline-1';
import {createNativeExtraRegisterVoice} from './native_genesis_extra_register_voice.js?v=wonderswan-pcm-timeline-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=wonderswan-pcm-timeline-1';

export const EXTRA_OPL_CHIPS=Object.freeze(['ym3526','ym3812','y8950','ymf262']);
export const extraOplClockHeldError=kind=>`Release the manually held additional ${kind.toUpperCase()} voices before changing the clock`;
const DRUM_PHYSICAL=[6,7,8,8,7];
const PAIRS=[0,1,2,9,10,11];
const physical=channel=>channel==='adpcm'||channel===23?23:channel>=18?DRUM_PHYSICAL[channel-18]:channel;
const pairPrimary=(channel,mask)=>{const index=PAIRS.indexOf(channel-3);return index>=0&&(mask&(1<<index))?channel-3:channel;};
const identity=value=>{if(typeof value!=='string'||!value.length||value.length>128)throw new TypeError('Audition identity must contain 1..128 characters');return `voice-editor:${value}`;};

/** Additional instances expose percussion previews without changing the
 * primary OPL / Browser inspector's existing melodic channel contract. */
class AdditionalOplInspector extends OplVoiceInspector{
  voice(input){const count=this.kind==='ymf262'?18:9,channel=typeof input==='string'&&/^rhythm:[0-4]$/.test(input)?18+Number(input.slice(7)):typeof input==='string'&&/^\d+$/.test(input)?Number(input):input;if(!Number.isInteger(channel)||channel<0||channel>22||channel>=count&&channel<18)throw new RangeError(`OPL voice must be 0..${count-1} or rhythm:0..4`);return channel;}
  paired(channel){const index=PAIRS.indexOf(channel),mask=this.kind==='ymf262'?this.effectiveFourOpMask??0:0;return index>=0&&(mask&(1<<index))?channel+3:null;}
  physicals(channel){const first=physical(channel),pair=this.paired(first);return pair===null?[first]:[first,pair];}
  stage(callback,owner){if(this.kind!=='ymf262')return super.stage(callback,owner);const previous=this.registers[0x104];this.registers[0x104]=this.effectiveFourOpMask??0;try{return super.stage(callback,owner);}finally{this.registers[0x104]=previous;}}
  invoke(method,args=[]){
    if(this.kind==='y8950'&&((method==='auditionOn'||method==='auditionOff')&&args[0]==='adpcm'||method.startsWith('adpcm.')))return super.invoke(method,args);
    if(method==='auditionAllOff'){for(const [channel,id]of [...this.auditions])this.invoke('auditionOff',[channel,id]);return true;}
    if(method==='auditionOff'){const channel=this.voice(args[0]),id=args[1],owner=identity(id);if(this.auditions.get(channel)!==id)return false;try{this.dispatch({method:channel>=18?'forceRhythmOff':'forceKeyOff',args:[channel>=18?channel-18:channel]},owner);}finally{this.auditions.delete(channel);for(const target of this.physicals(channel))this.endAudition(target,owner);}return true;}
    if(method==='auditionOn'){
      const channel=this.voice(args[0]),midi=args[1],id=args[2],owner=identity(id);integer(midi,127,'MIDI note');const prepared=[];
      if(this.kind==='ymf262'&&!this.newMode&&channel>=9&&channel<18)throw new Error('Enable OPL3 NEW mode before auditioning an upper-bank voice');
      if(channel>=18){if(!(this.registers[0xbd]&32))throw new Error('Enable OPL rhythm mode before auditioning a drum');}
      else this.stage((api,commands)=>{api.keyOff(channel);commands.length=0;api.setNote(channel,midi);const count=commands.length;api.keyOn(channel);commands.length=count;prepared.push(...commands);commands.length=0;});
      for(const [old,oldId]of [...this.auditions])if(this.physicals(old).some(target=>this.physicals(channel).includes(target)))this.invoke('auditionOff',[old,oldId]);
      this.auditions.set(channel,id);for(const target of this.physicals(channel))this.beginAudition(target,owner);
      this.dispatch({method:'forceKeyOff',args:[physical(channel)]},owner);
      for(let drum=0;drum<5;drum++)if(DRUM_PHYSICAL[drum]===physical(channel))this.dispatch({method:'forceRhythmOff',args:[drum]},owner);
      for(const command of prepared)this.dispatch(command,owner);
      this.dispatch({method:channel>=18?'auditionRhythmOn':'auditionKeyOn',args:[channel>=18?channel-18:channel]},owner);return true;
    }
    if(this.kind==='ymf262'&&!this.newMode&&(method==='setFourOp'||method==='setPreset'&&args[1]?.fourOp!==undefined||typeof args[0]==='number'&&args[0]>=9&&args[0]<18))throw new Error('Enable OPL3 NEW mode before editing an upper-bank voice or four-operator mode');
    return super.invoke(method,args);
  }
  read(){const result=super.read();if(this.kind==='ymf262')for(const channel of result.channels)if(!this.newMode){channel.pan={left:true,right:true};for(const operator of channel.operators)operator.waveform&=3;if(channel.channel>=9)channel.available=false;}return {...result,...(this.kind==='ymf262'?{effectiveFourOpMask:this.effectiveFourOpMask??0,newMode:!!this.newMode}:{}),keyboardChannels:keyboardChannels(this.kind,{registers:this.registers,rhythmVoices:true,effectiveFourOpMask:this.effectiveFourOpMask,newMode:this.newMode})};}
}

export function createNativeGenesisExtraOplEndpoint(synth,{kind='ym3812'}={}){
  if(!EXTRA_OPL_CHIPS.includes(kind))throw new RangeError('Additional Native OPL requires YM3526, YM3812, Y8950 or YMF262');
  const opl3=kind==='ymf262',channels=opl3?18:9;let effectiveFourOpMask=0;
  const validateMode=data=>{integer(data.effectiveFourOpMask,63,'Effective OPL3 four-operator mask');if(typeof data.newMode!=='boolean')throw new Error('Native additional YMF262 returned an invalid NEW mode');};
  return createNativeExtraRegisterVoice(synth,{kind,label:kind.toUpperCase(),clock:CHIP_CLOCKS[kind],registerCount:opl3?512:256,voiceCount:kind==='y8950'?24:23,logical:channel=>channel==='adpcm'?23:Number(channel),voiceKey:channel=>kind==='y8950'&&channel===23?'adpcm':channel,melodicChannels:channels,rhythmBase:18,layoutRegister:0xbd,layoutRegisters:opl3?[0xbd,0x104,0x105,0x1bd]:[0xbd],physical,
    physicalMatches:(key,target)=>physical(key)===target||opl3&&pairPrimary(target,effectiveFourOpMask)===physical(key),
    readLayout:opl3?data=>{validateMode(data);nativeSnapshotArray(data.effectiveRegisters,512,255,'YMF262 effective registers');return {rhythmEnabled:!!(data.effectiveRegisters[0xbd]&32),effectiveFourOpMask:data.effectiveFourOpMask,newMode:data.newMode};}:undefined,
    createClient:(send,options)=>createOplRegisterClient(send,{...options,chip:kind}),createInspector:options=>new AdditionalOplInspector({...options,chip:kind}),
    validate(data){if(data.chip!==kind||data.channels!==channels||typeof data.irq!=='boolean'||!opl3&&data.held?.some(channel=>channel>=9&&channel<18))throw new Error(`Native additional ${kind.toUpperCase()} returned an invalid voice snapshot`);integer(data.status,255,'OPL status');if(opl3)validateMode(data);},
    adoptInspector(inspector,data){if(opl3){nativeSnapshotArray(data.effectiveRegisters,512,255,'YMF262 effective registers');effectiveFourOpMask=data.effectiveFourOpMask;inspector.registers.set(data.effectiveRegisters);inspector.effectiveFourOpMask=effectiveFourOpMask;inspector.newMode=data.newMode;}},
    readFields:opl3?data=>({authoredRegisters:Array.from(data.registers)}):undefined,
    track(registers,owners,{register:r,value:v,group,intentMask=0}){
      const local=r&255,bank=r>>8;if(local>=0xb0&&local<=0xb8){const channel=bank*9+local-0xb0;if(v&32)owners.set(channel,group);else owners.delete(channel);}
      if(r===0xbd)for(let drum=0;drum<5;drum++){const bit=16>>drum;if(v&32&&v&bit){if(intentMask&bit||!(registers[r]&bit))owners.set(18+drum,group);}else owners.delete(18+drum);}
      if(opl3&&r===0x1bd)for(let drum=0;drum<5;drum++){const key=`upper-drum:${drum}`,bit=16>>drum;if(v&bit){if(!(registers[r]&bit))owners.set(key,group);}else owners.delete(key);}
      if(r===4&&!(v&128))owners.set('timer-loads',{value:v&3});
      if(!opl3&&(r===8&&(kind!=='y8950'||((registers[8]^v)&0xc0)!==0)||r===4&&!(v&128))){const mode=r===8?v:registers[8];if(mode&128&&((owners.get('timer-loads')?.value??0)&1))owners.set('csm',group);else if(owners.get('csm')===group)owners.delete('csm');}
      if(kind==='y8950'&&r===7){if(v&128&&!(v&65))owners.set('adpcm',group);else if(v&1&&owners.get('adpcm')===group)owners.delete('adpcm');}
    },
    cancelAuthor(state,owners,group){for(const [channel,owner]of owners)if(owner===group){if(channel==='csm'){const loads=owners.get('timer-loads')?.value??0;state.registers[8]&=127;state.registers[4]=(state.registers[4]&~131)|(loads&2);owners.set('timer-loads',{value:loads&2});}else if(channel==='adpcm')state.registers[7]=1;else if(typeof channel==='string'&&channel.startsWith('upper-drum:'))state.registers[0x1bd]&=~(16>>Number(channel.slice(11)));else if(channel>=18)state.registers[0xbd]&=~(16>>(channel-18));else state.registers[(channel>=9?256:0)+0xb0+channel%9]&=223;owners.delete(channel);}},
    patchAuthor:opl3?(method,args,state)=>stageOplAuthorEdit(state,method,args,effectiveFourOpMask):undefined,
    describeAuthorEdit:opl3?(method,args)=>({method,args,effectiveFourOpMask}):undefined,
    editChannel(method,args,command,registers){if(command.method!=='writeRegister')return;const [r,,bank=0]=command.args;if(!bank&&registers[0xbd]&32&&((r>=0x20&&r<=0x35)||(r>=0x40&&r<=0x55)||(r>=0x60&&r<=0x75)||(r>=0x80&&r<=0x95)||(r>=0xe0&&r<=0xf5))){const drum=({16:18,19:18,17:22,20:19,18:20,21:21})[r&31];if(drum!==undefined)return drum;}if(opl3){const target=nativeVoiceChannel(kind,command);if(Number.isInteger(target))return pairPrimary(target,effectiveFourOpMask);}},
  });
}
export function createNativeGenesisExtraOpl(synth,{kind='ym3812',...options}={}){return createNativeGenesisExtraChip(synth,{...options,kind,label:kind.toUpperCase(),clock:CHIP_CLOCKS[kind],layout:{rhythmVoices:true},createEndpoint:value=>createNativeGenesisExtraOplEndpoint(value,{kind})});}
