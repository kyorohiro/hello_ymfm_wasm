// Host output controls for the independent reference engine. Source writes are
// retained here; the Live timeline, installed after this adapter, sees only the
// original song writes. No note-off, envelope, sample address or DAC data is
// changed to mute a channel. The checked SDK and its WASM ABI stay unchanged.
// Volumes use raw-source gain units, including the shared calibrated defaults.
import {SYNTH_SONG_MIX_DEFAULTS} from './synth_song_mix_defaults.js?v=mix-source-1';

const GROUPS = {ym2612:6, psg:4, pcm:8, pwm:2};
const VOLUME_GROUPS = new Set(['ym2612','psg','pcm','pwm']);
const validId = id => {
  const match = /^(ym2612|psg|pcm|pwm):(\d+)$/.exec(id);
  return match && Number(match[2]) < GROUPS[match[1]];
};

// Install on a fresh engine, before playback reset / source writes / timeline.
export function installSynthSongOutputMix(engine) {
  const original = {ym:engine.writeYm2612, pcm:engine.writeRf5c164, reset:engine.reset,
    ymGenerate:engine.ym2612?.generateStereo, psgGenerate:engine.psg?.generateStereo, pcmGenerate:engine.pcm?.generateStereo,
    pwmGenerate:engine.pwm?.generateStereo, pwmOutput:engine.pwm?.output};
  const initialPsgMask = engine.psg?.muteMask ?? 0;
  const ymPan = new Uint8Array(6), pcmPan = new Uint8Array(8);
  let masks = {ym2612:0, psg:0, pcm:0, pwm:0}, pcmChannel = 0, pcmControl = 0, disposed = false;
  const volumes = {...SYNTH_SONG_MIX_DEFAULTS};
  const rawYm = (...args) => original.ym?.call(engine, ...args);
  const rawPcm = (...args) => original.pcm?.call(engine, ...args);

  function writeYm(port, register, value) {
    if (register >= 0xb4 && register <= 0xb6) {
      const channel = port * 3 + register - 0xb4;
      ymPan[channel] = value;
      if (masks.ym2612 & (1 << channel)) value &= 0x3f;
    }
    return rawYm(port, register, value);
  }
  function writePcm(register, value) {
    if (register === 7) {
      pcmControl = value;
      if (value & 0x40) pcmChannel = value & 7;
    } else if (register === 1) {
      pcmPan[pcmChannel] = value;
      if (masks.pcm & (1 << pcmChannel)) value = 0;
    }
    return rawPcm(register, value);
  }
  function applyYm() {
    for (let channel = 0; channel < 6; channel++) {
      rawYm(channel >= 3 ? 1 : 0, 0xb4 + channel % 3,
        masks.ym2612 & (1 << channel) ? ymPan[channel] & 0x3f : ymPan[channel]);
    }
  }
  function applyPcm() {
    if (!engine.pcm) return;
    const enabled = pcmControl & 0x80;
    for (let channel = 0; channel < 8; channel++) {
      rawPcm(7, enabled | 0x40 | channel);
      rawPcm(1, masks.pcm & (1 << channel) ? 0 : pcmPan[channel]);
    }
    // Memory-bank writes do not change the selected channel. Restore both, so
    // a subsequent envelope/pan write and banked RAM write keep their targets.
    rawPcm(7, enabled | 0x40 | pcmChannel);
    if (!(pcmControl & 0x40)) rawPcm(7, pcmControl);
  }
  function applyPsg(mask=masks.psg) {
    for (let channel = 0; channel < 4; channel++) engine.psg?.setChannelMuted?.(channel, Boolean(mask & (1 << channel)));
  }
  function reset(...args) {
    const result = original.reset.apply(this, args);
    ymPan.fill(0); pcmPan.fill(0); pcmChannel = pcmControl = 0;
    applyYm(); applyPcm(); applyPsg();
    return result;
  }
  function ymGenerate(frames) {
    const output = original.ymGenerate.call(this, frames);
    // ymfm models the YM2612's DC discontinuity even with both pan bits off.
    // Complete mute suppresses that residual output, while clocking the core.
    // GenesisAudioEngine applies its legacy .9/.35 balance after these
    // buffers. Cancel it so the controls use the shared raw-source units.
    return scaleOutput(output, volumes.ym2612 / .9, masks.ym2612 === 63);
  }
  function psgGenerate(frames) {
    return scaleOutput(original.psgGenerate.call(this, frames), volumes.psg / .35, masks.psg === 15);
  }
  function pcmGenerate(frames) {
    const output = original.pcmGenerate.call(this, frames);
    return scaleOutput(output, volumes.pcm, masks.pcm === 255);
  }
  function pwmGenerate(frames) {
    const output = scaleOutput(original.pwmGenerate.call(this, frames), volumes.pwm, false);
    if (masks.pwm & 1) output.left.fill(0);
    if (masks.pwm & 2) output.right.fill(0);
    return output;
  }
  function pwmOutput(...args) {
    const output = original.pwmOutput.apply(this, args);
    return [masks.pwm & 1 ? 0 : output[0] * volumes.pwm, masks.pwm & 2 ? 0 : output[1] * volumes.pwm];
  }
  engine.writeYm2612 = writeYm;
  if (original.pcm) engine.writeRf5c164 = writePcm;
  engine.reset = reset;
  if (original.ymGenerate) engine.ym2612.generateStereo = ymGenerate;
  if (original.psgGenerate) engine.psg.generateStereo = psgGenerate;
  if (original.pcmGenerate) engine.pcm.generateStereo = pcmGenerate;
  if (original.pwmGenerate) engine.pwm.generateStereo = pwmGenerate;
  if (original.pwmOutput) engine.pwm.output = pwmOutput;

  return {
    saveState() {
      if(disposed)throw new Error('Reference output mixer is disposed');
      return {version:1,ymPan:ymPan.slice(),pcmPan:pcmPan.slice(),pcmChannel,pcmControl};
    },
    loadState(state) {
      if(disposed)throw new Error('Reference output mixer is disposed');
      if(state?.version!==1)throw new TypeError('Invalid reference output state');
      const bytes=(value,length)=>{
        if((!Array.isArray(value)&&!ArrayBuffer.isView(value))||value.length!==length)throw new TypeError('Invalid reference output pan state');
        return Array.from(value,item=>{
          if(!Number.isInteger(item)||item<0||item>255)throw new RangeError('Invalid reference output pan byte');
          return item;
        });
      };
      const nextYm=bytes(state.ymPan,6),nextPcm=bytes(state.pcmPan,8);
      if(!Number.isInteger(state.pcmChannel)||state.pcmChannel<0||state.pcmChannel>7||!Number.isInteger(state.pcmControl)||state.pcmControl<0||state.pcmControl>255)throw new RangeError('Invalid reference PCM selection state');
      // The native checkpoint already contains the masked hardware pan. Only
      // restore original source shadows here; writing registers would create
      // false Live events or replace the saved native channel/bank selection.
      ymPan.set(nextYm);pcmPan.set(nextPcm);pcmChannel=state.pcmChannel;pcmControl=state.pcmControl;
    },
    setGroupVolume(id, gain) {
      if (disposed) throw new Error('Reference output mixer is disposed');
      if (!VOLUME_GROUPS.has(id)) throw new RangeError(`Invalid playback volume group: ${id}`);
      if (typeof gain !== 'number' || !Number.isFinite(gain) || gain < 0 || gain > 3.8) throw new RangeError('Playback group volume must be a number in range 0..3.8');
      volumes[id] = gain;
      return gain;
    },
    setMutedChannels(ids) {
      if (disposed) throw new Error('Reference output mixer is disposed');
      const next = {ym2612:0, psg:0, pcm:0, pwm:0};
      for (const id of ids) {
        if (typeof id !== 'string' || !validId(id)) throw new RangeError(`Invalid playback channel: ${id}`);
        const [group, channel] = id.split(':');
        next[group] |= 1 << Number(channel);
      }
      const previous = masks;
      masks = next;
      if (next.ym2612 !== previous.ym2612) applyYm();
      if (next.pcm !== previous.pcm) applyPcm();
      if (next.psg !== previous.psg) applyPsg();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      masks = {ym2612:0, psg:0, pcm:0, pwm:0};
      applyYm(); applyPcm(); applyPsg(initialPsgMask);
      if (engine.writeYm2612 === writeYm) engine.writeYm2612 = original.ym;
      if (engine.writeRf5c164 === writePcm) engine.writeRf5c164 = original.pcm;
      if (engine.reset === reset) engine.reset = original.reset;
      if (engine.ym2612?.generateStereo === ymGenerate) engine.ym2612.generateStereo = original.ymGenerate;
      if (engine.psg?.generateStereo === psgGenerate) engine.psg.generateStereo = original.psgGenerate;
      if (engine.pcm?.generateStereo === pcmGenerate) engine.pcm.generateStereo = original.pcmGenerate;
      if (engine.pwm?.generateStereo === pwmGenerate) engine.pwm.generateStereo = original.pwmGenerate;
      if (engine.pwm?.output === pwmOutput) engine.pwm.output = original.pwmOutput;
    },
  };
}

// All three chip generateStereo APIs return owned copies, not native heap
// views. Scaling these copies cannot change oscillator/sample/resampler state.
// Skip multiplication when this output boundary already has the desired gain.
function scaleOutput(output, gain, muted) {
  if (muted || gain === 0) {output.left.fill(0); output.right.fill(0);}
  else if (gain !== 1) {
    for (let frame = 0; frame < output.left.length; frame++) output.left[frame] *= gain;
    if (output.right !== output.left) {
      for (let frame = 0; frame < output.right.length; frame++) output.right[frame] *= gain;
    }
  }
  return output;
}
