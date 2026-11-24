// SPDX-License-Identifier: BSD-3-Clause
import {FM_PRESETS} from '../js/megasynth-fm-presets.js';
import {visitAdpcmBFrames} from '../js/adpcm_b_sample.js';

export {FM_PRESETS};
export const PRESET_FORMAT = 'tetorica-fm2608-synth';
export const MAX_ADPCM_BYTES = 0x200000;
export const OPERATOR_DEFAULTS = Object.freeze({dt:0,multi:1,tl:127,rs:0,ar:31,am:false,d1r:0,d2r:0,sl:0,rr:10,ssg:0});
export const RHYTHM_NAMES = Object.freeze(['Bass drum','Snare','Cymbal','Hi-hat','Tom','Rim shot']);
let checkedSample = null;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}
function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${label} must be ${min}–${max}`);
  return value;
}
function boolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}
function list(value, length, label) {
  if (!Array.isArray(value) || value.length !== length) throw new RangeError(`${label} requires ${length} entries`);
  for (let index = 0; index < length; index++) if (!Object.hasOwn(value,index)) throw new RangeError(`${label} contains a missing entry`);
  return value;
}

export function encodeBase64(bytes) {
  let result = '';
  for (let start = 0; start < bytes.length; start += 0x8000) result += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(result);
}
export function decodeBase64(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_ADPCM_BYTES / 3) * 4 ||
      value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new TypeError('ADPCM-B data must be canonical base64');
  }
  const raw = atob(value), bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
  if (bytes.length < 32 || bytes.length > MAX_ADPCM_BYTES || bytes.length % 32) throw new RangeError('ADPCM-B data must contain 32-byte aligned packets within 2 MiB');
  if (encodeBase64(bytes) !== value) throw new TypeError('ADPCM-B data must be canonical base64');
  return bytes;
}

/** Preview the encoded hardware sample, including its addressing padding. */
export function decodeAdpcm(value) {
  const bytes = typeof value === 'string' ? decodeBase64(value) : value;
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected ADPCM-B bytes');
  const result = new Float32Array(bytes.length * 2);
  visitAdpcmBFrames(bytes, (sample, index) => { result[index] = sample; });
  return result;
}

export function readFmPreset(value) {
  object(value, 'FM preset');
  const pan = object(value.pan ?? {left:true,right:true}, 'FM pan');
  return {
    algorithm: integer(value.algorithm,0,7,'Algorithm'),
    feedback: integer(value.feedback,0,7,'Feedback'),
    ams: integer(value.ams ?? pan.ams ?? 0,0,3,'AMS'),
    pms: integer(value.pms ?? pan.pms ?? 0,0,7,'PMS'),
    keyMask: integer(value.keyMask ?? 15,0,15,'Operator key mask'),
    pan: {left:boolean(pan.left,'FM left'),right:boolean(pan.right,'FM right')},
    operators: list(value.operators,4,'FM operators').map((input,index) => {
      object(input, 'Operator');
      const operator = {...OPERATOR_DEFAULTS,...input}, result = {};
      for (const [key,max] of [['dt',7],['multi',15],['tl',127],['rs',3],['ar',31],['d1r',31],['d2r',31],['sl',15],['rr',15],['ssg',15]]) {
        result[key] = integer(operator[key],0,max,`OP${index + 1} ${key}`);
      }
      result.am = boolean(operator.am,'AM');
      return result;
    }),
  };
}

export function waveShape(shape, length = 128) {
  if (!['sine','triangle','saw','square'].includes(shape)) throw new RangeError('Unknown wave shape');
  integer(length,64,MAX_ADPCM_BYTES * 2,'Wave length');
  return Array.from({length},(_,index) => {
    const phase = index / length;
    // ADPCM-B resets its predictor and step on Key On and each Repeat. Start
    // this continuous cycle at zero, rather than asking the fresh decoder to
    // jump immediately to -0.6. This is only a phase rotation of generated PCM.
    const trianglePhase = (phase + .25) % 1;
    return .6 * (shape === 'sine' ? Math.sin(phase * Math.PI * 2) : shape === 'triangle' ? 1 - 4 * Math.abs(trianglePhase - .5) : shape === 'saw' ? phase * 2 - 1 : phase < .5 ? 1 : -1);
  });
}

/** Encode only this app's generated 128-point, amplitude-0.6 Sine cycle.
 * The caller must opt in for generated Sine; imported/drawn PCM keeps the
 * shared encoder. Return null when resampling would change the cycle length.
 * Float32 conversion and interpolation match encodeAdpcmB, so quantized chip
 * rates do not introduce a separate pitch, amplitude or display correction.
 */
export function encodeGeneratedSine({channels,sampleRate},outputRate) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(outputRate) || outputRate <= 0 ||
      !Array.isArray(channels) || channels.length !== 1 || channels[0]?.length !== 128 ||
      Math.round(128 * outputRate / sampleRate) !== 128) return null;
  const sine = Float32Array.from(waveShape('sine'));
  if (!sine.every((value,index) => value === Math.fround(channels[0][index]))) return null;
  const bytes = new Uint8Array(64), scales = [57,57,57,57,77,102,128,153];
  let predictor = 0, step = 127;
  for (let index = 0; index < 128; index++) {
    const position = Math.min(index * sampleRate / outputRate,127);
    const first = Math.floor(position), fraction = position - first;
    const value = sine[first] * (1 - fraction) + sine[Math.min(first + 1,127)] * fraction;
    const target = Math.round(value * (value < 0 ? 32768 : 32767));
    // Greedy encoding at zero chooses code0 and cannot follow the first rise.
    // Code6 grows step127 to254 with a small206/32768 initial offset. A bounded
    // first-code/Repeat-tail comparison gave the smallest maximum cycle error.
    // Repeat resets the decoder before decoding its final nibble. End with
    // code3: the largest rising code that leaves that reset step at127. A
    // freshly decoded preview alone would prefer code4 and distort Repeat.
    const forced = index === 0 ? 6 : index === 127 ? 3 : null;
    let best = 0, bestValue = 0, error = Infinity;
    for (let code = forced ?? 0; code <= (forced ?? 15); code++) {
      const delta = Math.floor((2 * (code & 7) + 1) * step / 8) * (code & 8 ? -1 : 1);
      const decoded = Math.max(-32768,Math.min(32767,predictor + delta));
      if (Math.abs(decoded - target) < error) { best = code; bestValue = decoded; error = Math.abs(decoded - target); }
    }
    bytes[index >> 1] |= best << (index & 1 ? 0 : 4);
    predictor = bestValue;
    step = Math.max(127,Math.min(24576,Math.floor(step * scales[best & 7] / 64)));
  }
  return {bytes,frames:128,paddedFrames:128,sampleRate:outputRate};
}

export function createDefaultPreset() {
  const rootNote = 60, sampleRate = 440 * 2 ** ((rootNote - 69) / 12) * 128;
  const encoded = encodeGeneratedSine({channels:[Float32Array.from(waveShape('sine'))],sampleRate},sampleRate);
  const voice = readFmPreset(FM_PRESETS['two-op-bell']);
  return {
    format:PRESET_FORMAT,version:1,name:'OPNA Bell',
    fm:Array.from({length:6},() => structuredClone(voice)),
    channel3:{mode:'normal',timerA:512,frequencies:[256,512,768,1024].map(fnum => ({block:4,fnum}))},
    lfo:{enabled:false,frequency:0},
    ssg:{channels:Array.from({length:3},() => ({tone:true,noise:false,volume:10,envelope:false})),noisePeriod:16,envelopePeriod:512,envelopeShape:10},
    rhythm:{volume:48,voices:Array.from({length:6},() => ({volume:24,left:true,right:true}))},
    adpcm:{data:encodeBase64(encoded.bytes),address:0,start:0,end:encoded.bytes.length,sampleRate,rootNote,volume:192,left:true,right:true,repeat:true},
  };
}

/** Return a portable clone after validating every hardware field. */
export function readPreset(input) {
  const value = typeof input === 'string' ? JSON.parse(input) : input;
  object(value,'OPNA preset');
  if (value.format !== PRESET_FORMAT || value.version !== 1) throw new Error('Unsupported FM2608 preset format/version');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120 || /[\u0000-\u001f\u007f]/.test(value.name)) throw new TypeError('Preset name must contain 1–120 printable characters');
  const lfo=object(value.lfo,'LFO'), ssg=object(value.ssg,'SSG'), rhythm=object(value.rhythm,'Rhythm'), adpcm=object(value.adpcm,'ADPCM-B');
  if (typeof adpcm.data !== 'string' || adpcm.data !== checkedSample) { decodeBase64(adpcm.data); checkedSample = adpcm.data; }
  if (!Number.isFinite(adpcm.sampleRate) || adpcm.sampleRate <= 0 || adpcm.sampleRate > 8000000 / 144 * 65535 / 65536) throw new RangeError('ADPCM-B sample rate exceeds the YM2608 range');
  const channel3 = object(value.channel3 ?? {mode:'normal',timerA:512,frequencies:[256,512,768,1024].map(fnum => ({block:4,fnum}))},'CH3 mode');
  if (!['normal','special','csm'].includes(channel3.mode)) throw new RangeError('CH3 mode must be normal, special or csm');
  const byteLength = adpcm.data.length / 4 * 3 - (adpcm.data.endsWith('==') ? 2 : adpcm.data.endsWith('=') ? 1 : 0);
  const address = integer(adpcm.address ?? 0,0,MAX_ADPCM_BYTES - 32,'ADPCM-B memory address');
  const start = integer(adpcm.start ?? address,0,MAX_ADPCM_BYTES - 32,'ADPCM-B sample start');
  const end = integer(adpcm.end ?? address + byteLength,32,MAX_ADPCM_BYTES,'ADPCM-B sample end');
  if (address % 32 || start % 32 || end % 32 || start < address || end <= start || end > address + byteLength || address + byteLength > MAX_ADPCM_BYTES) {
    throw new RangeError('ADPCM-B range must be 32-byte aligned and inside the saved memory');
  }
  return {
    format:PRESET_FORMAT,version:1,name:value.name.trim(),
    fm:list(value.fm,6,'FM channels').map(readFmPreset),
    channel3:{mode:channel3.mode,timerA:integer(channel3.timerA,0,1023,'Timer A'),frequencies:list(channel3.frequencies,4,'CH3 frequencies').map(frequency => {
      object(frequency,'CH3 frequency');
      return {block:integer(frequency.block,0,7,'CH3 block'),fnum:integer(frequency.fnum,0,2047,'CH3 F-NUM')};
    })},
    lfo:{enabled:boolean(lfo.enabled,'LFO enable'),frequency:integer(lfo.frequency,0,7,'LFO frequency')},
    ssg:{channels:list(ssg.channels,3,'SSG channels').map(channel => {
      object(channel,'SSG channel');
      return {tone:boolean(channel.tone,'SSG tone'),noise:boolean(channel.noise,'SSG noise'),volume:integer(channel.volume,0,15,'SSG volume'),envelope:boolean(channel.envelope,'SSG envelope')};
    }),noisePeriod:integer(ssg.noisePeriod,0,31,'Noise period'),envelopePeriod:integer(ssg.envelopePeriod,0,65535,'Envelope period'),envelopeShape:integer(ssg.envelopeShape,0,15,'Envelope shape')},
    rhythm:{volume:integer(rhythm.volume,0,63,'Rhythm volume'),voices:list(rhythm.voices,6,'Rhythm voices').map(voice => {
      object(voice,'Rhythm voice');
      return {volume:integer(voice.volume,0,31,'Rhythm voice volume'),left:boolean(voice.left,'Rhythm left'),right:boolean(voice.right,'Rhythm right')};
    })},
    adpcm:{data:adpcm.data,address,start,end,sampleRate:adpcm.sampleRate,rootNote:integer(adpcm.rootNote,0,127,'Root note'),volume:integer(adpcm.volume,0,255,'ADPCM-B volume'),left:boolean(adpcm.left,'ADPCM-B left'),right:boolean(adpcm.right,'ADPCM-B right'),repeat:boolean(adpcm.repeat,'Repeat')},
  };
}
