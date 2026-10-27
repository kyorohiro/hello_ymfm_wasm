import {OPLSynth} from './opl_synth.js?v=audio-numeric-bindings-1';
import {attachY8950Adpcm} from './y8950_adpcm.js?v=y8950-adpcm-ui-1';
import {attachChipClock, CHIP_CLOCKS} from './playground_chip_clock.js?v=pokey-mode-1';

export const OPL_CHIPS = Object.freeze(['ym3526','ym3812','y8950','ymf262']);
/** A register-authoring client; Main and Worker use the same Synth and shadow.
 * Construction and adoption never replay registers into the audio processor.
 * @param {(method:string,args:unknown[],metadata?:{intentMask:number})=>unknown} send
 * @param {{chip?:import('./opl_synth.js?v=audio-numeric-bindings-1').OPLChip,clock?:number,close?:()=>void,
 * request?:(method:string,args:unknown[],scope?:unknown)=>unknown,owner?:()=>unknown,
 * adpcmContext?:import('./y8950_adpcm.js?v=y8950-adpcm-ui-1').Y8950AdpcmLifecycle}} [options] */
export function createOplRegisterClient(send, {chip = 'ym3812', clock = CHIP_CLOCKS[chip], close=()=>{}, request, owner=()=>undefined,adpcmContext={}} = {}) {
  let initialized = false, disposed = false, rhythmIntent;
  const owners=new Map();
  function track(register,value){
    const previous=synth.getRegisterSnapshot(),source=owner();
    const local=register&255,bank=register>>8;if(local>=0xb0&&local<=0xb8){const channel=bank*9+local-0xb0;if(value&32)owners.set(channel,source);else if(owners.get(channel)===source)owners.delete(channel);}
    if(register===0xbd)for(let drum=0;drum<5;drum++){const bit=16>>drum;if(value&bit){if(rhythmIntent&bit||!(previous[register]&bit))owners.set(18+drum,source);}else if(owners.get(18+drum)===source)owners.delete(18+drum);}
    // NEW=0 folds bank-one BD writes onto the real rhythm register. Retain
    // their authored address so cancellation cannot revive a folded drum.
    if(chip==='ymf262'&&register===0x1bd)for(let drum=0;drum<5;drum++){const key=`upper-drum:${drum}`,bit=16>>drum;if(value&bit){if(!(previous[register]&bit))owners.set(key,source);}else if(owners.get(key)===source)owners.delete(key);}
    if(chip==='y8950'&&register===7){if(value&128&&!(value&65))owners.set('adpcm',source);else if(value&1&&owners.get('adpcm')===source)owners.delete('adpcm');}
    if(register===4&&!(value&128))owners.set('timer-loads',{value:value&3});
    if(chip!=='ymf262'&&(register===8&&(chip!=='y8950'||((previous[8]^value)&0xc0))||register===4&&!(value&128))){previous[register]=value;if((owners.get('timer-loads')?.value??0)&1&&previous[8]&128)owners.set('csm',source);else if(owners.get('csm')===source)owners.delete('csm');}
  }
  const synth = new OPLSynth({chip, clock, transport:{
    writeRegister(register,value,bank=0) {if(disposed)throw new Error('OPL disposed');track(register|(bank<<8),value);send('writeRegister',[register,value,bank],register===0xbd&&rhythmIntent!==undefined?{intentMask:rhythmIntent}:undefined);},
    reset() {if(disposed)throw new Error('OPL disposed');synth._cancelAdpcmLoads?.();owners.clear();send('reset',[]);},
    dispose() {send('dispose',[]);close();},
  }});
  synth.dispose = () => {if(disposed)return;synth._cancelAdpcmLoads?.('Chip disposed');synth.transport.dispose();disposed=true;};
  const setRhythm=synth.setRhythm.bind(synth),allNotesOff=synth.allNotesOff.bind(synth);
  synth.setRhythm=settings=>{const previous=rhythmIntent;rhythmIntent=['bassDrum','snare','tom','cymbal','hiHat'].reduce((mask,key,index)=>mask|(Object.hasOwn(settings??{},key)?16>>index:0),0);try{return setRhythm(settings);}finally{rhythmIntent=previous;}};
  synth.allNotesOff=()=>{const previous=rhythmIntent;rhythmIntent=31;try{return allNotesOff();}finally{rhythmIntent=previous;}};
  const initialize = synth.initialize.bind(synth);
  synth.initialize = () => {const result = initialize();initialized=true;return result;};
  Object.defineProperties(synth, {
    _getState:{value:() => ({chip,clock:synth.clock,initialized,registers:Array.from(synth.getRegisterSnapshot())})},
    _adoptState:{value:state => {
      if (state?.registers) synth.adoptRegisterSnapshot(state.registers);
      if (state?.clock !== undefined) synth._adoptClock(state.clock);
      if (state?.initialized !== undefined) initialized = !!state.initialized;
    }},
    _applyAuthorEdit:{value:edit=>{if(edit.method==='clock'){synth._adoptClock(edit.args[0]);return;}synth._adoptState(stageOplAuthorEdit(synth._getState(),edit.method,edit.args,edit.effectiveFourOpMask));}},
    _forceKeyOff:{value:channel => {
      const registers=synth.getRegisterSnapshot(),address=(channel>=9?256:0)+0xb0+channel%9;
      registers[address]&=223;if(synth.isFourOp(channel))registers[address+3]&=223;synth.adoptRegisterSnapshot(registers);send('forceKeyOff',[channel]);
    }},
    _forceRhythmOff:{value:drum=>{const registers=synth.getRegisterSnapshot();registers[0xbd]&=~(16>>drum);synth.adoptRegisterSnapshot(registers);send('forceRhythmOff',[drum]);}},
    _cancelPerformanceOwner:{value:source=>{const registers=synth.getRegisterSnapshot();for(const [key,value]of owners)if(value===source){if(key==='csm'){const loads=owners.get('timer-loads')?.value??0;registers[8]&=127;registers[4]=(registers[4]&~131)|(loads&2);owners.set('timer-loads',{value:loads&2});}else if(key==='adpcm')registers[7]=1;else if(typeof key==='string'&&key.startsWith('upper-drum:'))registers[0x1bd]&=~(16>>Number(key.slice(11)));else if(key>=18)registers[0xbd]&=~(16>>(key-18));else registers[(key>=9?256:0)+0xb0+key%9]&=223;owners.delete(key);}synth.adoptRegisterSnapshot(registers);}},
    _stopVoices:{value:() => {
      synth._cancelAdpcmLoads?.('Run stopped');
      const registers = synth.getRegisterSnapshot();
      for (let channel=0;channel<synth.channels;channel++) registers[(channel>=9?256:0)+0xb0+channel%9]&=223;
      registers[0xbd]&=224;synth.adoptRegisterSnapshot(registers);
      return request?request('stopVoices',[]):synth._requestControl('stopVoices');
    }},
  });
  if(chip==='y8950'&&request)attachY8950Adpcm(synth,{...adpcmContext,loadMemory:(bytes,address,scope,preview)=>request('loadAdpcmMemory',[bytes,address,preview],scope),clearMemory:scope=>request('clearAdpcmMemory',[],scope)});
  return synth;
}

