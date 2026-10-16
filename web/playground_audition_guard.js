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
