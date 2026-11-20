import {ChipClockResampler, CHIP_CLOCKS, validateChipClock} from './playground_chip_clock.js?v=pokey-prepare-1';
import {GameboyApu} from './gameboyapu.js?v=audio-stability-2';
import factory from '../generated/gameboy_apu_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js?v=gameboy-timed-1';
import {GameboyVoiceInspector} from './playground_native_voice_inspector.js?v=ps1-deferred-release-1';
import {receiveChipInspector} from './playground_chip_inspector_state.js?v=rf5c164-notes-1';
import {createGameboyTimedProcessor,gameboyTimedCommandCost} from './gameboy_timed_processor.js?v=gameboy-timed-1';
class Processor extends AudioWorkletProcessor {
  constructor(options) {
    super();this.chip=null;this.dead=false;this.clock=CHIP_CLOCKS.gameboy;this.initialized=false;
    this.instanceId=`gameboy:${Math.random()}`;this.pendingClocks=new Set();this.clockSequence=0;
    this.performance=createProcessorPerformance({chip:'gameboy',patternCommandCost:gameboyTimedCommandCost,
      onDiscard:(data,metadata)=>{if(data.method==='applyGameboyTimedOperation')this.timed?.discard(data,metadata);this.pendingClocks.delete(data.clockReservation);},
      prepare:(data,port)=>{
        if(data.method==='reset'){this.timed?.clear();data={...data,timedResetPrepared:true};}
        if(data.type==='chip-clock'||data.method==='clock'){
          let reservation;
          try{
            if(!this.chip)throw Error('Chip not ready');validateChipClock(data.clock??data.args[0]);
            if(this.inspector?.auditions.size)throw Error('Game Boy is held by a manual audition');
            reservation=++this.clockSequence;this.pendingClocks.add(reservation);
            if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,value:true});
            return {...data,id:undefined,performanceAcknowledged:true,clockReservation:reservation};
          }catch(error){this.pendingClocks.delete(reservation);if(data.id!==undefined)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,error:error.message});return null;}
        }
        if(data.id===undefined)return data;const {id,...command}=data;port.postMessage({id,value:true});return command;
      },apply:(...args)=>this.apply(...args)});
    this.renderSegment=this.renderSegment.bind(this);
    this.port.onmessage=({data})=>{
      if(data.primaryWorker){this.workerRemote?.close();this.workerRemote=null;if(data.port){if(this.dead){data.port.close();return;}const remote=this.workerRemote=data.port;remote.onmessage=event=>{if(this.workerRemote===remote)this.receive(event.data,remote);};remote.start();}return;}
      if(data.type==='detach-chip-port'){this.retireRemote();return;}
      if(data.port){this.retireRemote();if(this.dead){data.port.close();return;}const remote=this.remote=data.port;remote.onmessage=event=>{if(this.remote===remote)this.receive(event.data,remote);};remote.start();}
      else this.receive(data,this.port);
    };
    GameboyApu.create({moduleFactory:factory,moduleOptions:{wasmBinary:options.processorOptions.wasmBinary},sampleRate})
      .then(chip=>{
        if(this.dead){chip.dispose();return;}this.chip=chip;
        this.inspector=new GameboyVoiceInspector(chip,{clock:()=>this.clock,sampleRate,
          dispatch:(command,owner)=>this.performance.applyImmediate(command,this.port,{owner}),
          beginAudition:(channel,owner)=>this.performance.beginAudition(channel,owner),endAudition:(channel,owner)=>this.performance.endAudition(channel,owner)});
        const write=chip.writeRegister.bind(chip);
        chip.writeRegister=(register,value)=>{const result=write(register,value);this.timed?.observeWrite(register,value,this.writeMetadata,this.writePort??this.port);return result;};
        this.timed=createGameboyTimedProcessor({performance:this.performance,getState:()=>this.operationState(),
          getConfig:()=>({instanceId:this.instanceId,clock:this.clock}),dispatch:(command,port,_frame,metadata)=>this.performance.applyImmediate(command,port,metadata),
          retainState:state=>{this.inspector.voice.set(state.voice);this.initialized=state.initialized;},
          nowFrame:this.performance.nowFrame,sampleRate,
          validatePlan:()=>{if(this.pendingClocks.size)throw Error('Wait for the pending Game Boy clock change before scheduling');}});
        this.port.postMessage({ready:true});
      }).catch(error=>{this.dispose();this.port.postMessage({error:error.message});});
  }
  operationState(){return {clock:this.clock,initialized:this.initialized,registers:Array.from(this.inspector.registers),voice:Array.from(this.inspector.voice)};}
  retireRemote(){
    this.timed?.clear();this.remote?.close();this.remote=null;
    const session=this.performance.getStats().activeSession;
    if(session)this.receive({type:'performance-stop',session},this.port);else this.performance.clear();
  }
  dispose(){if(this.dead)return;this.timed?.clear();this.performance.clear();this.dead=true;this.chip?.dispose();this.chip=null;this.remote?.close();this.workerRemote?.close();}
  receive(data,port=this.port){
    if(Array.isArray(data)){for(const command of data)this.receive(command,port);return;}
    if(data?.method==='gameboyTimed'){
      if(!this.timed){port.postMessage({id:data.id,error:'Game Boy timed API is not ready'});return;}
      this.timed.receive(data,port);return;
    }
    if(data?.type==='chip-inspector'){
      receiveChipInspector(data,port,this.inspector?(action,method,args)=>{
        const value=action==='read'?this.inspector.read():this.inspector.invoke(method,args);
        if(action!=='read')this.initialized=!!(this.inspector.registers[22]&128);
        return value;
      }:null);return;
    }
    const stopping=data?.type==='performance-stop'&&Number.isSafeInteger(data.session)&&data.session>0&&data.session>=this.performance.getStats().latestSession;
    const replacing=data?.type==='performance-start'&&Number.isSafeInteger(data.session)&&data.session>this.performance.getStats().latestSession;
    if(stopping||replacing)this.timed?.clear();
    if(stopping)this.inspector?.invoke('auditionAllOff');
    if(this.performance.receive(data,port))return;
    this.apply(data,port);
  }
  writeRegister(register,value,metadata,port=this.port,configured){
    // Validate per-write metadata before touching native memory. It describes
    // only this applied register, not a stale copy of an entire client shadow.
    if(configured!==undefined){
      if(!configured||typeof configured!=='object'||Array.isArray(configured)||Reflect.ownKeys(configured).some(key=>!['voiceValue','initialized'].includes(key))||
        !Number.isInteger(configured.voiceValue)||configured.voiceValue<0||configured.voiceValue>255||typeof configured.initialized!=='boolean')throw TypeError('Invalid Game Boy write metadata');
      if([4,9,14,19].includes(register)&&(configured.voiceValue&128))throw TypeError('Game Boy configured trigger bit must be clear');
      if(configured.initialized&&!((register===22?value:this.inspector.registers[22])&128))throw TypeError('Game Boy initialized metadata requires APU power');
    }
    const previousMetadata=this.writeMetadata,previousPort=this.writePort;this.writeMetadata=metadata;this.writePort=port;
    try{this.chip.writeRegister(register,value);}finally{this.writeMetadata=previousMetadata;this.writePort=previousPort;}
    if(register===22&&!(value&128)){this.initialized=false;this.inspector.registers[22]=value;}
    if(configured){this.inspector.voice[register]=configured.voiceValue;this.initialized=configured.initialized;}
  }
  keyOff(channel,metadata,port){
    if(!Number.isInteger(channel)||channel<0||channel>3)throw RangeError('Game Boy channel must be 0..3');
    const register=[2,7,10,17][channel],value=channel===2?this.inspector.registers[10]&127:0;
    this.writeRegister(register,value,metadata,port);
  }
  apply(data,port=this.port,frame,metadata){
    if(data.method==='applyGameboyTimedOperation')return this.timed.apply(data,port,frame,metadata);
    try{
      if(data.method==='dispose'){this.dispose();return;}
      if(!this.chip)throw Error('Game Boy not ready');
      if(data.method==='clock'||data.type==='chip-clock'){
        if(this.inspector?.auditions.size)throw Error('Game Boy is held by a manual audition');
        const clock=validateChipClock(data.clock??data.args[0]);
        (this.clockResampler??=new ChipClockResampler()).setClock(clock,CHIP_CLOCKS.gameboy);this.clock=clock;
      }else if(data.type==='clear-scheduled-writes'){this.timed?.clear();this.performance.clear();}
      else if(data.method==='reset'){
        if(!data.timedResetPrepared)this.timed?.clear();this.chip.reset();this.initialized=false;this.clockResampler?.resetPhase();
      }else if(data.method==='writeRegister')this.writeRegister(data.args[0],data.args[1],metadata,port,data.gameboyState);
      else if(data.method==='adoptRegisterState'){
        if(!(this.inspector.registers[22]&128))throw Error('APU power must be ON before adopting register state');
        this.inspector.voice.set(this.inspector.registers);this.initialized=true;
      }else if(data.method==='keyOff')this.keyOff(data.args[0],metadata,port);
      else if(data.method==='allNotesOff'){for(let channel=0;channel<4;channel++)this.keyOff(channel,metadata,port);}
      else throw Error(`Unsupported Game Boy command: ${data.method??data.type}`);
      if(data.id!==undefined&&!data.performanceAcknowledged)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,value:true});
      return true;
    }catch(error){if(data.id!==undefined&&!data.performanceAcknowledged)port.postMessage({type:data.type==='chip-clock'?'chip-clock-result':undefined,id:data.id,error:error.message,name:error.name});return false;}
    finally{if(data.clockReservation!==undefined)this.pendingClocks.delete(data.clockReservation);}
  }
  process(_inputs,outputs){if(this.dead)return false;const [left,right]=outputs[0]??[];if(!left)return true;this.performance.render(left,right,this.renderSegment);return true;}
  renderSegment(left,right){
    if(this.chip&&this.clockResampler)this.clockResampler.render(this.chip,left,right);
    else if(this.chip){const pcm=this.chip.generateStereo(left.length);left.set(pcm.left);right?.set(pcm.right);}
    else{left.fill(0);right?.fill(0);}
  }
}
registerProcessor('tetorica-gameboy',Processor);
