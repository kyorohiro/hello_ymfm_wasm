/** Deterministic public-API reference programs; no audio device or gain edits.
 * These measure output amplitude/DC, not perceived loudness. Hardware DAC,
 * codec, waveform and resampling differences remain part of the measurement.
 */
import {decodeBrr} from '../web/snes_brr.js';

export const PCM_CALIBRATION_KINDS = Object.freeze([
  'segapsg', 'ay8910', 'rf5c164', 'okim6258', 'gameboy', 'nes', 'huc6280', 'pwm', 'snes', 'spc',
]);

const SOURCE_ID = 'calibration-source';
const BRR_FRAMES = 64;
// Range12/filter0 decodes nibble n to n*4096. Quantize an amplitude-one
// signed sine into symmetric [-7,7]. Repeated -32768 decoded samples can
// wrap the accurate DSP gaussian interpolator; symmetric 7/8 headroom avoids
// that hardware pathology. The public BRR format cannot encode lossless PCM.
const brr = new Uint8Array(BRR_FRAMES / 16 * 9);
for (let block = 0; block < BRR_FRAMES / 16; block++) {
  brr[block * 9] = 0xc0 | (block === BRR_FRAMES / 16 - 1 ? 3 : 0);
  for (let sample = 0; sample < 16; sample++) {
    const frame = block * 16 + sample;
    const value = Math.max(-7, Math.min(7, Math.round(7 * Math.sin(2 * Math.PI * frame / BRR_FRAMES)))) & 15;
    brr[block * 9 + 1 + (sample >> 1)] |= value << (sample % 2 ? 0 : 4);
  }
}
const decoded = decodeBrr(brr);
const decodedReference = Object.freeze({
  inputPeak: 1,
  codecHeadroom: 7 / 8,
  decodedPeak: Math.max(...decoded.pcm.map(value => Math.abs(value))),
  decodedMean: decoded.pcm.reduce((sum, value) => sum + value, 0) / BRR_FRAMES,
  decodedRms: Math.sqrt(decoded.pcm.reduce((sum, value) => sum + value * value, 0) / BRR_FRAMES),
  samples: BRR_FRAMES,
});
const brrLiteral = `new Uint8Array(${JSON.stringify([...brr])})`;
const create = (kind, options = '') => `const chip=await createSoundChip(${JSON.stringify(kind)},{id:${JSON.stringify(SOURCE_ID)}${options}});\ncontext.calibrationSource=chip;`;
const stop = method => `await context.calibrationSource.${method};`;
const pcmSine = (frames, rate, frequency) => `Float32Array.from({length:${frames}},(_,i)=>Math.sin(2*Math.PI*${frequency}*i/${rate}))`;

/** @param {string} kind @param {number} [frequencyHz]
 * setup/stop are Playground source strings. The runner applies unity Mixer
 * gain externally, waits >=0.2s, and captures ~1s before teardown.
 */
