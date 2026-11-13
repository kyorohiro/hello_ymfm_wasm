// SPDX-License-Identifier: BSD-3-Clause
// Hand edits borrow the reference RF5C164. No sample upload, reset, extra chip,
// global-enable change or output fade is introduced by this adapter.
const RAM_BYTES=65536,C4_HZ=261.6255653005986;
const integer=(value,max,label)=>{
  if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`${label} must be 0..${max}`);
  return value;
};
const channelNumber=value=>integer(value,7,'PCM channel');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const bytes=(value,length,max,label)=>{
  if((!Array.isArray(value)&&!ArrayBuffer.isView(value))||value.length!==length)throw new TypeError(`Invalid ${label}`);
  return Uint8Array.from(value,item=>integer(item,max,label));
};

/** Validate the entire edit before selecting or writing any hardware channel. */
export function readSynthPcmSongEdit(value) {
  const channel=channelNumber(value?.channel),changes=value?.changes;
  if(!object(changes))throw new TypeError('Expected PCM edit changes');
  const result={};
  for(const [field,next]of Object.entries(changes)) {
    const maximum={volume:255,panLeft:15,panRight:15,step:65535}[field];
    if(maximum===undefined)throw new TypeError(`Unknown PCM hand-edit field: ${field}`);
    result[field]=integer(next,maximum,`PCM ${field}`);
  }
  return {channel,changes:result};
}

/** Copy only register metadata. Large immutable sample RAM views stay shared. */
export function patchSynthPcmSongSnapshotEdit(snapshot,value) {
  const edit=readSynthPcmSongEdit(value);
  if(!snapshot?.channels?.[edit.channel])return snapshot;
  const voice={...snapshot.channels[edit.channel],...edit.changes};
  voice.sampleRateHz=snapshot.clockHz/384*voice.step/2048;
  const channels=snapshot.channels.slice();channels[edit.channel]=voice;
  return {...snapshot,channels};
}

