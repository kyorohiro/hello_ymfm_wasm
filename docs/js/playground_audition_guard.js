/** Worklet-local ownership for the UI keyboard on one shared OPN chip.
 * Script patch/FX writes remain live; only pitch/key writes to held channels
 * are suppressed. Commands use physical chip channels (Neo Geo maps in host).
 */
export function createOpnAuditionGuard(chip, channelCount = 6) {
  if (!chip || typeof chip.reset !== 'function' ||
      (typeof chip.writeRegister !== 'function' && typeof chip.write !== 'function')) {
    throw new TypeError('Audition guard requires a writable OPN chip');
  }
  if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 6) {
    throw new RangeError('Audition channel count must be 1..6');
  }
  const directWrite = typeof chip.writeRegister === 'function'
    ? chip.writeRegister.bind(chip)
    : (register, value, port = 0) => {
      chip.write(port * 2, register);
      chip.write(port * 2 + 1, value);
    };
  const directReset = chip.reset.bind(chip);
  const tokens = new Float64Array(channelCount);
  let heldMask = 0;
  const keyCode = channel => channel < 3 ? channel : channel + 1;
  function clear() { tokens.fill(0); heldMask = 0; }
  chip.reset = (...args) => { clear(); return directReset(...args); };
  chip.writeRegister = (register, value, port = 0) => {
    // Ordinary playback keeps one cheap branch and its original transport.
    if (heldMask) {
      let channel = -1;
      if (port === 0 && register === 0x28) {
        const code = value & 7;
        if ((code & 3) !== 3) channel = (code & 3) + (code & 4 ? 3 : 0);
      } else if ((register >= 0xa0 && register <= 0xa2) ||
          (register >= 0xa4 && register <= 0xa6)) {
        channel = port * 3 + (register & 3);
      } else if (port === 0 && ((register >= 0xa8 && register <= 0xaa) ||
          (register >= 0xac && register <= 0xae))) {
        channel = 2;
      }
      if (channel >= 0 && (heldMask & (1 << channel))) return;
    }
    return directWrite(register, value, port);
  };
  const integer = (value, low, high, label) => {
    if (!Number.isSafeInteger(value) || value < low || value > high) {
      throw new RangeError(`${label} must be an integer in ${low}..${high}`);
    }
  };
  return {
    /** Return false for unrelated commands. Invalid audition data throws before
     * changing claims or chip state; the processor reports that error to host. */
    handle(command) {
      if (command.type === 'clear-auditions') {
        // Stop and Worker key-offs arrive over different ports. Release manual
        // voices here even if a Worker key-off reached the filter before clear.
        for (let channel = 0; channel < channelCount; channel++) {
          if (heldMask & (1 << channel)) directWrite(0x28, keyCode(channel), 0);
        }
        clear();
        return true;
      }
      if (command.type !== 'audition-note-on' && command.type !== 'audition-note-off') return false;
      const {channel, token} = command;
      integer(channel, 0, channelCount - 1, 'Audition channel');
      integer(token, 1, Number.MAX_SAFE_INTEGER, 'Audition token');
      if (command.type === 'audition-note-on') {
        integer(command.block, 0, 7, 'Audition block');
        integer(command.fnum, 0, 2047, 'Audition fnum');
        tokens[channel] = token;
        heldMask |= 1 << channel;
        const port = channel < 3 ? 0 : 1;
        const offset = channel % 3;
        // Bypass the script filter, and create a fresh key edge on a stolen voice.
        directWrite(0x28, keyCode(channel), 0);
        directWrite(0xa4 + offset, (command.block << 3) | (command.fnum >> 8), port);
        directWrite(0xa0 + offset, command.fnum & 0xff, port);
        directWrite(0x28, 0xf0 | keyCode(channel), 0);
      } else if (tokens[channel] === token) {
        directWrite(0x28, keyCode(channel), 0);
        tokens[channel] = 0;
        heldMask &= ~(1 << channel);
      }
      return true;
    },
  };
}

/** Dispatch private UI commands without turning malformed input into a crashed
 * AudioWorklet. The normal chip protocol remains unchanged. */
export function receiveOpnAuditionCommand(guard, command, reply) {
  if (command.type !== 'audition-note-on' && command.type !== 'audition-note-off' &&
      command.type !== 'clear-auditions') return false;
  try {
    if (!guard) throw new Error('Audition chip is not ready');
    guard.handle(command);
  } catch (error) {
    reply({type: 'audition-error', token: command.token, message: String(error.message ?? error)});
  }
  return true;
}

/** Shared Genesis PSG bus ownership. Script latch/data continuations retain
 * their own destination while an inspector changes the physical chip latch.
 * Install after the applied-state observer, so blocked bytes never enter it.
 * @param {{write:(byte:number)=>unknown,reset:()=>unknown}} chip
 * @param {{getState:()=>{latched:number,mode:number,periods:number[]}}} options
 */
export function createPsgAuditionGuard(chip,{getState}) {
  const write=chip.write.bind(chip),reset=chip.reset.bind(chip),owners=new Map();
  let scriptLatch=getState().latched;
  function send(byte,register,owner) {
    const channel=register>>1,state=getState();
    if(owners.has(channel)&&owners.get(channel)!==owner)return;
    // Noise rate 3 shares tone channel 3's divider; retain that divider for a
    // held noise voice even while code continues on the tone channel.
    if(register===4&&owners.has(3)&&(state.mode&3)===3&&owners.get(3)!==owner)return;
    if(!(byte&128)&&state.latched!==register){
      const low=register&1?byte&15:register===6?state.mode:state.periods[channel]&15;
      write(0x80|(register<<4)|low);
    }
    return write(byte);
  }
  chip.write=byte=>{
    if(byte&128)scriptLatch=(byte>>4)&7;
    return send(byte,scriptLatch);
  };
  chip.reset=()=>{if(owners.size)return;scriptLatch=0;return reset();};
  return {
    begin(channel,owner){owners.set(channel,owner);},
    end(channel,owner){if(owners.get(channel)===owner)owners.delete(channel);},
    apply(command,owner){
      if(command.method==='reset')return chip.reset();
      if(command.method!=='write')throw new Error('Unsupported shared PSG inspector command');
      const byte=command.args[0],register=byte&128?(byte>>4)&7:command.psgRegister??getState().latched;
      return send(byte,register,owner);
    },
    clear(){for(const channel of owners.keys())write(0x9f|(channel<<5));owners.clear();},
  };
}