export function buildPcmCalibrationReference(kind, frequencyHz = 440) {
  if (!PCM_CALIBRATION_KINDS.includes(kind)) throw new RangeError(`Unsupported PCM reference kind: ${kind}`);
  if (![220, 440, 880].includes(frequencyHz)) throw new RangeError('Reference frequency must be 220, 440 or 880 Hz');
  const f = frequencyHz;
  const reference = {kind, waveform: 'sine', frequencyHz: f, sourceId: SOURCE_ID, defaultCalibration: true,
    warmupSeconds: 0.2, captureSeconds: 1, setup: '', stop: '', noteInfo: '', limitations: []};
  switch (kind) {
    case 'segapsg':
      Object.assign(reference, {
        waveform: 'square',
        setup: `${create(kind)}\nawait chip.allNotesOff();\nawait chip.tone(0,{frequency:${f},attenuation:0});`,
        stop: stop('off(0)'),
        noteInfo: 'One tone channel, attenuation0, default clock and centered default routing; other tone/noise channels are silent.',
        limitations: ['Square-wave reference, not a sine. The hardware period quantizes the requested frequency.', 'One active channel measures its contribution to the four-channel PSG mix.'],
      });
      break;
    case 'ay8910':
      Object.assign(reference, {
        waveform: 'square',
        setup: `${create(kind)}\nawait chip.reset();\nawait chip.tone(0,{frequency:${f},volume:15,envelope:false});`,
        stop: stop('keyOff(0)'),
        noteInfo: 'AY channelA only, fixed level15, tone enabled, noise/envelope disabled; mono output is sent equally left/right.',
        limitations: ['Square-wave reference, not a sine; AY DAC baseline/DC and logarithmic level law are retained.', 'The default clock quantizes the 12-bit tone period.'],
      });
      break;
    case 'rf5c164':
      Object.assign(reference, {
        setup: `${create(kind)}\nconst wave=await chip.loadSample({sampleRate:${f * 256},channels:[${pcmSine(256, f * 256, f)}]},{loopStart:0});\nawait chip.setChannel(0,{...wave,volume:255,pan:{left:15,right:15}});\nawait chip.keyOn(0);`,
        stop: stop('keyOff(0)'),
        noteInfo: 'One256-sample looping sine, normalized input peak1, channel volume255 and both hardware pan levels15.',
        limitations: ['Public loadSample uses the standard sign-magnitude encoder (magnitude126, reserving0xff for END).', 'The fixed-point playback step and RF sample/hold path quantize frequency/output.'],
      });
      break;
    case 'okim6258':
      Object.assign(reference, {
        setup: `${create(kind)}\nawait chip.setDivider(512);\nawait chip.setPan(true,true);\nconst rate=chip.clock/512;\nconst pcm=${pcmSine('Math.round(rate*4)', 'rate', f)};\nawait chip.loadSample({sampleRate:rate,channels:[pcm]},{sampleRate:rate});\nawait chip.play({repeat:true});`,
        stop: stop('stop()'),
        noteInfo: 'One mono amplitude-one sine encoded by public loadSample, default8MHz/divider512 (15,625Hz), both output sides enabled.',
        limitations: ['OKI has no per-voice volume control; its standard12-bit predictor and lossy4-bit codec determine decoded peaks.', 'The four-second generated sample repeats; capture after warmup, before the first repeat seam.'],
      });
      break;
    case 'gameboy':
      Object.assign(reference, {
        setup: `${create(kind)}\nawait chip.initialize();\nfor(let ch=0;ch<4;ch++)await chip.keyOff(ch);\nawait chip.setMasterVolume(7,7);\nawait chip.setPan(2,true,true);\nawait chip.wave.setWaveform(Array.from({length:32},(_,i)=>Math.round(7.5+7.5*Math.sin(2*Math.PI*i/32))));\nawait chip.wave.setLevel(1);\nawait chip.wave.setFrequency(${f});\nawait chip.wave.keyOn();`,
        stop: stop('wave.keyOff()'),
        noteInfo: 'Wave channel only:32-sample4-bit sine spanning0..15, 100% wave level, NR50 left/right7, routing to both sides.',
        limitations: ['Measures the wave section, not pulse/noise; one kind default cannot independently calibrate those sections.', 'DMG DAC/analog filtering and4-bit quantization are retained; requested pitch is hardware-quantized.'],
      });
      break;
    case 'nes':
      Object.assign(reference, {
        waveform: 'square',
        setup: `${create(kind)}\nawait chip.reset();\nawait chip.pulse.setVoice(0,{duty:0.5,volume:15,sweep:{enabled:false,period:0,shift:0,negate:false}});\nawait chip.pulse.setFrequency(0,${f});\nawait chip.pulse.keyOn(0);`,
        stop: stop('pulse.keyOff(0)'),
        noteInfo: 'Default NES instance (FDS disabled), pulse1 only, 50% duty, constant volume15 and length halt; other APU channels are silent.',
        limitations: ['Square-wave reference, not a sine. Nonlinear NES pulse/TND mixing and analog filters remain part of its output.', 'This is the base NES mixer-kind reference; optional FDS and DMC do not receive independent gain defaults.'],
      });
      break;
    case 'huc6280':
      Object.assign(reference, {
        setup: `${create(kind)}\nawait chip.initialize();\nawait chip.allNotesOff();\nawait chip.setMasterVolume(15,15);\nawait chip.setLfo({frequency:0,depth:0});\nawait chip.setDda(0,false);\nawait chip.setWaveform(0,Array.from({length:32},(_,i)=>Math.round(15.5+15.5*Math.sin(2*Math.PI*i/32))));\nawait chip.setVolume(0,31);\nawait chip.setPan(0,15,15);\nawait chip.setFrequency(0,${f});\nawait chip.keyOn(0);`,
        stop: stop('keyOff(0)'),
        noteInfo: 'One32-sample5-bit sine spanning0..31; channel volume31, both per-channel/global balance15, LFO/noise/DDA disabled.',
        limitations: ['One wavetable channel of the six-channel output; hardware DAC centering, quantization and resampling are retained.'],
      });
      break;
    case 'pwm':
      Object.assign(reference, {
        sustainSeconds: 4,
        setup: `${create(kind)}\nawait chip.reset();\nconst state=await chip.getState(),cycle=1025,period=(cycle-1)*state.sampleRate/state.clock,tickRate=state.clock/(cycle-1);\nconst count=Math.ceil(tickRate*4)+2;\nconst writes=[{frame:0,register:1,value:cycle},{frame:0,register:0,value:5}];\nfor(let i=0;i<count;i++)writes.push({frame:i<2?0:Math.floor((i-1)*period),register:4,value:Math.round(cycle*(1+Math.sin(2*Math.PI*${f}*i/tickRate))/2)});\nawait chip.scheduleWrites(writes);`,
        stop: `await context.calibrationSource.clearSchedule();\nawait context.calibrationSource.reset();`,
        noteInfo: 'Default duty/gain1 output, cycle1025; the same0..1025 sine widths feed both physical FIFOs via register4, two values prefetched.',
        limitations: ['A four-second deterministic schedule, not an indefinite oscillator; capture within that horizon.', 'FIFO updates are quantized to output frames; duty-period integration and timer quantization are retained.', 'This checks the default duty path, not the alternate low-level DAC output mode.'],
      });
      break;
    case 'snes': {
      const pitch = Math.round(f * 4096 / (32000 / BRR_FRAMES));
      Object.assign(reference, {
        setup: `${create(kind)}\nconst sample=await chip.loadBRR(${brrLiteral},{baseFrequencyHz:${32000 / BRR_FRAMES},loopStartSamples:0});\nawait chip.setPreset(0,{sample,adsr1:0,adsr2:0,gain:127,volumeLeft:127,volumeRight:127,pitch:${pitch}});\nawait chip.keyOn(0);`,
        stop: stop('keyOff(0)'), decodedReference,
        noteInfo: `One looping64-sample BRR sine from normalized input peak1, directGAIN127, voice/masterL/R127, echo/noise/pitch modulation disabled; PITCH=${pitch} (~${pitch * 32000 / (4096 * BRR_FRAMES)}Hz).`,
        limitations: ['Public SNES instruments accept raw BRR rather than PCM. Original generated range12/filter0 BRR deliberately exposes codec quantization (decoded sample limits -0.875..0.875; symmetric headroom avoids the hardware Gaussian overflow at repeated -32768).', 'Gaussian interpolation and hardware envelope/main-volume scaling remain active; this is not a lossless unity-PCM source.'],
      });
      break;
    }
    case 'spc': {
      const pitch = Math.round(f * 4096 / (32000 / BRR_FRAMES));
      Object.assign(reference, {
        defaultCalibration: true,
        setup: `${create(kind)}\nconst bytes=new Uint8Array(0x10200);\nbytes.set(new TextEncoder().encode('SNES-SPC700 Sound File Data v0.30'));\nbytes.set([0x1a,0x1a,0x1b,30],0x21);\nbytes.set([0,2,0,0,0,0,0xef],0x25);\nconst ram=bytes.subarray(0x100,0x10100),dsp=bytes.subarray(0x10100,0x10180);\nram.set([0x2f,0xfe],0x200);\nram.set([0,0x20,0,0x20],0x1000);\nram.set(${brrLiteral},0x2000);\ndsp[0]=dsp[1]=dsp[7]=dsp[0x0c]=dsp[0x1c]=127;\ndsp[2]=${pitch & 255};dsp[3]=${pitch >> 8};dsp[0x4c]=1;dsp[0x5d]=0x10;dsp[0x6c]=0x20;\nawait chip.loadSPC(bytes);\nawait chip.play();`,
        stop: stop('stop()'), decodedReference,
        noteInfo: `Original generated SPC file: no IPL/game/music data, CPU only BRA-loops, one S-DSP voice with exactly the SNES reference BRR/gain/pitch (${pitch}).`,
        limitations: ['Calibrates the fixed SPC chip output unit with an original known sine, matching the SNES DSP reference. It does not normalize authored SPC file content, voice counts, main volume, echo or driver automation.', 'Same documented BRR quantization and S-DSP interpolation as the SNES reference; no claim of lossless unity PCM.'],
      });
      break;
    }
  }
  return reference;
}

export const createPcmCalibrationPrograms = (frequencyHz = 440) => PCM_CALIBRATION_KINDS.map(kind => buildPcmCalibrationReference(kind, frequencyHz));