export function createSynthPcmSongInteraction(engine,{clockHz=12500000}={}) {
  if(!Number.isFinite(clockHz)||clockHz<=0)throw new RangeError('PCM clock must be positive');
  for(const field of ['writeRf5c164','writeRf5c164Memory','loadRf5c164Memory','processFrames','reset'])
    if(typeof engine?.[field]!=='function')throw new TypeError('Expected a reference PCM engine');
  const original={write:engine.writeRf5c164,memory:engine.writeRf5c164Memory,load:engine.loadRf5c164Memory,
    clear:engine.clearRf5c164Memory,process:engine.processFrames,reset:engine.reset};
  const registers=new Uint8Array(56),ram=new Uint8Array(RAM_BYTES),known=new Uint8Array(RAM_BYTES),baseSteps=new Uint16Array(8);
  const voices=new Map(),slots=Array(8).fill(null),edits=new Map(),sampleChecks=new Map();
  let selectedChannel=0,bank=0,enabled=false,channelMask=255,sourceControl=0;
  let revision=0,memoryRevision=0,generatedFrames=0,pitch=0,disposed=false,cachedRam=null;
  const open=()=>{if(disposed){const error=new Error('PCM song interaction is disposed');error.name='AbortError';throw error;}};
  function voice(channel) {
    const offset=channel*7,pan=registers[offset+1],step=registers[offset+2]|registers[offset+3]<<8,keyOn=!(channelMask&(1<<channel));
    return {channel,volume:registers[offset],panLeft:pan&15,panRight:pan>>4,step,
      start:registers[offset+6]<<8,loopStart:registers[offset+4]|registers[offset+5]<<8,
      keyOn,active:enabled&&keyOn,sampleRateHz:clockHz/384*step/2048,referenceStep:baseSteps[channel]};
  }
  function snapshot(frame=generatedFrames,includeRam=false) {
    if(includeRam&&!cachedRam)cachedRam={ram:Object.freeze(Array.from(ram)),known:Object.freeze(Array.from(known))};
    return {kind:'rf5c164',present:true,clockHz,revision,memoryRevision,frame,enabled,selectedChannel,bank,channelMask,
      channels:Array.from({length:8},(_,channel)=>voice(channel)),...(includeRam?cachedRam:{})};
  }
  // Manual dispatch reads revision on every gesture. RAM is opt-in, avoiding a
  // second 64KiB freeze/copy on each streamed-data update behind the UI timeline.
  function read({includeRam=false}={}) {return {...snapshot(generatedFrames,includeRam),generatedFrames,sourceControl,pitch,disposed,pendingDisplayEdits:edits.size,
    voices:[...voices.values()].map(({id,channel,baseStep,pitchOwned})=>({id,channel,baseStep,pitchOwned}))};}
  function forget(channel) {const current=slots[channel];if(current)voices.delete(current.id);slots[channel]=null;}
  function clearOwners() {voices.clear();slots.fill(null);edits.clear();pitch=0;}
  function observe(register,value) {
    if(register<7)registers[selectedChannel*7+register]=value;
    else if(register===7){enabled=Boolean(value&128);if(value&64)selectedChannel=value&7;else bank=(value&15)<<12;}
    else channelMask=value;
    revision++;
  }
  function send(register,value) {const result=original.write.call(engine,register,value);observe(register,value);return result;}
  function write(register,value) {
    integer(register,8,'PCM register');integer(value,255,'PCM value');
    const channel=selectedChannel,result=send(register,value);
    if(register===7) {
      sourceControl=value;
      if(!enabled)for(let ch=0;ch<8;ch++)forget(ch);
    } else if(register===8) {
      // Every source mask explicitly supplies all eight gates, including bits
      // that happen not to change. An old hand key-up cannot overwrite them.
      for(let ch=0;ch<8;ch++)forget(ch);
    } else if(register===2||register===3) {
      baseSteps[channel]=voice(channel).step;
      if(slots[channel])slots[channel].pitchOwned=false;
    } else if(register>=4&&register<=6)forget(channel);
    return result;
  }
  function put(address,value) {
    if(!known[address]||ram[address]!==value) {
      ram[address]=value;known[address]=1;revision++;memoryRevision++;cachedRam=null;sampleChecks.clear();
    }
  }
  function writeMemory(offset,value) {
    integer(offset,4095,'PCM RAM window');integer(value,255,'PCM RAM byte');
    const address=bank|offset,result=original.memory.call(this,offset,value);put(address,value);return result;
  }
  function loadMemory(data,offset=0) {
    if(!(data instanceof Uint8Array))throw new TypeError('PCM RAM needs Uint8Array bytes');
    integer(offset,65535,'PCM banked RAM offset');const address=bank|offset;
    if(address+data.length>RAM_BYTES)throw new RangeError('PCM banked RAM exceeds 64 KiB');
    const result=original.load.call(this,data,offset);
    for(let index=0;index<data.length;index++)put(address+index,data[index]);return result;
  }
  // Local endpoints acknowledge absolute uploads asynchronously. Record only
  // accepted bytes, independently of the chip's current CPU RAM-bank latch.
  function observeAbsoluteMemory(data,address=0) {
    open();if(!(data instanceof Uint8Array))throw new TypeError('PCM RAM needs Uint8Array bytes');
    integer(address,65535,'PCM absolute RAM address');if(address+data.length>RAM_BYTES)throw new RangeError('PCM absolute RAM exceeds 64 KiB');
    for(let index=0;index<data.length;index++)put(address+index,data[index]);
  }
  // Semantic key commands alter one gate, unlike register 8's whole-chip mask.
  function observeChannelGate(channel,on) {
    open();channelNumber(channel);if(typeof on!=='boolean')throw new TypeError('PCM gate must be boolean');
    channelMask=on?channelMask&~(1<<channel):channelMask|(1<<channel);revision++;forget(channel);
  }
  function observeChannelSelection(channel) {
    open();channelNumber(channel);selectedChannel=channel;enabled=true;sourceControl=0xc0|channel;revision++;
  }
  function clearMemory(...args) {
    const result=original.clear.apply(this,args);ram.fill(0);known.fill(0);revision++;memoryRevision++;
    cachedRam=null;sampleChecks.clear();return result;
  }
  function process(frames) {const result=original.process.call(this,frames);generatedFrames+=frames;return result;}
  function reset(...args) {
    const result=original.reset.apply(this,args);registers.fill(0);baseSteps.fill(0);
    selectedChannel=bank=sourceControl=generatedFrames=0;enabled=false;channelMask=255;revision++;clearOwners();return result;
  }
  engine.writeRf5c164=write;engine.writeRf5c164Memory=writeMemory;engine.loadRf5c164Memory=loadMemory;
  if(typeof original.clear==='function')engine.clearRf5c164Memory=clearMemory;
  engine.processFrames=process;engine.reset=reset;

  function sampleReason(current) {
    const key=`${current.start}:${current.loopStart}`,previous=sampleChecks.get(key);
    if(previous!==undefined)return previous;
    let reason='';
    const path=start=>{
      for(let count=0;count<RAM_BYTES;count++) {
        const address=(start+count)&65535;
        if(!known[address])return {error:`PCM RAM is not prepared at $${address.toString(16).toUpperCase().padStart(4,'0')}.`};
        if(ram[address]===255)return {end:true,empty:count===0};
      }
      return {end:false}; // A fully known wrapping waveform is native-valid.
    };
    const start=path(current.start);
    if(start.error)reason=start.error;
    else if(start.empty)reason='The PCM start address points to an end marker.';
    else if(start.end) {const loop=path(current.loopStart);if(loop.error)reason=loop.error;}
    if(sampleChecks.size>=64)sampleChecks.delete(sampleChecks.keys().next().value);
    sampleChecks.set(key,reason);return reason;
  }
  function description(channel) {
    open();channelNumber(channel);const current=voice(channel);
    const reason=!enabled?'The recorded PCM chip is globally disabled.':!current.step?'This PCM channel has zero playback step.':
      !current.volume?'This PCM channel has zero volume.':!current.panLeft&&!current.panRight?'This PCM channel has both pan outputs muted.':sampleReason(current);
    return {...current,baseStep:baseSteps[channel],playable:!reason,reason};
  }
  // Reg7 has independent channel and RAM-bank latches. Restoring only the last
  // byte would leave our channel selected when that byte selected a RAM bank.
  function onChannel(channel,perform) {
    const selected=selectedChannel,control=sourceControl,enable=enabled?128:0;
    send(7,enable|64|channel);
    try{return perform();}
    finally {
      send(7,enable|64|selected);
      if(!(control&64))send(7,control);
      else if((enable|64|selected)!==control)send(7,control);
    }
  }
  function setStep(channel,step) {onChannel(channel,()=>{send(2,step&255);send(3,step>>8);});}
  function applyEdit(value) {
    open();const edit=readSynthPcmSongEdit(value),changes=edit.changes,own=field=>Object.hasOwn(changes,field);
    if(!Object.keys(changes).length)return false;
    const current=voice(edit.channel);
    onChannel(edit.channel,()=>{
      if(own('volume'))send(0,changes.volume);
      if(own('panLeft')||own('panRight'))send(1,(own('panLeft')?changes.panLeft:current.panLeft)|((own('panRight')?changes.panRight:current.panRight)<<4));
      if(own('step')) {send(2,changes.step&255);send(3,changes.step>>8);}
    });
    if(own('step')) {baseSteps[edit.channel]=changes.step;if(slots[edit.channel])slots[edit.channel].pitchOwned=false;}
    for(const [field,item]of Object.entries(changes))edits.set(`${edit.channel}:${field}`,{frame:generatedFrames,edit:{channel:edit.channel,changes:{[field]:item}}});
    return {...read(),edit,edits:[edit]};
  }
  function applySettings(channel,value) {
    const settings=value?.settings??value;if(!object(settings))throw new TypeError('Expected PCM settings');
    const changes={};for(const field of ['volume','panLeft','panRight','step'])if(settings[field]!==undefined)changes[field]=settings[field];
    return applyEdit({channel,changes});
  }
  function noteStep(current,semitones) {return Math.max(1,Math.min(65535,Math.round(current.baseStep*current.ratio*2**(semitones/12))));}
  function noteOn(id,note,{channel,pitchClock=7670454}={}) {
    open();channelNumber(channel);
    if(typeof id!=='string'||!id.length||id.length>128)throw new TypeError('Expected a keyboard identity of 1–128 characters');
    if(voices.has(id))throw new Error('Keyboard identity is already active');
    if(!object(note))throw new TypeError('PCM keyboard needs a block/fnum pitch');
    const block=integer(note.block,7,'Keyboard block'),fnum=integer(note.fnum,2047,'Keyboard fnum');
    if(!fnum||!Number.isFinite(pitchClock)||pitchClock<=0)throw new RangeError('PCM keyboard needs a positive pitch and clock');
    const settings=description(channel);if(!settings.playable)throw new Error(settings.reason);
    const previous=slots[channel],hz=fnum*pitchClock*2**(block-1)/(144*2**20);
    const current={id,channel,baseStep:baseSteps[channel]||settings.step,ratio:hz/C4_HZ,pitchOwned:true};
    forget(channel);send(8,channelMask|(1<<channel));
    const step=noteStep(current,pitch);setStep(channel,step);send(8,channelMask&~(1<<channel));
    voices.set(id,current);slots[channel]=current;
    return {id,channel,step,baseStep:current.baseStep,stolenId:previous?.id??null};
  }
  function noteOff(id) {
    open();const current=voices.get(id);if(!current||slots[current.channel]!==current)return false;
    if(typeof engine.releaseRf5c164Channel==='function') {
      engine.releaseRf5c164Channel(current.channel);observe(8,channelMask|(1<<current.channel));
    }else send(8,channelMask|(1<<current.channel));
    forget(current.channel);return true;
  }
  function forgetKeyboard(id) {open();const current=voices.get(id);if(!current)return false;forget(current.channel);return true;}
  function retuneKeyboard(id,note,{pitchClock=7670454}={}) {
    open();const block=integer(note?.block,7,'Keyboard block'),fnum=integer(note?.fnum,2047,'Keyboard fnum');
    if(!fnum||!Number.isFinite(pitchClock)||pitchClock<=0)throw new RangeError('PCM keyboard needs a positive pitch and clock');
    const current=voices.get(id);if(!current||slots[current.channel]!==current||!current.pitchOwned)return false;
    current.ratio=fnum*pitchClock*2**(block-1)/(144*2**20)/C4_HZ;
    const step=noteStep(current,0);setStep(current.channel,step);return {channel:current.channel,step,baseStep:current.baseStep};
  }
  function releaseKeyboard() {open();const ids=[...voices.keys()];for(const id of ids)noteOff(id);pitch=0;return ids.length?{...read(),released:ids}:false;}
  function setPitch(value) {
    open();if(!Number.isFinite(value)||value< -24||value>24)throw new RangeError('Keyboard Pitch must be -24..24 semitones');
    for(const current of voices.values())if(current.pitchOwned)setStep(current.channel,noteStep(current,value));
    pitch=value;return read();
  }
  function readSnapshot(value,consumedFrame=0,{frozen=false}={}) {
    open();if(!value)return value;const changes=new Map();
    for(const pending of edits.values())if(frozen?pending.frame>=(value.frame??0):pending.frame>consumedFrame) {
      const {channel}=pending.edit;if(!changes.has(channel))changes.set(channel,{});
      Object.assign(changes.get(channel),pending.edit.changes);
    }
    let result=value;for(const [channel,fields]of changes)result=patchSynthPcmSongSnapshotEdit(result,{channel,changes:fields});
    // Keyboard tuning has its own C4 anchor: showing a bent raw Step must not
    // imply that the next C4 key will use that already-transposed speed.
    return {...result,channels:result.channels.map((current,channel)=>({...current,referenceStep:baseSteps[channel]}))};
  }
  function saveState() {open();return {version:1,clockHz,generatedFrames,sourceControl,selectedChannel,bank,enabled,channelMask,
    revision,memoryRevision,registers:registers.slice(),ram:ram.slice(),known:known.slice(),baseSteps:Array.from(baseSteps)};}
  function loadState(value) {
    open();if(value?.version!==1||value.clockHz!==clockHz||typeof value.enabled!=='boolean')throw new TypeError('Invalid PCM interaction state');
    const next={generatedFrames:integer(value.generatedFrames,Number.MAX_SAFE_INTEGER,'PCM generated frames'),sourceControl:integer(value.sourceControl,255,'PCM control'),
      selectedChannel:channelNumber(value.selectedChannel),bank:integer(value.bank,61440,'PCM bank'),enabled:value.enabled,channelMask:integer(value.channelMask,255,'PCM mask'),
      revision:integer(value.revision,Number.MAX_SAFE_INTEGER,'PCM revision'),memoryRevision:integer(value.memoryRevision,Number.MAX_SAFE_INTEGER,'PCM memory revision'),
      registers:bytes(value.registers,56,255,'PCM registers'),ram:bytes(value.ram,RAM_BYTES,255,'PCM RAM'),known:bytes(value.known,RAM_BYTES,1,'PCM known RAM')};
    if(!Array.isArray(value.baseSteps)||value.baseSteps.length!==8)throw new TypeError('Invalid PCM base steps');
    const nextSteps=value.baseSteps.map(step=>integer(step,65535,'PCM base step'));
    if(next.bank%4096||Boolean(next.sourceControl&128)!==next.enabled||next.memoryRevision>next.revision)throw new TypeError('Invalid PCM control state');
    registers.set(next.registers);ram.set(next.ram);known.set(next.known);baseSteps.set(nextSteps);
    ({generatedFrames,sourceControl,selectedChannel,bank,enabled,channelMask,revision,memoryRevision}=next);
    cachedRam=null;sampleChecks.clear();clearOwners();
  }
  function dispose() {
    if(disposed)return;disposed=true;clearOwners();sampleChecks.clear();
    if(engine.writeRf5c164===write)engine.writeRf5c164=original.write;
    if(engine.writeRf5c164Memory===writeMemory)engine.writeRf5c164Memory=original.memory;
    if(engine.loadRf5c164Memory===loadMemory)engine.loadRf5c164Memory=original.load;
    if(engine.clearRf5c164Memory===clearMemory)engine.clearRf5c164Memory=original.clear;
    if(engine.processFrames===process)engine.processFrames=original.process;
    if(engine.reset===reset)engine.reset=original.reset;
  }
  return {applyEdit,applySettings,applyPreset:applySettings,noteOn,noteOff,forgetKeyboard,retuneKeyboard,observeAbsoluteMemory,observeChannelGate,observeChannelSelection,releaseKeyboard,setPitch,read,readSnapshot,
    describe:description,description,saveState,loadState,dispose,get generatedFrames(){return generatedFrames;},get selectedChannel(){return selectedChannel;}};
}
