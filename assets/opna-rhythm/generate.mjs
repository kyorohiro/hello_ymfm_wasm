import {writeFile, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

export const VOICES = Object.freeze([
  {name:'bassDrum', start:0x0000, length:448, divisor:432, seed:0x12345678, peak:1500},
  {name:'snare', start:0x01c0, length:640, divisor:432, seed:0x23456789, peak:1300},
  {name:'cymbal', start:0x0440, length:5952, divisor:432, seed:0x3456789a, peak:1000},
  {name:'hiHat', start:0x1b80, length:384, divisor:432, seed:0x456789ab, peak:1000},
  {name:'tom', start:0x1d00, length:640, divisor:864, seed:0x56789abc, peak:1400},
  {name:'rimShot', start:0x1f80, length:128, divisor:864, seed:0x6789abcd, peak:1100},
]);
const STEPS = [16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,80,88,97,107,118,130,143,157,173,190,209,230,253,279,307,337,371,408,449,494,544,598,658,724,796,876,963,1060,1166,1282,1411,1552];
const STEP_CHANGES = [-1,-1,-1,-1,2,5,7,9];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function encodeAdpcmA(samples) {
  if (samples.length % 2) throw new RangeError('ADPCM-A requires an even sample count');
  const bytes = new Uint8Array(samples.length / 2);
  let accumulator = 0, stepIndex = 0;
  for (let index = 0; index < samples.length; index++) {
    const target = samples[index];
    if (!Number.isFinite(target) || target < -2048 || target > 2047) throw new RangeError('Expected signed 12-bit PCM');
    let bestCode = 0, bestValue = 0, bestError = Infinity;
    for (let code = 0; code < 16; code++) {
      const delta = Math.floor((2 * (code & 7) + 1) * STEPS[stepIndex] / 8) * (code & 8 ? -1 : 1);
      const value = ((accumulator + delta + 2048) & 4095) - 2048;
      const error = Math.abs(target - value);
      if (error < bestError) { bestError = error; bestCode = code; bestValue = value; }
    }
    accumulator = bestValue;
    stepIndex = clamp(stepIndex + STEP_CHANGES[bestCode & 7], 0, 48);
    bytes[index >> 1] |= bestCode << (index % 2 ? 0 : 4);
  }
  return bytes;
}

export function synthesizeVoice(voice) {
  const rate = 8000000 / voice.divisor, count = voice.length * 2;
  const waveform = new Float64Array(count);
  let randomState = voice.seed, previousNoise = 0, lowNoise = 0;
  const noise = () => {
    randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5;
    return (randomState >>> 0) / 2147483648 - 1;
  };
  const sweep = (time, base, drop, decay) => Math.sin(2 * Math.PI * (base * time + drop * decay * (1 - Math.exp(-time / decay))));
  let peak = 0;
  for (let index = 0; index < count; index++) {
    const time = index / rate, random = noise();
    const highNoise = (random - previousNoise) * 0.5;
    previousNoise = random; lowNoise += 0.35 * (random - lowNoise);
    let value;
    switch (voice.name) {
      case 'bassDrum': value = sweep(time,62,155,0.006) * Math.exp(-time/0.016) + 0.10*highNoise*Math.exp(-time/0.0015); break;
      case 'snare': value = 0.8*(random-lowNoise)*Math.exp(-time/0.018) + 0.35*Math.sin(2*Math.PI*185*time)*Math.exp(-time/0.014); break;
      case 'cymbal': value = (0.60*highNoise + 0.18*Math.sin(2*Math.PI*3173*time) + 0.13*Math.sin(2*Math.PI*4637*time) + 0.09*Math.sin(2*Math.PI*6191*time))*Math.exp(-time/0.14); break;
      case 'hiHat': value = (0.75*highNoise + 0.25*Math.sin(2*Math.PI*6323*time))*Math.exp(-time/0.009); break;
      case 'tom': value = (sweep(time,125,95,0.018) + 0.18*Math.sin(2*Math.PI*287*time))*Math.exp(-time/0.033); break;
      case 'rimShot': value = (Math.sin(2*Math.PI*780*time) + 0.55*Math.sin(2*Math.PI*1733*time) + 0.25*highNoise)*Math.exp(-time/0.004); break;
      default: throw new Error('Unknown rhythm voice');
    }
    const attack = Math.min(1,index / Math.max(1,rate*0.0003));
    const remaining = count - 1 - index;
    const fade = clamp((remaining - 32) / Math.max(1,count * 0.15), 0, 1);
    waveform[index] = value * attack * fade * fade;
    peak = Math.max(peak,Math.abs(waveform[index]));
  }
  return Int16Array.from(waveform, value => Math.round(value * voice.peak / peak));
}

export function generateRhythmRom() {
  const rom = new Uint8Array(8192);
  for (const voice of VOICES) rom.set(encodeAdpcmA(synthesizeVoice(voice)),voice.start);
  return rom;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = new URL('../../web/tetorica_ym2608_adpcm_rom.bin',import.meta.url), bytes = generateRhythmRom();
  if (process.argv.includes('--check')) {
    if (!Buffer.from(bytes).equals(await readFile(target))) throw new Error('Generated rhythm ROM differs from checked-in data');
  } else await writeFile(target,bytes);
  console.log(`${process.argv.includes('--check') ? 'Verified' : 'Wrote'} ${fileURLToPath(target)} (${bytes.length} bytes)`);
  console.log(`SHA-256 ${createHash('sha256').update(bytes).digest('hex')}`);
}
