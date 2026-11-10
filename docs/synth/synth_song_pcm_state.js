// Written RF5C164 registers and sample RAM at the audible reference position.
// This observes original source writes, never the Mix adapter's muted routing.
const DEFAULT_CLOCK=12500000;
const RAM_BYTES=65536;
const integer=(value,max,label)=>{
  if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`${label} must be 0..${max}`);
  return value;
};
function stateArray(value,length,max,label) {
  if((!Array.isArray(value)&&!ArrayBuffer.isView(value))||value.length!==length)throw new TypeError(`Invalid ${label}`);
  return Uint8Array.from(value,item=>integer(item,max,label));
}
function sampleBytes(value) {
  if(!(value instanceof Uint8Array))throw new TypeError('PCM RAM writes need Uint8Array bytes');
  return value;
}

/** Source register decoding and banked writes. Reset preserves sample RAM. */
export function createPcmRegisterState(clockHz=DEFAULT_CLOCK) {
  if(typeof clockHz!=='number'||!Number.isFinite(clockHz)||clockHz<=0)throw new RangeError('PCM clock must be positive');
  const registers=new Uint8Array(8*7),ram=new Uint8Array(RAM_BYTES),known=new Uint8Array(RAM_BYTES);
  let selectedChannel=0,bank=0,enabled=false,channelMask=255,revision=0,memoryRevision=0,cached=null,cachedRam=null;
  const changed=()=>{revision++;cached=null;};
  function reset() {
    registers.fill(0);selectedChannel=bank=0;enabled=false;channelMask=255;changed();
  }
  function write(register,value) {
    integer(register,8,'PCM register');integer(value,255,'PCM value');
    if(register<7)registers[selectedChannel*7+register]=value;
    else if(register===7) {
      enabled=Boolean(value&128);
      if(value&64)selectedChannel=value&7;else bank=(value&15)<<12;
    } else channelMask=value;
    changed();
  }
  function put(address,value) {
    if(!known[address]||ram[address]!==value) {
      ram[address]=value;known[address]=1;memoryRevision++;cachedRam=null;changed();
    }
  }
  function writeMemory(offset,value) {
    integer(offset,4095,'PCM memory window');integer(value,255,'PCM memory value');
    put(bank|offset,value);
  }
  function loadBankedMemory(bytes,offset=0) {
    sampleBytes(bytes);integer(offset,65535,'PCM banked RAM offset');
    const address=bank|offset;
    if(address+bytes.length>RAM_BYTES)throw new RangeError('PCM banked RAM range exceeds 64 KiB');
    for(let index=0;index<bytes.length;index++)put(address+index,bytes[index]);
  }
  function snapshot(frame=0) {
    if(!cached) {
      // A nonempty typed array cannot be frozen. Frozen byte arrays give all
      // consumers one shared immutable view, rebuilt only when RAM changes.
      if(!cachedRam)cachedRam={ram:Object.freeze(Array.from(ram)),known:Object.freeze(Array.from(known))};
      const channels=Array.from({length:8},(_,channel)=>{
        const i=channel*7,step=registers[i+2]|registers[i+3]<<8,pan=registers[i+1];
        const keyOn=!(channelMask&(1<<channel));
        return Object.freeze({channel,volume:registers[i],panLeft:pan&15,panRight:pan>>4,step,
          start:registers[i+6]<<8,loopStart:registers[i+4]|registers[i+5]<<8,keyOn,
          active:enabled&&keyOn,sampleRateHz:clockHz/384*step/2048});
      });
      cached=Object.freeze({kind:'rf5c164',present:true,clockHz,revision,memoryRevision,enabled,selectedChannel,bank,channelMask,
        channels:Object.freeze(channels),ram:cachedRam.ram,known:cachedRam.known});
    }
    return Object.freeze({...cached,frame});
  }
  function saveState() {
    return {version:1,clockHz,revision,memoryRevision,selectedChannel,bank,enabled,channelMask,
      registers:registers.slice(),ram:ram.slice(),known:known.slice()};
  }
  function loadState(state) {
    if(state?.version!==1||state.clockHz!==clockHz||typeof state.enabled!=='boolean')throw new TypeError('Invalid PCM decoder state');
    const next={revision:integer(state.revision,Number.MAX_SAFE_INTEGER,'PCM revision'),
      memoryRevision:integer(state.memoryRevision,Number.MAX_SAFE_INTEGER,'PCM memory revision'),
      selectedChannel:integer(state.selectedChannel,7,'PCM channel'),bank:integer(state.bank,61440,'PCM bank'),
      enabled:state.enabled,channelMask:integer(state.channelMask,255,'PCM channel mask'),
      registers:stateArray(state.registers,56,255,'PCM registers'),ram:stateArray(state.ram,RAM_BYTES,255,'PCM RAM'),
      known:stateArray(state.known,RAM_BYTES,1,'PCM known RAM')};
    if(next.bank%4096||next.memoryRevision>next.revision)throw new TypeError('Invalid PCM decoder revision or bank');
    registers.set(next.registers);ram.set(next.ram);known.set(next.known);
    ({revision,memoryRevision,selectedChannel,bank,enabled,channelMask}=next);cached=cachedRam=null;
  }
  reset();return {write,writeMemory,loadBankedMemory,reset,snapshot,saveState,loadState};
}

