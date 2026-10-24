/** Analyzer-only AC-RMS defaults for standalone PSG-family sources. No app edits. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NesApuSynth} from '../docs/js/nesapusynth.js';
import {makePsgBalanceReference, renderPsgBalanceReference} from './measure_analyzer_psg_balance.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sampleRate = 44100, referenceFrequencyHz = 440, anchorGain = 1.03357;
const frequencies = [220, 440, 880], ids = ['psg', 'ay8910', 'nesApu'];
const AY_CLOCK = 1789773, NES_CLOCK = 1789773;
// Historical peak-based defaults, recorded as comparison metadata only.
// Do not read the mutable runtime policy while deriving the new unity baseline.
const previousPeakGains = Object.freeze({psg: .644089, ay8910: 1.545813, nesApu: 1.981272});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function mixedVgm(commands, clocks, flags = {}) {
  commands = [...commands, 0x61, 0x44, 0xac, 0x61, 0x44, 0xac, 0x66];
  const bytes = new Uint8Array(256 + commands.length), view = new DataView(bytes.buffer);
  bytes.set([86, 103, 109, 32]);
  for (const [offset, value] of [[4, bytes.length - 4], [8, 0x171], [0x18, 88200], [0x34, 0xcc],
    [0x2c, 7670454], [0x0c, 3579545], [0x48, 8000000], ...clocks]) view.setUint32(offset, value, true);
  for (const [offset, value] of Object.entries(flags)) bytes[Number(offset)] = value;
  bytes.set(commands, 256);
  return bytes;
}

/** Original two-second VGM. Unused chips/sections are muted by the renderer.
 * @param {'psg'|'ay8910'|'nesApu'} id @param {number} frequencyHz
 * @param {{ayFlags?:0|1}} [options]
 */
export function makeAnalyzerPsgLevelReference(id, frequencyHz, {ayFlags = 1} = {}) {
  assert(ids.includes(id)); assert(frequencies.includes(frequencyHz)); assert([0, 1].includes(ayFlags));
  if (id === 'psg') return {...makePsgBalanceReference('sega-psg', frequencyHz), id, canonical: true,
    variant: 'Sega tone0, attenuation0, remaining channels silent'};
  const commands = [];
  let hardwareFrequencyHz, variant, clocks, flags;
  if (id === 'ay8910') {
    const period = Math.round(AY_CLOCK / (16 * frequencyHz));
    for (const [register, value] of [[0, period & 255], [1, period >> 8], [7, 0x3e], [8, 15], [9, 0], [10, 0]]) commands.push(0xa0, register, value);
    hardwareFrequencyHz = AY_CLOCK / (16 * period);
    clocks = [[0x74, AY_CLOCK]]; flags = {0x78: 0, 0x79: ayFlags};
    variant = `AY type0 flags${ayFlags}, toneA fixed15, no noise/envelope`;
  } else {
    const synth = new NesApuSynth({transport: {clock: NES_CLOCK, fdsEnabled: false,
      writeRegister(address, value) {commands.push(0xb4, address - 0x4000, value);}}});
    synth.pulse.setVoice(0, {duty: .5, volume: 15, sweep: {enabled: false, period: 0, shift: 0, negate: false}});
    const timer = synth.pulse.setFrequency(0, frequencyHz); synth.pulse.keyOn(0);
    hardwareFrequencyHz = NES_CLOCK / (16 * (timer + 1));
    clocks = [[0x84, NES_CLOCK]]; flags = {};
    variant = 'Analyzer JSNES pulse1, duty50%, fixed15, sweep off, length halt; all other channels/FDS silent';
  }
  return {id, source: id, section: id, frequencyHz, hardwareFrequencyHz, downstreamTrim: 1,
    canonical: id !== 'ay8910' || ayFlags === 1, variant, ...(id === 'ay8910' ? {ayType: 0, ayFlags} : {}),
    bytes: mixedVgm(commands, clocks, flags)};
}

/** Actual Analyzer engine, explicit unity strip/master, one steady second after .25s warmup. */
export async function measureAnalyzerPsgLevelReference(id, frequencyHz, options = {}) {
  const reference = makeAnalyzerPsgLevelReference(id, frequencyHz, options);
  const rendered = await renderPsgBalanceReference(reference, {gain: 1});
  const unity = rendered.metrics, trim = reference.downstreamTrim;
  assert.equal(rendered.pcm.sampleRate, sampleRate);
  assert(unity.acRms > .005, `${id}: audible AC reference required`);
  assert(Math.abs(unity.measuredFrequencyHz / reference.hardwareFrequencyHz - 1) < .001, `${id}: incorrect frequency`);
  return {id, frequencyHz, sampleRate, canonical: reference.canonical, variant: reference.variant,
    ...(id === 'ay8910' ? {ayType: reference.ayType, ayFlags: reference.ayFlags} : {}),
    hardwareFrequencyHz: reference.hardwareFrequencyHz, downstreamTrim: trim,
    // Unity Mixer still contains Genesis's historical .35 trim. Divide only
    // that known downstream trim to derive a reusable standalone-core default.
    rawAcRms: unity.acRms / trim, amplitude: unity.amplitude / trim, rawDc: unity.dc / trim,
    rawRms: unity.rms / trim, rawPeakToPeak: unity.peakToPeak / trim,
    unity, previousMixerGain: Number((previousPeakGains[id] / trim).toFixed(6)),
    previousRawGain: previousPeakGains[id],
    referenceSha256: sha256(reference.bytes)};
}

