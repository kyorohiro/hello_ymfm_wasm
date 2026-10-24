/** Public createSoundChip/direct WASM PSG-family reference measurements. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSoundChip} from '../web/soundchip.js';
import {NesApuSynth, NesApuDirectTransport} from '../web/nesapusynth.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const kinds = ['segapsg', 'ay8910', 'nes'], frequencies = [220, 440, 880];
const sampleRates = [44100, 48000], referenceFrequencyHz = 440, sampleRate = 44100;
const warmupSeconds = .25, captureSeconds = 1;
const anchorReportPath = 'docs/issues/analyzer_psg_levels_01.json';
const previousPeakGains = Object.freeze({segapsg: .644089, ay8910: 1.545813, nes: 2});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function statistics(samples, rate) {
  let minimum = Infinity, maximum = -Infinity, sum = 0, squares = 0;
  for (const value of samples) {assert(Number.isFinite(value), 'Non-finite reference PCM'); minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); sum += value; squares += value * value;}
  const dc = sum / samples.length, rms = Math.sqrt(squares / samples.length), crossings = [];
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] <= dc && samples[i] > dc) crossings.push(i - 1 + (dc - samples[i - 1]) / (samples[i] - samples[i - 1]));
  assert(crossings.length > 100);
  return {minimum, maximum, peak: Math.max(Math.abs(minimum), Math.abs(maximum)), peakToPeak: maximum - minimum,
    amplitude: (maximum - minimum) / 2, dc, rms, acRms: Math.sqrt(Math.max(0, rms * rms - dc * dc)),
    measuredFrequencyHz: (crossings.length - 1) * rate / (crossings.at(-1) - crossings[0])};
}

/** Unmixed raw PCM through the public factory. No AudioContext or implicit output trim. */
export async function renderSoundChipPsgReference({kind, frequencyHz = 440, sampleRate: rate = 44100} = {}) {
  assert(kinds.includes(kind)); assert(frequencies.includes(frequencyHz)); assert(sampleRates.includes(rate));
  const options = {sampleRate: rate, ...(kind === 'ay8910' ? {type: 0, flags: 1} : kind === 'nes' ? {fds: false} : {})};
  const chip = await createSoundChip(kind, options);
  try {
    assert.equal(chip.sampleRate(), rate);
    if (kind === 'nes') assert.equal(chip.backend, 'wasm', 'npm NES measurement must use WASM, not the Analyzer JS reference');
    else assert(ArrayBuffer.isView(chip.module.HEAPF32), 'Public wrapper must contain real WASM PCM memory');
    let hardwareFrequencyHz, reference;
    const writes = [];
    if (kind === 'segapsg') {
      const clock = 3579545, period = Math.round(clock / (32 * frequencyHz));
      for (const value of [0x9f, 0xbf, 0xdf, 0xff, 0x80 | period & 15, period >> 4, 0x90]) {chip.write(value); writes.push({value});}
      hardwareFrequencyHz = clock / (32 * period);
      reference = {clock, period, waveform: 'square', channel: 0, attenuation: 0, otherChannels: 'silent'};
    } else if (kind === 'ay8910') {
      const clock = 1789773, period = Math.round(clock / (16 * frequencyHz));
      for (const [register, value] of [[0, period & 255], [1, period >> 8], [7, 0x3e], [8, 15], [9, 0], [10, 0]]) {chip.writeRegister(register, value); writes.push({register, value});}
      hardwareFrequencyHz = clock / (16 * period);
      reference = {clock, period, waveform: 'square', channel: 0, volume: 15, type: 0, flags: 1, envelope: false, noise: false, otherChannels: 'silent'};
    } else {
      const clock = chip.clock, direct = new NesApuDirectTransport(chip);
      const synth = new NesApuSynth({transport: {...direct, clock, fdsEnabled: false,
        writeRegister(address, value) {writes.push({address, value}); direct.writeRegister(address, value);},
        setChannelEnabled: direct.setChannelEnabled.bind(direct)}});
      synth.pulse.setVoice(0, {duty: .5, volume: 15, sweep: {enabled: false, period: 0, shift: 0, negate: false}});
      const timer = synth.pulse.setFrequency(0, frequencyHz); synth.pulse.keyOn(0);
      hardwareFrequencyHz = clock / (16 * (timer + 1));
      reference = {clock, timer, waveform: 'pulse', channel: 0, duty: .5, volume: 15, envelope: false, sweep: false, lengthHalt: true, fds: false, otherChannels: 'silent'};
    }
    chip.generateStereo(Math.round(rate * warmupSeconds));
    const pcm = chip.generateStereo(Math.round(rate * captureSeconds));
    assert.deepEqual(pcm.left, pcm.right, 'Centered reference must match on both outputs');
    const metrics = statistics(pcm.left, rate);
    assert(metrics.acRms > .005, 'Reference must have audible AC');
    assert(Math.abs(metrics.measuredFrequencyHz / hardwareFrequencyHz - 1) < .001, 'Incorrect reference pitch');
    return {kind, frequencyHz, sampleRate: rate, canonical: rate === sampleRate, backend: 'wasm',
      frames: pcm.left.length, hardwareFrequencyHz, reference, writes, metrics, pcm};
  } finally {chip.dispose();}
}

