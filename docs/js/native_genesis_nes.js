/** NES + FDS controls for the callback-owned Native core; no audio bridge. */
import {NesApuSynth} from './nesapusynth.js?v=audio-numeric-bindings-1';
import {NES_APU_CLOCK} from './nesapu.js';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {NesVoiceInspector} from './playground_native_voice_inspector.js?v=audio-numeric-bindings-1';
import {nativeVoiceChannel} from './playground_performance_processor.js?v=audio-numeric-bindings-1';

const integer=(value,max,name)=>{if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`Invalid NES ${name}`);return value;};
const abort=()=>new DOMException('Native NES operation was cancelled','AbortError');
const address=value=>{integer(value,0x408a,'address');if(!((value>=0x4000&&value<=0x4017)||value===0x4023||(value>=0x4040&&value<=0x407f)||(value>=0x4080&&value<=0x408a)))throw new RangeError('Unsupported NES/FDS address');return value;};
const array=(values,length,max,name)=>{
  if(!Array.isArray(values)||values.length!==length||values.some(value=>!Number.isInteger(value)||value<0||value>max))throw new Error(`Native NES returned invalid ${name}`);
  return values;
};

export function createNativeGenesisNes(synth){
  let clock=NES_APU_CLOCK,appliedClock=NES_APU_CLOCK,nextVoice=0,nextCommand=0,collecting=null,uiSerial=Promise.resolve();
  const held=new Map();
  const check=()=>{if(!synth.isReady())throw new Error('Native NES audio is not ready');if(synth.stopping||synth.closing)throw abort();};
  const capture=()=>{check();return {session:synth.session,generation:synth.generation};};
  const current=token=>{check();if(token.session!==synth.session||token.generation!==synth.generation)throw abort();};
  const timed=(message,timing={})=>({type:'nes',message,frame:timing.time===undefined?0:synth.frameAt(timing.time),
    ...(timing.performance===undefined?{}:{performance:timing.performance}),...(timing.owner===undefined?{}:{owner:timing.owner})});
  function normalize(method,args=[]){
    if(!Array.isArray(args))throw new TypeError('NES arguments must be an array');
    switch(method){
      case 'writeRegister':return {method:'write',address:address(args[0]),value:integer(args[1],255,'value')};
      case 'setChannelEnabled':if(typeof args[1]!=='boolean')throw new TypeError('NES enabled must be boolean');return {method:'enable',channel:integer(args[0],4,'channel'),enabled:args[1]};
      case 'loadMemory':{
        const bytes=args[0] instanceof ArrayBuffer?new Uint8Array(args[0]):args[0],offset=args[1]??0;
        if(!(bytes instanceof Uint8Array))throw new TypeError('NES memory must be Uint8Array');integer(offset,65536,'RAM address');
        if(offset+bytes.length>65536)throw new RangeError('NES memory exceeds 64 KiB');
        return {method:'load-memory',address:offset,data:Array.from(bytes)};
      }
      case 'clock':return {method:'clock',hz:validateChipClock(args[0])};
      case 'configureFds':return {method:'batch',channel:5,action:'edit',commands:[],fdsGain:integer(args[0],32,'FDS gain'),fdsMaster:integer(args[1],3,'FDS master')};
      case 'reset':return {method:'reset'};
      case 'stopVoices':return {method:'stop-voices'};
      default:throw new Error(`Unsupported Native NES operation: ${method}`);
    }
  }
  function send(method,args=[],timing={}){
    check();const message=normalize(method,args);
    synth.enqueue(timed(message,method==='loadMemory'?{...timing,time:undefined}:timing));
    return message;
  }
  function notify(){synth.emit({type:'native-state',name:'nes',state:client._getState()});}
  const transport={clock:NES_APU_CLOCK,fdsEnabled:true,
    writeRegister:(...args)=>send('writeRegister',args),setChannelEnabled:(...args)=>send('setChannelEnabled',args),reset:()=>send('reset'),
    configureFds:(...args)=>send('configureFds',args),
    async loadMemory(...args){const token=capture();send('loadMemory',args);await synth.flush();current(token);},
  };
  const client=new NesApuSynth({transport,initialize:false});
  Object.defineProperties(client,{id:{value:'nes',enumerable:true},clock:{configurable:true,enumerable:true,get:()=>clock},
    _adoptClock:{value:value=>{clock=validateChipClock(value);}},
    _stopVoices:{value:async()=>{if(synth.stopping)return synth.stopping;if(synth.closing||!synth.isReady())return;await dispatch({method:'stopVoices'});}},
  });
  client.setClock=async hz=>{const token=capture();send('clock',[hz]);await synth.flush();current(token);clock=hz;notify();};
  // A borrowed script handle never disposes its owning Native device.
  client.dispose=()=>{};
  const chip={clock:NES_APU_CLOCK,fdsEnabled:true,writeRegister(){},reset(){},loadMemory(){}};
  const inspector=new NesVoiceInspector(chip,{clock:()=>appliedClock,sampleRate:synth.clock.sampleRate||48000,
    dispatch:(command,owner)=>{if(!collecting)throw new Error('Native NES inspector command outside an edit');collecting.push({command,owner});},
    beginAudition:(channel,owner)=>{if(nextVoice>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native NES audition lease limit reached');held.set(channel,{owner,voice:++nextVoice});},
    endAudition(){},
  });
  function adopt(snapshot,{adoptClient=false}={}){
    if(!snapshot||!Number.isInteger(snapshot.clock)||snapshot.clock<100000||snapshot.clock>100000000)throw new Error('Native NES returned an invalid clock');
    array(snapshot.registers,0x90,255,'registers');array(snapshot.modulation,32,7,'FDS modulation');
    if(!Number.isInteger(snapshot.enabled)||snapshot.enabled<0||snapshot.enabled>31||!Number.isInteger(snapshot.fdsGain)||snapshot.fdsGain<0||snapshot.fdsGain>32||
      !Number.isInteger(snapshot.fdsMaster)||snapshot.fdsMaster<0||snapshot.fdsMaster>3||!Array.isArray(snapshot.memoryRanges)||snapshot.memoryRanges.length>65536||
      snapshot.memoryRanges.some(range=>!Number.isInteger(range?.address)||!Number.isInteger(range.end)||range.address<0||range.end<range.address||range.end>65536))throw new Error('Native NES returned an invalid snapshot');
    appliedClock=snapshot.clock;inspector.sampleRate=synth.clock.sampleRate;inspector.registers.set(snapshot.registers);inspector.enabled=snapshot.enabled;
    inspector.fdsGain=snapshot.fdsGain;inspector.fdsMaster=snapshot.fdsMaster;inspector.modTable.set(snapshot.modulation);inspector.memoryRanges=snapshot.memoryRanges.map(range=>({...range}));
    if(adoptClient){clock=snapshot.clock;const previous=client._getState();client._adoptState({...previous,clock,registers:snapshot.registers,enabled:snapshot.enabled,
      fdsActive:snapshot.fdsActive??!(snapshot.registers[0x83]&128),fdsGain:snapshot.fdsGain,fdsMaster:snapshot.fdsMaster});notify();}
    const result=inspector.read();
    if(typeof snapshot.dmcActive==='boolean'){result.dmc.active=snapshot.dmcActive;result.channels[4].active=snapshot.dmcActive;}
    if(typeof snapshot.fdsActive==='boolean'){result.fds.active=snapshot.fdsActive;result.channels[5].active=snapshot.fdsActive;}
    return result;
  }
  async function read({after}={}){const token=capture(),snapshot=await synth.nativeRequest('native_genesis_nes_status',after===undefined?{}:{after});current(token);return adopt(snapshot);}
  async function dispatch(message,timing={}){
    const token=capture();if(message.method==='dispose')return message.id===undefined?undefined:{id:message.id,value:true};
    const normalized=send(message.method,message.args??[],timing);await synth.flush();current(token);
    if(normalized.method==='clock'){clock=normalized.hz;client._adoptClock(clock);}
    if(normalized.method==='stop-voices'&&timing.performance===undefined){held.clear();inspector.resetAuditions();const state=client._getState();state.enabled=0;state.fdsActive=false;state.registers[0x15]=0;state.registers[0x83]|=128;state.registers[0x80]=128;client._adoptState(state);}
    return message.id===undefined?undefined:{id:message.id,value:true};
  }
  function targetFor(method,args){
    if(['auditionOn','auditionOff','setPulseVoice','setFrequency'].includes(method))return args[0];
    if(method==='setTriangleVoice')return 2;if(method==='setNoiseVoice')return 3;if(method==='setDmcVoice')return 4;
    if(method.startsWith('setFds'))return 5;
    if(method==='writeRegister')return nativeVoiceChannel('nes',{method,args});
    return null;
  }
  async function invoke(method,args=[]){
      const token=capture();await read();current(token);const commands=[],leases=new Map(held);collecting=commands;let result;
      try{result=inspector.invoke(method,args);}finally{collecting=null;}
      const selected=targetFor(method,args),groups=[],configured={gain:inspector.fdsGain,master:inspector.fdsMaster};
      for(const entry of commands){
        let channel=nativeVoiceChannel('nes',entry.command);if(channel==='all')channel=selected??[...held].find(([,lease])=>lease.owner===entry.owner)?.[0];
        if(!Number.isInteger(channel)){groups.push(normalize(entry.command.method,entry.command.args));continue;}
        const lease=held.get(channel)??leases.get(channel),manual=!!lease&&lease.owner===entry.owner;
        const action=method==='auditionOn'?'on':method==='auditionOff'||method==='auditionAllOff'?'off':'edit';
        const previous=groups.at(-1);
        if(previous&&previous.channel===channel&&previous.voice===(manual?lease.voice:undefined)&&previous.action===action)previous.commands.push(normalize(entry.command.method,entry.command.args));
        else groups.push({method:'batch',commands:[normalize(entry.command.method,entry.command.args)],
          channel,...(manual?{audition:true,voice:lease.voice}:{}),action,
          ...(channel===5?{fdsGain:inspector.fdsGain,fdsMaster:inspector.fdsMaster}:{})});
      }
      if(nextCommand+groups.length>Number.MAX_SAFE_INTEGER)throw new RangeError('Native NES command identity limit reached');
      for(const message of groups)message.id=++nextCommand;
      synth.enqueueMany(groups.map(message=>timed(message)));await synth.flush();current(token);
      if(method==='auditionOff'){const old=leases.get(args[0]);if(old&&old.owner===`voice-editor:${args[1]}`&&held.get(args[0])?.voice===old.voice)held.delete(args[0]);}
      if(method==='auditionAllOff')held.clear();
      // This one-off control barrier waits for these untimed UI writes only.
      // It does not poll the audio clock or wait for scheduled Worker notes.
      const snapshot=await read({after:groups.at(-1)?.id});
      if(commands.length){
        // UI edits patch only the channels/registers they touched. A read or
        // audition must not replace a Worker's projected future register bank.
        const state=client._getState();let enabledMask=0,enabledValue=0,fdsChanged=false;
        for(const {command}of commands){
          if(command.method==='writeRegister'){
            const [address,value]=command.args,index=address-0x4000;state.registers[index]=value;
            if(address===0x4015){enabledMask=31;enabledValue=value&31;}if(address>=0x4023)fdsChanged=true;
          }else if(command.method==='setChannelEnabled'){
            const [channel,enabled]=command.args,bit=1<<channel;enabledMask|=bit;enabledValue=enabled?enabledValue|bit:enabledValue&~bit;
          }
        }
        if(enabledMask){state.enabled=(state.enabled&~enabledMask)|(enabledValue&enabledMask);state.registers[0x15]=(state.registers[0x15]&~enabledMask)|(enabledValue&enabledMask);}
        if(fdsChanged){state.fdsGain=configured.gain;state.fdsMaster=configured.master;state.fdsActive=!(state.registers[0x83]&128);}
        client._adoptState(state);
      }
      return ['auditionOn','auditionOff','auditionAllOff'].includes(method)?result:snapshot;
  }
  return {client,dispatch,read,
    async invoke(method,args=[]){
      const token=capture(),copy=structuredClone(args);
      const result=uiSerial.then(()=>{current(token);return invoke(method,copy);});uiSerial=result.catch(()=>{});return result;
    },
    initialize(){client.reset();},
    mix(volume,pan){check();synth.enqueue(timed({method:'mix',volume,pan}));return synth.flush();},
    stopped(){held.clear();inspector.resetAuditions();},
    adoptStopped(snapshot){this.stopped();return adopt(snapshot,{adoptClient:true});},
    reset(){this.stopped();clock=appliedClock=NES_APU_CLOCK;inspector.reset();client._adoptState({clock,registers:Array(0x90).fill(0),enabled:0,fdsActive:false,fdsGain:32,fdsMaster:0,sample:null});},
  };
}