export async function measureAnalyzerPsgLevels() {
  const fmReference = makePsgBalanceReference('ym2608-fm', referenceFrequencyHz);
  const ssgReference = makePsgBalanceReference('ym2608-ssg', referenceFrequencyHz);
  const fmUnity = await renderPsgBalanceReference(fmReference, {gain: 1});
  const fmAnchor = await renderPsgBalanceReference(fmReference, {gain: anchorGain});
  const ssgUnity = await renderPsgBalanceReference(ssgReference, {gain: 1});
  const ssgAnchor = await renderPsgBalanceReference(ssgReference, {gain: anchorGain});
  const targetAcRms = fmAnchor.metrics.acRms;
  assert(Math.abs(targetAcRms - .09108396077488734) < 1e-12, 'The unchanged OPNA FM reference must remain the calibration anchor');
  assert(Math.abs(ssgAnchor.metrics.acRms / fmAnchor.metrics.acRms - ssgUnity.metrics.acRms / fmUnity.metrics.acRms) < 1e-6,
    'The existing internal OPNA SSG/FM ratio must not change');
  const rows = [];
  for (const frequencyHz of [440, 220, 880]) for (const id of ids) {
    const row = await measureAnalyzerPsgLevelReference(id, frequencyHz);
    rows.push(row);
    console.log(`${id} ${frequencyHz} Hz: raw AC RMS ${row.rawAcRms.toFixed(12)}, candidate ${(targetAcRms / row.rawAcRms).toFixed(6)}`);
  }
  // Flags0 has a different analog/DAC output model. Record it without deriving
  // a separate default or changing that model's relationship to flags1.
  for (const frequencyHz of frequencies) rows.push(await measureAnalyzerPsgLevelReference('ay8910', frequencyHz, {ayFlags: 0}));
  const defaults = Object.fromEntries(ids.map(id => {
    const row = rows.find(item => item.id === id && item.frequencyHz === referenceFrequencyHz && item.canonical);
    const gain = Number((targetAcRms / row.rawAcRms).toFixed(6));
    assert(gain > 0 && gain <= 2, `${id}: derived gain exceeds Mixer range; do not clamp`);
    return [id, gain];
  }));
  for (const row of rows) {
    row.after = {rawGain: defaults[row.id], acRms: row.rawAcRms * defaults[row.id],
      amplitude: row.amplitude * defaults[row.id], ratioToTarget: row.rawAcRms * defaults[row.id] / targetAcRms,
      relativeToPrevious: defaults[row.id] / row.previousRawGain};
  }
  const paths = ['scripts/measure_analyzer_psg_levels.mjs', 'scripts/measure_analyzer_psg_balance.mjs',
    'docs/js/ym2608audioengine.js', 'docs/js/genesisaudioengine.js', 'docs/js/ay8910audioengine.js', 'docs/js/nesapuaudioengine.js',
    'docs/js/multichipaudioengine.js', 'docs/js/nesapusynth.js', 'docs/js/ym2608.js', 'docs/js/ay8910.js', 'docs/js/segapsg.js',
    'docs/js/soundchip_pitch.js', 'docs/js/soundchip_mixer.js', 'docs/js/vgmplayer.js',
    ...['ym2608', 'ym2612', 'segapsg', 'ay8910'].map(name => `docs/generated/${name}_wasm.wasm`),
    ...(await readdir(resolve(root, 'docs/js/nes_apu_vendor'))).filter(name => name.endsWith('.js')).map(name => `docs/js/nes_apu_vendor/${name}`)];
  const sources = Object.fromEntries(await Promise.all(paths.map(async path => [path, sha256(await readFile(resolve(root, path)))])));
  return {schemaVersion: 1, passed: true, sampleRate, referenceFrequencyHz, masterGain: 1, warmupSeconds: .25, captureSeconds: 1,
    reference: {id: 'ym2608', gain: anchorGain, unityAcRms: fmUnity.metrics.acRms, targetAcRms,
      fm: fmAnchor.metrics, ssgUnity: ssgUnity.metrics, ssgAtUnchangedGain: ssgAnchor.metrics,
      ssgToFmAcRms: ssgAnchor.metrics.acRms / fmAnchor.metrics.acRms},
    method: 'Steady single-voice AC RMS, with measured DC removed; actual Analyzer 44100Hz mixed graph, explicit unity source Mixer/master, no FX or device. Raw defaults remove only the reported downstream engine trim.',
    normalization: 'None during measurement. Fixed six-decimal defaults equal unchanged YM2608 FM reference AC RMS divided by canonical 440Hz raw AC RMS. No clipping, compression, automatic track gain or per-note processing.',
    limitations: ['Three standalone chip defaults only. Internal OPN FM/SSG/ADPCM/rhythm ratios and all npm/Playground presets are unchanged.',
      'AY canonical type0 flags1 matches the previous normalized-AY reference. Flags0 has a different resistor/DAC model and is a comparison only; its lower output is retained rather than boosted/clamped to the canonical target. No YM2149 variant calibration is implied.',
      'NES measures the Analyzer JavaScript pulse1 only; nonlinear pulse/TND mix, filters, other pulse duties and FDS/DMC do not receive separate gains.',
      'RMS matching a steady sine and square does not establish perceived equal loudness for arbitrary music, envelopes, channel counts or frequencies. 220/880 captures describe core response; gains are derived only at 440Hz.'],
    maximumGain: 2, defaults, sources, rows};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await measureAnalyzerPsgLevels();
  if (process.argv.length > 2) {assert.equal(process.argv.length, 4, 'Usage: node scripts/measure_analyzer_psg_levels.mjs [--out report.json]'); assert.equal(process.argv[2], '--out'); await writeFile(resolve(process.argv[3]), `${JSON.stringify(report, null, 2)}\n`);}
  console.log(`PASS: AC-RMS defaults ${JSON.stringify(report.defaults)}; OPNA FM/SSG ratio unchanged.`);
}
