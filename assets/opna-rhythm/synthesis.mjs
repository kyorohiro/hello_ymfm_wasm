export const VOICES = Object.freeze([
  {name:'bassDrum', start:0x0000, length:448, divisor:432, seed:0x12345678, peak:1500},
  {name:'snare', start:0x01c0, length:640, divisor:432, seed:0x23456789, peak:1300},
  {name:'cymbal', start:0x0440, length:5952, divisor:432, seed:0x3456789a, peak:1500},
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

export const PARAMETERS = Object.freeze({
  pitch: {label: '音程倍率', min: 0.25, max: 2, step: 0.01, value: 1},
  decay: {label: '減衰時間倍率', min: 0.2, max: 3, step: 0.01, value: 1},
  noise: {label: 'ノイズ量倍率', min: 0, max: 3, step: 0.01, value: 1},
  attack: {label: 'アタック時間 (ms)', min: 0, max: 5, step: 0.05, value: 0.3},
  level: {label: 'ピーク振幅倍率', min: 0, max: 1.3, step: 0.01, value: 1},
  firstPeak: {label: '最初の山の振幅倍率', min: 0, max: 1, step: 0.01, value: 0.45, voice: 'bassDrum'},
  noisePeaks: {label: 'ノイズを入れる山の数', min: 1, max: 6, step: 1, value: 4, voice: 'bassDrum'},
  snareFirstPeak: {label: '最初の山の振幅倍率', min: 0, max: 1, step: 0.01, value: 0.45, voice: 'snare'},
  snareSharpness: {label: '共鳴音の山の鋭さ（1＝正弦波）', min: 1, max: 4, step: 0.05, value: 1.8, voice: 'snare'},
  cymbalStrike: {label: '出だしの強打量', min: 0, max: 8, step: 0.1, value: 4, voice: 'cymbal'},
  cymbalStrikeMs: {label: '強打の減衰時間 (ms)', min: 0.2, max: 10, step: 0.1, value: 1, voice: 'cymbal'},
  hiHatDecayMs: {label: 'ハイハットの減衰時間 (ms)', min: 0.5, max: 80, step: 0.5, value: 18, voice: 'hiHat'},
  hiHatTail: {label: '後半に残すノイズ量（0〜0.8）', min: 0, max: 0.8, step: 0.01, value: 0.12, voice: 'hiHat'},
  tomFirstPeak: {label: '最初の山の振幅倍率', min: 0, max: 1, step: 0.01, value: 0.45, voice: 'tom'},
  tomNoisePeaks: {label: 'ノイズを入れる山の数', min: 1, max: 12, step: 1, value: 6, voice: 'tom'},
  tomDecayMs: {label: 'Tomの減衰時間 (ms)', min: 0.5, max: 150, step: 0.5, value: 48, voice: 'tom'},
  tomTail: {label: '後半に残す共鳴音の量（0〜0.8）', min: 0, max: 0.8, step: 0.01, value: 0.08, voice: 'tom'},
  rimGain: {label: '序盤のピーク強調倍率', min: 1, max: 3, step: 0.05, value: 1.8, voice: 'rimShot'},
  rimThreshold: {label: '強調する振幅の境界', min: 0, max: 1, step: 0.01, value: 0.2, voice: 'rimShot'},
  rimPeaks: {label: '強調する山の数', min: 1, max: 12, step: 1, value: 6, voice: 'rimShot'},
  rimTail: {label: '後半に残す共鳴・ノイズ量', min: 0, max: 0.8, step: 0.01, value: 0.12, voice: 'rimShot'},
});
export function rimPeakBoost(value, cycles, gain, threshold, peaks) {
  const weight = clamp((peaks - 0.5 - cycles), 0, 1);
  return value + Math.sign(value) * Math.max(0, Math.abs(value) - threshold) * (gain - 1) * weight;
}
export function firstCrestEnvelope(cycles, firstPeak) {
  const progress = clamp((cycles - 0.25) / 0.5, 0, 1);
  return firstPeak + (1 - firstPeak) * progress * progress * (3 - 2 * progress);
}
export function snareResonance(cycles, sharpness) {
  const sine = Math.sin(2 * Math.PI * cycles);
  return Math.sign(sine) * Math.abs(sine) ** sharpness;
}
// Phase is measured in cycles; positive crests occur at 0.25, 1.25, ... .
export function bassDrumEnvelope(cycles, firstPeak, noisePeaks) {
  const tone = firstCrestEnvelope(cycles, firstPeak);
  const noise = Math.max(0, 1 - cycles / (noisePeaks - 0.5)) ** 2;
  return {tone, noise};
}
export function defaultParameters() {
  return Object.fromEntries(Object.entries(PARAMETERS).map(([key, spec]) => [key, spec.value]));
}
export function synthesizeVoice(voice, settings = {}) {
  const params = {...defaultParameters(), ...settings};
  for (const [key, value] of Object.entries(params)) {
    const spec = PARAMETERS[key];
    if (!spec || !Number.isFinite(value) || value < spec.min || value > spec.max) throw new RangeError(`Invalid parameter: ${key}`);
  }
  const rate = 8000000 / voice.divisor, count = voice.length * 2;
  const waveform = new Float64Array(count);
  const rimTail = new Float64Array(count);
  let randomState = voice.seed, previousNoise = 0, lowNoise = 0;
  const noise = () => {
    randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5;
    return (randomState >>> 0) / 2147483648 - 1;
  };
  const sweep = (time, base, drop, decay) => Math.sin(2 * Math.PI * params.pitch * (base * time + drop * decay * (1 - Math.exp(-time / decay))));
  let peak = 0;
  for (let index = 0; index < count; index++) {
    const time = index / rate, random = noise() * params.noise;
    const highNoise = (random - previousNoise) * 0.5;
    previousNoise = random; lowNoise += 0.35 * (random - lowNoise);
    let value;
    switch (voice.name) {
      case 'bassDrum': {
        const cycles = params.pitch * (62 * time + 155 * 0.006 * (1 - Math.exp(-time / 0.006)));
        const envelope = bassDrumEnvelope(cycles, params.firstPeak, params.noisePeaks);
        value = Math.sin(2 * Math.PI * cycles) * envelope.tone * Math.exp(-time/(0.016 * params.decay))
          + 0.10 * highNoise * envelope.noise;
        break;
      }
      case 'snare': {
        const cycles = 185 * params.pitch * time;
        const envelope = firstCrestEnvelope(cycles, params.snareFirstPeak);
        value = envelope * (0.8*(random-lowNoise)*Math.exp(-time/(0.018 * params.decay))
          + 0.35*snareResonance(cycles, params.snareSharpness)*Math.exp(-time/(0.014 * params.decay)));
        break;
      }
      case 'cymbal': {
        const body = (0.60*highNoise + 0.18*Math.sin(2*Math.PI*3173*params.pitch*time) + 0.13*Math.sin(2*Math.PI*4637*params.pitch*time) + 0.09*Math.sin(2*Math.PI*6191*params.pitch*time));
        value = body * (Math.exp(-time/(0.14 * params.decay))
          + params.cymbalStrike * Math.exp(-time/(params.cymbalStrikeMs / 1000)));
        break;
      }
      case 'hiHat': {
        const envelope = Math.exp(-time / (params.hiHatDecayMs / 1000 * params.decay));
        // Retain a quiet noise bed until the fixed ROM-end fade, not a DC offset.
        value = 0.75 * highNoise * ((1 - params.hiHatTail) * envelope + params.hiHatTail)
          + 0.25 * Math.sin(2*Math.PI*6323*params.pitch*time) * envelope;
        break;
      }
      case 'tom': {
        const cycles = params.pitch * (125 * time + 95 * 0.018 * (1 - Math.exp(-time / 0.018)));
        const onset = firstCrestEnvelope(cycles, params.tomFirstPeak);
        const noiseEnvelope = Math.max(0, 1 - cycles / (params.tomNoisePeaks - 0.5)) ** 2;
        const envelope = (1 - params.tomTail) * Math.exp(-time/(params.tomDecayMs / 1000 * params.decay)) + params.tomTail;
        value = onset * ((Math.sin(2*Math.PI*cycles) + 0.18*Math.sin(2*Math.PI*287*params.pitch*time)) * envelope
          + 0.18 * highNoise * noiseEnvelope);
        break;
      }
      case 'rimShot': value = (Math.sin(2*Math.PI*780*params.pitch*time) + 0.55*Math.sin(2*Math.PI*1733*params.pitch*time) + 0.25*highNoise)*Math.exp(-time/(0.004 * params.decay)); break;
      default: throw new Error('Unknown rhythm voice');
    }
    const attack = Math.min(1,index / Math.max(1,rate*(params.attack / 1000)));
    const remaining = count - 1 - index;
    const fade = clamp((remaining - 32) / Math.max(1,count * (voice.name === 'hiHat' || voice.name === 'tom' ? 0.05 : 0.15)), 0, 1);
    waveform[index] = value * attack * fade * fade;
    if (voice.name === 'rimShot') {
      const tailFade = clamp((remaining - 8) / Math.max(1, count * 0.05), 0, 1);
      rimTail[index] = (0.6*Math.sin(2*Math.PI*780*params.pitch*time)
        + 0.4*Math.sin(2*Math.PI*1733*params.pitch*time) + 0.5*highNoise)
        * (1 - Math.exp(-time / 0.003)) * Math.exp(-time / (0.04 * params.decay))
        * tailFade * tailFade;
    }
    peak = Math.max(peak,Math.abs(waveform[index]));
  }
  return Int16Array.from(waveform, (value, index) => {
    let normalized = peak === 0 ? 0 : value / peak;
    if (voice.name === 'rimShot') {
      normalized = rimPeakBoost(normalized, 780 * params.pitch * index / rate,
        params.rimGain, params.rimThreshold, params.rimPeaks);
      normalized += rimTail[index] * params.rimTail;
    }
    return Math.round(clamp(normalized * voice.peak * params.level, -2048, 2047));
  });
}

export function generateRhythmRom(settings = {}) {
  const rom = new Uint8Array(8192);
  for (const voice of VOICES) rom.set(encodeAdpcmA(synthesizeVoice(voice, settings[voice.name])),voice.start);
  return rom;
}