/** Observe ordered source writes against audible, rather than prefetched time. */
export function createPcmSongTimeline(engine,clockHz=DEFAULT_CLOCK) {
  const shadow=createPcmRegisterState(clockHz),rendered=createPcmRegisterState(clockHz);
  const original={write:engine.writeRf5c164,memory:engine.writeRf5c164Memory,load:engine.loadRf5c164Memory,
    process:engine.processFrames,reset:engine.reset};
  if(Object.values(original).some(value=>typeof value!=='function'))throw new TypeError('PCM timeline needs a reference engine');
  let generatedFrames=0,lastReadFrame=0,events=[],head=0,disposed=false;
  function apply(decoder,event) {
    if(event.type==='register')decoder.write(event.register,event.value);
    else if(event.type==='window')for(let index=0;index<event.bytes.length;index++)decoder.writeMemory(event.offset+index,event.bytes[index]);
    else decoder.loadBankedMemory(event.bytes instanceof Uint8Array?event.bytes:Uint8Array.from(event.bytes),event.offset);
  }
  function queue(event) {
    renderedEvent(event);
    const last=events.at(-1);
    // VGM DAC streams may deliver many adjacent bytes at one source instant.
    // Keep one ordered chunk instead of one object per memory byte.
    if(event.type==='window'&&last&&events.length>head&&last.type==='window'&&last.frame===generatedFrames&&
      last.offset+last.bytes.length===event.offset)last.bytes.push(...event.bytes);
    else events.push({...event,frame:generatedFrames});
  }
  const renderedEvent=event=>apply(rendered,event);
  function write(register,value) {
    integer(register,8,'PCM register');integer(value,255,'PCM value');
    const result=original.write.call(this,register,value);
    if(!disposed)queue({type:'register',register,value});return result;
  }
  function writeMemory(offset,value) {
    integer(offset,4095,'PCM memory window');integer(value,255,'PCM memory value');
    const result=original.memory.call(this,offset,value);
    if(!disposed)queue({type:'window',offset,bytes:[value]});return result;
  }
  function loadBankedMemory(bytes,offset=0) {
    sampleBytes(bytes);integer(offset,65535,'PCM banked RAM offset');
    const copy=bytes.slice(),result=original.load.call(this,bytes,offset);
    if(!disposed&&copy.length)queue({type:'banked',offset,bytes:copy});return result;
  }
  function process(frames) {
    integer(frames,Number.MAX_SAFE_INTEGER-generatedFrames,'PCM generated frames');
    const result=original.process.call(this,frames);generatedFrames+=frames;return result;
  }
  function reset(...args) {
    const result=original.reset.apply(this,args);
    // Native reset preserves all generated RAM, including prefetched writes.
    // Match that baseline rather than silently replacing it with audible RAM.
    rendered.reset();shadow.loadState(rendered.saveState());
    generatedFrames=lastReadFrame=0;events=[];head=0;return result;
  }
  engine.writeRf5c164=write;engine.writeRf5c164Memory=writeMemory;engine.loadRf5c164Memory=loadBankedMemory;
  engine.processFrames=process;engine.reset=reset;
  function read(frame) {
    if(typeof frame!=='number'||!Number.isFinite(frame))throw new TypeError('PCM audible frame must be finite');
    const next=Math.max(0,Math.min(generatedFrames,Math.floor(frame)));
    if(next<lastReadFrame)throw new Error('Audible PCM state cannot move backwards without resetting');
    while(head<events.length&&events[head].frame<=next)apply(shadow,events[head++]);
    lastReadFrame=next;
    if(head===events.length){events=[];head=0;}else if(head>256){events=events.slice(head);head=0;}
    return shadow.snapshot(next);
  }
  function savedEvent(event) {return {...event,...(event.bytes?{bytes:Uint8Array.from(event.bytes)}:{})};}
  return {read,
    saveState() {
      if(disposed)throw new Error('PCM timeline is disposed');
      return {version:1,generatedFrames,lastReadFrame,decoder:shadow.saveState(),events:events.slice(head).map(savedEvent)};
    },
    loadState(state) {
      if(disposed)throw new Error('PCM timeline is disposed');
      if(state?.version!==1||!Array.isArray(state.events))throw new TypeError('Invalid PCM timeline state');
      const nextGenerated=integer(state.generatedFrames,Number.MAX_SAFE_INTEGER,'PCM generated frames');
      const nextRead=integer(state.lastReadFrame,nextGenerated,'PCM audible frame');let preceding=nextRead;
      const pending=state.events.map(event=>{
        const frame=integer(event?.frame,nextGenerated,'PCM event frame');
        if(frame<preceding)throw new TypeError('Invalid PCM pending event order');preceding=frame;
        if(event.type==='register')return {frame,type:'register',register:integer(event.register,8,'PCM register'),value:integer(event.value,255,'PCM value')};
        if(!['window','banked'].includes(event.type))throw new TypeError('Invalid PCM event type');
        const offset=integer(event.offset,event.type==='window'?4095:65535,'PCM event address');
        const bytes=stateArray(event.bytes,event.bytes?.length,255,'PCM event bytes');
        if(!bytes.length||offset+bytes.length>(event.type==='window'?4096:RAM_BYTES))throw new TypeError('Invalid PCM event range');
        return {frame,type:event.type,offset,bytes:event.type==='window'?Array.from(bytes):bytes};
      });
      // Validate the entire source sequence before mutating either live decoder.
      const nextShadow=createPcmRegisterState(clockHz);nextShadow.loadState(state.decoder);
      const nextRendered=createPcmRegisterState(clockHz);nextRendered.loadState(state.decoder);
      for(const event of pending)apply(nextRendered,event);
      shadow.loadState(nextShadow.saveState());rendered.loadState(nextRendered.saveState());
      generatedFrames=nextGenerated;lastReadFrame=nextRead;events=pending;head=0;
    },
    get pendingEvents(){return events.length-head;},
    dispose() {
      if(disposed)return;disposed=true;events=[];head=0;
      if(engine.writeRf5c164===write)engine.writeRf5c164=original.write;
      if(engine.writeRf5c164Memory===writeMemory)engine.writeRf5c164Memory=original.memory;
      if(engine.loadRf5c164Memory===loadBankedMemory)engine.loadRf5c164Memory=original.load;
      if(engine.processFrames===process)engine.processFrames=original.process;
      if(engine.reset===reset)engine.reset=original.reset;
    },
  };
}