export async function measureSoundChipPsgLevels() {
  const baseline = JSON.parse(await readFile(resolve(root, anchorReportPath)));
  assert.equal(baseline.passed, true); assert.equal(baseline.sampleRate, sampleRate);
  const {id, gain, unityAcRms, targetAcRms} = baseline.reference;
  assert.equal(id, 'ym2608'); assert.equal(gain, 1.03357);
  assert(Math.abs(targetAcRms - .09108396077488734) < 1e-12);
  const rows = [];
  for (const rate of sampleRates) for (const frequencyHz of [440, 220, 880]) for (const kind of kinds) {
    const {pcm, metrics, ...row} = await renderSoundChipPsgReference({kind, frequencyHz, sampleRate: rate});
    rows.push({...row, rawAcRms: metrics.acRms, amplitude: metrics.amplitude, rawDc: metrics.dc,
      rawPeakToPeak: metrics.peakToPeak, unity: metrics, downstreamTrim: 1, previousRawGain: previousPeakGains[kind]});
    console.log(`${kind} ${rate} Hz / ${frequencyHz} Hz: raw AC RMS ${metrics.acRms.toFixed(12)}, candidate ${(targetAcRms / metrics.acRms).toFixed(6)}`);
  }
  const defaults = Object.fromEntries(kinds.map(kind => {
    const row = rows.find(item => item.kind === kind && item.frequencyHz === referenceFrequencyHz && item.canonical);
    const gain = Number((targetAcRms / row.rawAcRms).toFixed(6));
    assert(gain > 0 && gain <= 2, `${kind}: measured gain exceeds Mixer range; do not clamp`);
    return [kind, gain];
  }));
  for (const row of rows) row.after = {rawGain: defaults[row.kind], acRms: row.rawAcRms * defaults[row.kind],
    ratioToTarget: row.rawAcRms * defaults[row.kind] / targetAcRms, relativeToPrevious: defaults[row.kind] / row.previousRawGain};
  const paths = ['scripts/measure_soundchip_psg_levels.mjs', anchorReportPath, 'web/soundchip.js', 'web/soundchip_factory.js',
    'web/segapsg.js', 'web/ay8910.js', 'web/nesapu.js', 'web/nesapu_wasm.js', 'web/nesapusynth.js',
    ...['segapsg', 'ay8910', 'nesapu'].map(name => `docs/generated/${name}_wasm.wasm`)];
  const sources = Object.fromEntries(await Promise.all(paths.map(async path => [path, sha256(await readFile(resolve(root, path)))])));
  return {schemaVersion: 1, passed: true, sampleRate, referenceFrequencyHz, frequencies, comparisonSampleRates: sampleRates,
    warmupSeconds, captureSeconds, maximumGain: 2,
    reference: {id, gain, unityAcRms, targetAcRms, sourceReport: anchorReportPath},
    method: 'Public createSoundChip/direct WASM output, one steady full-level channel, 44100/48000Hz; AC RMS with DC removed. No output Mixer/master/FX or audio device. Only canonical44100Hz/440Hz rows derive fixed six-decimal defaults.',
    normalization: 'None during PCM generation. Defaults are output-policy fallbacks, not modifications to raw generateStereo(). The separate npm Worklet endpoint gain (default .25) remains outside this reference.',
    limitations: ['Only segapsg, normalized AY type0 flags1 and NES WASM pulse50% are measured; no other chip/engine or internal OPN FM/SSG/ADPCM/rhythm gain is changed.',
      'AY flags0/other models retain their native DAC law and are not separately RMS normalized. NES pulse/TND nonlinear mixing, other duties, FDS and DMC do not receive separate gains.',
      'Analyzer NES uses a separate JavaScript renderer: its1.512236 gain is not reused. Public npm async NES factory is explicitly checked for backend wasm.',
      'Steady AC RMS is not perceived loudness, music/track normalization, envelope weighting, polyphony correction or limiting. 48000Hz and220/880Hz captures are response comparisons only.'],
    defaults, sources, rows};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await measureSoundChipPsgLevels();
  if (process.argv.length > 2) {assert.equal(process.argv.length, 4, 'Usage: node scripts/measure_soundchip_psg_levels.mjs [--out report.json]'); assert.equal(process.argv[2], '--out'); await writeFile(resolve(process.argv[3]), `${JSON.stringify(report, null, 2)}\n`);}
  console.log(`PASS: public WASM PSG AC-RMS defaults ${JSON.stringify(report.defaults)}; ${report.rows.length} captures.`);
}
