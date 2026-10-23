import {OPLSynth} from './opl_synth.js?v=audio-numeric-bindings-1';
import {attachChipClock, CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-numeric-bindings-1';

export const OPL_CHIPS = Object.freeze(['ym3526','ym3812','y8950','ymf262']);
/** A register-authoring client; Main and Worker use the same Synth and shadow.
 * Construction and adoption never replay registers into the audio processor.
 * @param {MessagePort} port
 * @param {{chip?:'ym3526'|'ym3812'|'y8950'|'ymf262',clock?:number}} [options] */
export function createOplRegisterClient(send, {chip = 'ym3812', clock = CHIP_CLOCKS[chip], close=()=>{}, request, owner=()=>undefined} = {}) {
  let initialized = false, disposed = false, rhythmIntent;
  const owners=new Map();
  function track(register,value){
    const previous=synth.getRegisterSnapshot(),source=owner();
    if(register>=0xb0&&register<=0xb8){if(value&32)owners.set(register-0xb0,source);else if(owners.get(register-0xb0)===source)owners.delete(register-0xb0);}
    if(register===0xbd)for(let drum=0;drum<5;drum++){const bit=16>>drum;if(value&bit){if(rhythmIntent&bit||!(previous[register]&bit))owners.set(18+drum,source);}else if(owners.get(18+drum)===source)owners.delete(18+drum);}
    if(chip==='y8950'&&register===7){if(value&128&&!(value&65))owners.set('adpcm',source);else if(value&1&&owners.get('adpcm')===source)owners.delete('adpcm');}
    if(register===4&&!(value&128))owners.set('timer-loads',{value:value&3});
    if(register===8||register===4&&!(value&128)){previous[register]=value;if((owners.get('timer-loads')?.value??0)&1&&previous[8]&128)owners.set('csm',source);else if(owners.get('csm')===source)owners.delete('csm');}
  }
  const synth = new OPLSynth({chip, clock, transport:{
    writeRegister(register,value,bank=0) {if(disposed)throw new Error('OPL disposed');track(register|(bank<<8),value);send('writeRegister',[register,value,bank],register===0xbd&&rhythmIntent!==undefined?{intentMask:rhythmIntent}:undefined);},
    reset() {if(disposed)throw new Error('OPL disposed');owners.clear();send('reset',[]);},
    dispose() {send('dispose',[]);close();},
  }});
  synth.dispose = () => {if(disposed)return;synth.transport.dispose();disposed=true;};
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
    _forceKeyOff:{value:channel => {
      const registers=synth.getRegisterSnapshot(),address=(channel>=9?256:0)+0xb0+channel%9;
      registers[address]&=223;if(synth.isFourOp(channel))registers[address+3]&=223;synth.adoptRegisterSnapshot(registers);send('forceKeyOff',[channel]);
    }},
    _forceRhythmOff:{value:drum=>{const registers=synth.getRegisterSnapshot();registers[0xbd]&=~(16>>drum);synth.adoptRegisterSnapshot(registers);send('forceRhythmOff',[drum]);}},
    _cancelPerformanceOwner:{value:source=>{const registers=synth.getRegisterSnapshot();for(const [key,value]of owners)if(value===source){if(key==='csm'){const loads=owners.get('timer-loads')?.value??0;registers[8]&=127;registers[4]=(registers[4]&~131)|(loads&2);owners.set('timer-loads',{value:loads&2});}else if(key==='adpcm')registers[7]=1;else if(key>=18)registers[0xbd]&=~(16>>(key-18));else registers[0xb0+key]&=223;owners.delete(key);}synth.adoptRegisterSnapshot(registers);}},
    _stopVoices:{value:() => {
      const registers = synth.getRegisterSnapshot();
      for (let channel=0;channel<synth.channels;channel++) registers[(channel>=9?256:0)+0xb0+channel%9]&=223;
      registers[0xbd]&=224;synth.adoptRegisterSnapshot(registers);
      return request?request('stopVoices',[]):synth._requestControl('stopVoices');
    }},
  });
  return synth;
}

export function createOplClient(port,options={},lifecycle={}){
  const chip=options.chip??'ym3812',clock=options.clock??CHIP_CLOCKS[chip];
  const synth=createOplRegisterClient((method,args,metadata)=>port.postMessage({method,args,...(options.native?metadata:{})}),{chip,clock,close:()=>port.close(),owner:()=>{const context=lifecycle.captureContext?.();return context?.keyboard?'keyboard':context?.performanceOwner;}});
  const controlled=attachChipClock(synth,port,clock);
  if(options.native&&lifecycle.captureContext){
    const setClock=synth.setClock.bind(synth),dispose=synth.dispose.bind(synth);let disposed=false;
    const resume=(context,callback)=>new Promise((resolve,reject)=>setTimeout(()=>{try{if(disposed||lifecycle.isStopped?.(context))throw new Error('Run stopped');lifecycle.restoreContext?.(context);resolve(callback());}catch(error){reject(error);}},0));
    synth.setClock=hz=>{const context=lifecycle.captureContext();return setClock(hz).then(value=>resume(context,()=>value),error=>resume(context,()=>{throw error;}));};
    synth.dispose=()=>{disposed=true;dispose();};
  }
  if(options.state)synth._adoptState(options.state);
  return controlled;
}
