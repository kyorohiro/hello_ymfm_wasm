// SPDX-License-Identifier: BSD-3-Clause
import {MAX_ADPCM_BYTES,encodeBase64} from './preset.js';

const KEY_CHANNEL_CODES = [0,1,2,4,5,6];

/** App-local Timer A adapter. CSM is mode 10, and hardware keys all four OPs. */
export function installChannel3Controls(chip,monitor,getKeyMask) {
  const keyOn = chip.keyOn.bind(chip), keyOff = chip.keyOff.bind(chip);
  function getChannel3State() {
    const registers = monitor.registers[0], mode = registers[0x27] & 0xc0;
    return {mode:mode === 0x80 ? 'csm' : mode ? 'special' : 'normal',
      timerA:registers[0x24] << 2 | registers[0x25] & 3,running:Boolean(registers[0x27] & 1),
      frequencies:monitor.getFmState().channels[2].specialFrequencies.map(({block,fnum}) => ({block,fnum}))};
  }
  function setTimerA(value) {
    if (!Number.isInteger(value) || value < 0 || value > 1023) throw new RangeError('Timer A must be 0–1023');
    chip.write(0,0x24,value >> 2); chip.write(0,0x25,value & 3);
  }
  function setChannel3Mode(mode,{timerA,running = mode === 'csm'} = {}) {
    if (!['normal','special','csm'].includes(mode)) throw new RangeError('CH3 mode must be normal, special or csm');
    if (typeof running !== 'boolean') throw new TypeError('Timer A running must be boolean');
    if (timerA !== undefined && (!Number.isInteger(timerA) || timerA < 0 || timerA > 1023)) throw new RangeError('Timer A must be 0–1023');
    // A held normal Gate would mask the Timer A key pulses inside the core.
    if (mode === 'csm' && getChannel3State().mode !== 'csm') keyOff(2);
    if (timerA !== undefined) setTimerA(timerA);
    const bits = mode === 'csm' ? 0x80 : mode === 'special' ? 0x40 : 0;
    // Flags 4/5 are write-one-to-reset commands, so never replay them.
    const previous = monitor.registers[0][0x27] & 0x0e;
    chip.write(0,0x27,previous | bits | (running ? 1 : 0));
  }
  chip.setTimerA = setTimerA;
  chip.setChannel3Mode = setChannel3Mode;
  chip.getChannel3State = getChannel3State;
  chip.setCsm = (enabled,options = {}) => {
    if (typeof enabled !== 'boolean') throw new TypeError('CSM enable must be boolean');
    setChannel3Mode(enabled ? 'csm' : 'normal',options);
  };
  chip.setChannel3SpecialMode = enabled => {
    if (typeof enabled !== 'boolean') throw new TypeError('Special mode enable must be boolean');
    setChannel3Mode(enabled ? 'special' : 'normal',{running:false});
  };
  chip.keyOn = (channel,operators) => {
    const mask = getKeyMask(channel);
    if (channel === 2 && getChannel3State().mode === 'csm') {
      if (operators !== undefined && (!Array.isArray(operators) || !operators.length || operators.some(operator => !Number.isInteger(operator) || operator < 0 || operator > 3))) {
        throw new RangeError('Operators must contain indexes 0–3');
      }
      keyOff(channel);
      setChannel3Mode('csm',{running:true});
      return;
    }
    if (operators !== undefined) return keyOn(channel,operators);
    if (!mask) return keyOff(channel);
    keyOn(channel,[0,1,2,3].filter(operator => mask & 1 << operator));
  };
  chip.keyOff = channel => {
    if (channel === 2 && getChannel3State().mode === 'csm') setChannel3Mode('csm',{running:false});
    keyOff(channel);
  };
  function setKeyMask(channel,mask,active = false) {
    // Changing selected OPs preserves Gate Off. A CSM timer always triggers 0xf.
    const state = monitor.getFmState().channels[channel];
    if (channel === 2 && getChannel3State().mode === 'csm') return;
    if (state.keyMask || active) chip.write(0,0x28,mask << 4 | KEY_CHANNEL_CODES[channel]);
  }
  return {getChannel3State,setKeyMask};
}

/** Keep accepted memory uploads, including Code writes and nonzero offsets. */
export function observeAdpcmMemory(chip) {
  const memory = new Uint8Array(MAX_ADPCM_BYTES), upload = chip.transport.loadAdpcmMemory.bind(chip.transport);
  // Native RAM starts at zero. After an unmirrored CPU write, only successful
  // uploads describe known memory, including any bytes between saved samples.
  const known = new Uint8Array(MAX_ADPCM_BYTES).fill(1);
  let first = MAX_ADPCM_BYTES, last = 0, pending = 0, unsupportedWrite = false, cpuRevision = 0;
  chip.transport.loadAdpcmMemory = async (source,address) => {
    // The real transport clones synchronously. Preserve that ownership contract.
    const bytes = source.slice(), revision = cpuRevision;
    pending++;
    try {
      await upload(bytes,address);
      // A transfer started before a CPU write cannot recover the later image.
      if (revision !== cpuRevision || !bytes.length) return;
      if (unsupportedWrite) {
        memory.fill(0); known.fill(0);
        first = MAX_ADPCM_BYTES; last = 0;
        unsupportedWrite = false;
      }
      memory.set(bytes,address);
      known.fill(1,address,address + bytes.length);
      first = Math.min(first,address); last = Math.max(last,address + bytes.length);
    } finally { pending--; }
  };
  function observeWrite(port,register,value) {
    if (port === 1 && register === 8 && (chip.adpcm.registers[0] & 0xe0) === 0x60) {
      if (!unsupportedWrite) known.fill(0);
      unsupportedWrite = true; cpuRevision++;
    }
  }
  function capture(registers) {
    if (pending) throw new Error('ADPCM-B memory is still loading. Save again after the transfer completes.');
    if (unsupportedWrite) throw new Error('ADPCM-B CPU data-register writes cannot be saved as an uploaded sample. Load the encoded sample with loadMemory.');
    if ((registers[1] & 3) !== 2) throw new Error('ADPCM-B preset capture requires 8-bit DRAM sample addressing.');
    const start = (registers[2] | registers[3] << 8) * 32;
    const end = ((registers[4] | registers[5] << 8) + 1) * 32;
    const address = Math.floor(first / 32) * 32, limit = Math.ceil(last / 32) * 32;
    if (!last || start < address || end > limit || end <= start) throw new Error('ADPCM-B selected range extends outside the uploaded sample memory.');
    if (known.subarray(address,limit).includes(0)) throw new Error('ADPCM-B saved memory contains unknown bytes between uploads. Load the complete contiguous memory range before saving.');
    return {address,start,end,data:encodeBase64(memory.subarray(address,limit))};
  }
  return {capture,observeWrite,needsUpload:() => unsupportedWrite};
}
