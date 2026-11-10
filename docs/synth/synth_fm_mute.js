// Synth-only output routing. Masking pan leaves oscillator/envelope time and
// the authored instrument intact, so an ongoing voice resumes when enabled.
const installed = new WeakMap();
const decorated = new WeakSet();
const channelIndex = (register,port) => register>=0xb4&&register<=0xb6
  ? (port===0?0:3)+register-0xb4 : -1;
function validate(channel,muted) {
  if (!Number.isInteger(channel)||channel<0||channel>5) throw new RangeError('FM channel must be 0..5');
  if (typeof muted!=='boolean') throw new TypeError('FM channel muted must be a boolean');
}

export function installSynthFmChannelMute(chip) {
  if (installed.has(chip)) return installed.get(chip);
  if (!chip||typeof chip.writeRegister!=='function'||typeof chip.reset!=='function') throw new TypeError('FM mute needs a native register chip');
  const authored = new Uint8Array(6),muted = new Array(6).fill(false),addresses = new Uint8Array(2);
  const writeRegister = chip.writeRegister.bind(chip),reset = chip.reset.bind(chip);
  const filter = (register,value,port) => {
    const channel=channelIndex(register,port);
    if (channel<0) return value;
    authored[channel]=value;
    return muted[channel]?value&0x3f:value;
  };
  if (typeof chip.write==='function') {
    // Shared inspectors and audition helpers retain older register writers.
    // Filter at their final bus edge too, while their shadows still observe
    // the original authored pan/AMS/PMS byte.
    const write=chip.write.bind(chip);
    chip.write=(offset,value)=>{
      const port=offset>>1;
      if (!(offset&1)) addresses[port]=value;
      return write(offset,offset&1?filter(addresses[port],value,port):value);
    };
  } else {
    chip.writeRegister=(register,value,port=0)=>writeRegister(register,filter(register,value,port),port);
  }
  chip.reset=(...args)=>{
    const result=reset(...args);
    authored.fill(0);addresses.fill(0);
    return result;
  };
  const api={
    setMuted(channel,value) {
      validate(channel,value);
      if (muted[channel]===value) return false;
      muted[channel]=value;
      const port=channel<3?0:1,register=0xb4+channel%3;
      // Replay the newest author byte through the same native boundary. No
      // keys, pitches, envelopes or other register values are changed.
      chip.writeRegister(register,authored[channel],port);
      return true;
    },
    getState:()=>({muted:muted.slice(),pan:Array.from(authored)}),
  };
  installed.set(chip,api);
  return api;
}

/** Decorate the already-registered base class before its first instance. */
export function decorateSynthFmProcessor(Type) {
  if (decorated.has(Type)) return Type;
  const {init,applyCommand}=Type.prototype;
  const processors=new WeakMap();
  const ensure = processor => {
    processor.synthChannelMuted??=new Array(6).fill(false);
    if (!processor.ym2612) return null;
    const previous=processors.get(processor);
    if (previous?.chip===processor.ym2612) return previous.mask;
    const mask=installSynthFmChannelMute(processor.ym2612);
    for(let channel=0;channel<6;channel++)mask.setMuted(channel,processor.synthChannelMuted[channel]);
    processors.set(processor,{chip:processor.ym2612,mask});
    return mask;
  };
  Type.prototype.init=async function(...args) {
    const result=await init.apply(this,args);
    ensure(this);
    return result;
  };
  Type.prototype.applyCommand=function(command,...args) {
    const mask=ensure(this);
    if (command?.type==='synth-channel-mute') {
      validate(command.channel,command.muted);
      this.synthChannelMuted[command.channel]=command.muted;
      mask?.setMuted(command.channel,command.muted);
      return;
    }
    return applyCommand.call(this,command,...args);
  };
  decorated.add(Type);
  return Type;
}