/** Merge an inspector edit into this author's current image, without sending
 * controls or replacing unrelated future writes with an applied snapshot. */
export function stageOplAuthorEdit(state,method,args,effectiveFourOpMask=state.registers[0x104]??0){
  if(!['setOperator','setPreset','setAlgo','setPan','setNote','setFrequency','setPitch','setFourOp','setRhythm','setLFO'].includes(method)||!Array.isArray(args))throw new TypeError('Invalid OPL authoring edit');
  const previous=state.registers[0x104],value=createOplRegisterClient(()=>{},{chip:state.chip,clock:state.clock});value._adoptClock=hz=>{value.clock=hz;};
  value._adoptState({...state,registers:state.registers.map((byte,index)=>index===0x104?effectiveFourOpMask:byte)});value[method](...args);const result=value._getState();
  if(state.chip==='ymf262'){result.registers[0x104]=previous;const enabled=method==='setFourOp'?args[1]:method==='setPreset'?args[1]?.fourOp:undefined;if(enabled!==undefined){const bit=[0,1,2,9,10,11].indexOf(args[0]);if(bit>=0)result.registers[0x104]=(previous&~(1<<bit))|(enabled?1<<bit:0);}}
  return result;
}

export function createOplClient(port,options={},lifecycle={}){
  const chip=options.chip??'ym3812',clock=options.clock??CHIP_CLOCKS[chip];
  let disposed=false,controlled;
  const checkCurrent=context=>{if(disposed||lifecycle.isStopped?.(context))throw new DOMException('Run stopped','AbortError');};
  const adpcmContext={captureContext:()=>lifecycle.captureContext?.(),checkCurrent,decodeAudio:lifecycle.decodeAudio,
    withContext:(context,callback)=>{checkCurrent(context);const previous=lifecycle.captureContext?.();lifecycle.restoreContext?.(context);try{return callback();}finally{lifecycle.restoreContext?.(previous);}}};
  const synth=createOplRegisterClient((method,args,metadata)=>port.postMessage({method,args,...(options.native?metadata:{})}),{chip,clock,close:()=>port.close(),owner:()=>{const context=lifecycle.captureContext?.();return context?.keyboard?'keyboard':context?.performanceOwner;},
    request:(method,args)=>controlled._requestControl(method,args),adpcmContext});
  controlled=attachChipClock(synth,port,clock);
  const dispose=synth.dispose.bind(synth);synth.dispose=()=>{disposed=true;dispose();};
  if(options.native&&lifecycle.captureContext){
    const setClock=synth.setClock.bind(synth);
    const resume=(context,callback)=>new Promise((resolve,reject)=>setTimeout(()=>{try{if(disposed||lifecycle.isStopped?.(context))throw new Error('Run stopped');lifecycle.restoreContext?.(context);resolve(callback());}catch(error){reject(error);}},0));
    synth.setClock=hz=>{const context=lifecycle.captureContext();return setClock(hz).then(value=>resume(context,()=>value),error=>resume(context,()=>{throw error;}));};
  }
  if(options.state)synth._adoptState(options.state);
  return controlled;
}
