// SPDX-License-Identifier: BSD-3-Clause
// Standalone Synth FM/SSG/Rhythm output monitoring, applied on the audio clock. Not chip API.
const slots = [0, 8, 4, 12];
const keyChannels = [0, 1, 2, -1, 3, 4, 5, -1];
const fmLevel = (port, register) => register >= 0x40 && register <= 0x4e && (register & 3) < 3
  ? port * 3 + (register & 3) : -1;

/** Keep authored levels independent of temporary software Mute / Stop levels.
 * The native register observer continues to capture physical monitored bytes;
 * this private cache retains the authored levels for unmute / the next Gate.
 */
export function createFm2608FmSsgMonitor({writePhysical, onRhythmLevel = () => {}}) {
  const registers = [new Uint8Array(256), new Uint8Array(256)];
  const muted = {fm:Array(6).fill(false), ssg:Array(3).fill(false),rhythm:Array(6).fill(false)};
  const stopped = Array(6).fill(false);
  registers[0].fill(0xdf,0x18,0x1e);
  function restoreFm(channel) {
    const port = channel >= 3 ? 1 : 0;
    for (const slot of slots) {
      const register = 0x40 + channel % 3 + slot, authored = registers[port][register];
      writePhysical(port, register, muted.fm[channel] || stopped[channel] ? 127 : authored);
    }
  }
  function write(port, register, value) {
    if (port === 0 && register === 0x28 && (value & 0xf0)) {
      const channel = keyChannels[value & 7];
      if (channel >= 0 && stopped[channel]) { stopped[channel] = false; restoreFm(channel); }
    }
    // Preserve the immediate Synth's existing CSM restart behavior.
    if (port === 0 && register === 0x27 && (value & 0xc1) === 0x81 && stopped[2]) {
      stopped[2] = false; restoreFm(2);
    }
    const channel = fmLevel(port, register);
    if (channel >= 0) {
      registers[port][register] = value;
      return writePhysical(port, register, muted.fm[channel] || stopped[channel] ? 127 : value);
    }
    if (port === 0 && register >= 8 && register <= 10) {
      registers[0][register] = value;
      return writePhysical(port, register, muted.ssg[register - 8] ? 0 : value);
    }
    if(port===0&&register>=0x18&&register<=0x1d){
      registers[0][register]=value;
      const result=writePhysical(port,register,muted.rhythm[register-0x18]?value&63:value);
      onRhythmLevel(register,value);return result;
    }
    return writePhysical(port, register, value);
  }
  function setMute(section, channel, value) {
    if (!Object.hasOwn(muted, section) || !Number.isInteger(channel) || channel < 0 || channel >= muted[section].length || typeof value !== 'boolean') {
      throw new TypeError('Invalid Synth monitor mute');
    }
    muted[section][channel] = value;
    if (section === 'fm') restoreFm(channel);
    else if(section==='rhythm'){
      const register=0x18+channel,authored=registers[0][register];
      writePhysical(0,register,value?authored&63:authored);onRhythmLevel(register,authored);
    }
    else {
      const register = 8 + channel, authored = registers[0][register];
      writePhysical(0, register, value ? 0 : authored);
    }
  }
  return {
    write, setMute,
    stopFm() { for (let channel = 0; channel < 6; channel++) { stopped[channel] = true; restoreFm(channel); } },
    // Whole-chip reset retains UI mute choices, just as the host monitor does.
    reset() {
      registers.forEach(row => row.fill(0));registers[0].fill(0xdf,0x18,0x1e);stopped.fill(false);
      for(let ch=0;ch<6;ch++)if(muted.rhythm[ch]){
        writePhysical(0,0x18+ch,31);onRhythmLevel(0x18+ch,0xdf);
      }
    },
    receive(data) {
      if (data?.type !== 'synth-fm-ssg-monitor') return false;
      if (data.action === 'mute') setMute(data.section, data.channel, data.value);
      else if (data.action === 'stop-fm') this.stopFm();
      else throw new TypeError('Unknown FM/SSG monitor action');
      return true;
    },
    getState() { return {registers:registers.map(row => Array.from(row)),muted:{fm:[...muted.fm],ssg:[...muted.ssg],rhythm:[...muted.rhythm]},stopped:[...stopped]}; },
  };
}
