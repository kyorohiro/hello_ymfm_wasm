/** Reproducible steady FM/SSG/PSG comparisons through the actual Analyzer mixed graph. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {getNodePlaybackFactory} from '../cli/render.js';
import {Ym2612VGM} from '../docs/js/ym2612vgm.js';
import {opnPitchFromHz} from '../docs/js/soundchip_pitch.js';
import {createPlaybackEngine, createPlaybackPlayer} from '../docs/vgm_analyzer/playback_core.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const FM_CLOCK = 8000000, PSG_CLOCK = 3579545, WARMUP = .25, CAPTURE = 1;
const sections = ['ym2608-fm', 'ym2608-ssg', 'sega-psg'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Original full-level reference; no game data, rhythm ROM or external samples. */
export function makePsgBalanceReference(section, frequencyHz) {
  assert(sections.includes(section)); assert([220, 440, 880].includes(frequencyHz));
  const commands = [], write = (register, value) => commands.push(0x56, register, value);
  let hardwareFrequencyHz;
  // Standard prescale. All FM, SSG and secondary generators start silent.
  for (const [register, value] of [[0x27, 0], [0x22, 0], [0x29, 0x80], [7, 0x3f], [8, 0], [9, 0], [10, 0]]) write(register, value);
  for (const channel of [0, 1, 2, 4, 5, 6]) write(0x28, channel);
  if (section === 'ym2608-fm') {
    write(0xb0, 7); write(0xb4, 0xc0);
    for (const slot of [0, 8, 4, 12]) for (const [register, value] of [[0x30, 1], [0x40, slot === 12 ? 0 : 127], [0x50, 31], [0x60, 0], [0x70, 0], [0x80, 15], [0x90, 0]]) write(register + slot, value);
    const {block, fnum} = opnPitchFromHz(frequencyHz, FM_CLOCK);
    write(0xa4, block << 3 | fnum >> 8); write(0xa0, fnum & 255); write(0x28, 0x80);
    hardwareFrequencyHz = fnum * FM_CLOCK * 2 ** (block - 1) / (144 * 2 ** 20);
  } else if (section === 'ym2608-ssg') {
    // YM2608's effective SSG clock is master/4; one full fixed-volume square.
    const period = Math.round(FM_CLOCK / (64 * frequencyHz));
    write(0, period & 255); write(1, period >> 8); write(7, 0x3e); write(8, 15);
    hardwareFrequencyHz = FM_CLOCK / (64 * period);
  } else {
    const period = Math.round(PSG_CLOCK / (32 * frequencyHz));
    commands.push(...[0x9f, 0xbf, 0xdf, 0xff, 0x80 | period & 15, period >> 4, 0x90].flatMap(value => [0x50, value]));
    hardwareFrequencyHz = PSG_CLOCK / (32 * period);
  }
  commands.push(0x61, 0x44, 0xac, 0x61, 0x44, 0xac, 0x66); // Two seconds, no loop.
  const bytes = new Uint8Array(256 + commands.length), view = new DataView(bytes.buffer);
  bytes.set([86, 103, 109, 32]);
  for (const [offset, value] of [[4, bytes.length - 4], [8, 0x171], [0x18, 88200], [0x34, 0xcc], [0x2c, 7670454], [0x0c, PSG_CLOCK], [0x48, FM_CLOCK]]) view.setUint32(offset, value, true);
  bytes.set(commands, 256);
  return {section, frequencyHz, hardwareFrequencyHz, source: section === 'sega-psg' ? 'psg' : 'ym2608',
    gainUnits: 'source', downstreamTrim: 1, legacyEngineTrim: section === 'sega-psg' ? .35 : 1, bytes};
}

function metrics(samples, rate) {
  let minimum = Infinity, maximum = -Infinity, sum = 0, squares = 0;
  for (const value of samples) {assert(Number.isFinite(value)); minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); sum += value; squares += value * value;}
  const dc = sum / samples.length, rms = Math.sqrt(squares / samples.length);
  const crossings = [];
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] <= dc && samples[i] > dc) crossings.push(i - 1 + (dc - samples[i - 1]) / (samples[i] - samples[i - 1]));
  assert(crossings.length > 100, 'Reference must contain many full cycles');
  return {minimum, maximum, peak: Math.max(Math.abs(minimum), Math.abs(maximum)), peakToPeak: maximum - minimum,
    amplitude: (maximum - minimum) / 2, dc, rms, acRms: Math.sqrt(Math.max(0, rms * rms - dc * dc)),
    measuredFrequencyHz: (crossings.length - 1) * rate / (crossings.at(-1) - crossings[0])};
}

/** Exported for listening comparisons: unnormalized one-second steady PCM. */
export async function renderPsgBalanceReference(reference, {gain = undefined, warmupSeconds = WARMUP, captureSeconds = CAPTURE} = {}) {
  const engine = await createPlaybackEngine(new Ym2612VGM(reference.bytes), {getFactory: getNodePlaybackFactory});
  try {
    assert(engine.entries instanceof Map, 'All references must use the same mixed graph');
    const initialGain = engine.playbackMixer.get(reference.source).gain;
    for (const id of engine.playbackMixer.strips.keys()) engine.playbackMixer.set(id, {muted: id !== reference.source});
    if (gain !== undefined) engine.playbackMixer.set(reference.source, {gain});
    const player = createPlaybackPlayer(engine, reference.bytes), sampleRate = player.sampleRate();
    assert.equal(sampleRate, 44100);
    player.stop(); player.play();
    const warmup = Math.round(warmupSeconds * sampleRate), frames = Math.round(captureSeconds * sampleRate), count = warmup + frames;
    const left = new Float32Array(count), right = new Float32Array(count);
    for (let offset = 0; offset < count; offset += 4096) {const length = Math.min(4096, count - offset); player.process(left.subarray(offset, offset + length), right.subarray(offset, offset + length), length);}
    const pcm = {left: left.slice(warmup), right: right.slice(warmup), sampleRate};
    assert.deepEqual(pcm.left, pcm.right, 'Both hardware output sides must carry the same mono reference');
    return {pcm, gain: gain ?? initialGain, initialGain, gainUnits: 'source', metrics: metrics(pcm.left, sampleRate)};
  } finally {engine.dispose();}
}

export async function measureAnalyzerPsgBalance() {
  const rows = [];
  // Run A4 first so the requested comparison is visible before the full grid.
  for (const frequencyHz of [440, 220, 880]) for (const section of sections) {
    const reference = makePsgBalanceReference(section, frequencyHz);
    const unity = await renderPsgBalanceReference(reference, {gain: 1}), currentDefault = await renderPsgBalanceReference(reference);
    let maxScalingError = 0;
    for (let i = 0; i < unity.pcm.left.length; i++) maxScalingError = Math.max(maxScalingError, Math.abs(currentDefault.pcm.left[i] - unity.pcm.left[i] * currentDefault.gain));
    assert(maxScalingError < 2e-7, `${section}: output gain must occur once`);
    assert(unity.metrics.acRms > .005, `${section}: audible AC reference required`);
    assert(Math.abs(unity.metrics.measuredFrequencyHz / reference.hardwareFrequencyHz - 1) < .001, `${section}: incorrect frequency`);
    rows.push({section, frequencyHz, source: reference.source, waveform: section === 'ym2608-fm' ? 'sine' : 'square',
      sampleRate: unity.pcm.sampleRate, frames: unity.pcm.left.length, hardwareFrequencyHz: reference.hardwareFrequencyHz,
      masterGain: 1, gainUnits: 'source', downstreamTrim: reference.downstreamTrim,
      legacyEngineTrim: reference.legacyEngineTrim, defaultMixerGain: currentDefault.gain,
      unity: unity.metrics, currentDefault: currentDefault.metrics, maxScalingError,
      referenceSha256: digest(reference.bytes)});
    console.log(`${section} ${frequencyHz} Hz: unity AC RMS ${unity.metrics.acRms.toFixed(9)}, default ${currentDefault.metrics.acRms.toFixed(9)}, amplitude ${currentDefault.metrics.amplitude.toFixed(9)}`);
  }
  const comparisons = [220, 440, 880].map(frequencyHz => {
    const row = section => rows.find(item => item.section === section && item.frequencyHz === frequencyHz);
    const fm = row('ym2608-fm'), ssg = row('ym2608-ssg'), sega = row('sega-psg');
    const candidate = (target, raw) => ({gainUnits: 'source', rawCoreGain: target / raw, genesisMixerGain: target / raw,
      relativeToCurrentSegaDefault: target / raw / sega.defaultMixerGain, withinCurrentGenesisMixerLimit: target / raw <= 2});
    return {frequencyHz, ym2608GainAnchor: fm.defaultMixerGain,
      currentSsgToFmAcRms: ssg.currentDefault.acRms / fm.currentDefault.acRms,
      currentSegaToSsgAcRms: sega.currentDefault.acRms / ssg.currentDefault.acRms,
      matchYm2608SsgAcRms: candidate(ssg.currentDefault.acRms, sega.unity.acRms),
      matchYm2608SsgPeakToPeak: candidate(ssg.currentDefault.amplitude, sega.unity.amplitude),
      matchYm2608FmSineAcRms: candidate(fm.currentDefault.acRms, sega.unity.acRms)};
  });
  const paths = ['scripts/measure_analyzer_psg_balance.mjs', 'cli/render.js',
    'docs/vgm_analyzer/playback_core.js', 'docs/vgm_analyzer/playback_mixer.js', 'docs/vgm_analyzer/mixer_defaults.js',
    'docs/js/ym2608audioengine.js', 'docs/js/genesisaudioengine.js', 'docs/js/multichipaudioengine.js',
    'docs/js/ym2608.js', 'docs/js/ym2612.js', 'docs/js/segapsg.js', 'docs/js/soundchip_pitch.js', 'docs/js/vgmplayer.js', 'docs/js/soundchip_mixer.js',
    ...['ym2608', 'ym2612', 'segapsg'].flatMap(name => [`docs/generated/${name}_wasm.js`, `docs/generated/${name}_wasm.wasm`])];
  const sources = Object.fromEntries(await Promise.all(paths.map(async path => [path, digest(await readFile(resolve(root, path)))])));
  return {schemaVersion: 1, passed: true, gainUnits: 'source', referenceFrequencyHz: 440, sampleRate: 44100, masterGain: 1, warmupSeconds: WARMUP, captureSeconds: CAPTURE, frequencies: [220, 440, 880],
    method: 'Actual Analyzer mixed engine at 44100 Hz; fresh WASM instances for unity and current defaults, one sustained full-level voice, hardware frequency quantization, rising DC-centered crossing estimate, half peak-to-peak and AC RMS.',
    reference: {ym2608MasterClock: FM_CLOCK, ym2608SsgClock: FM_CLOCK / 4, segaPsgClock: PSG_CLOCK,
      fm: 'Algorithm7, OP4 only, TL0/MUL1/AR31, other operators silent; both stereo bits enabled.',
      ssg: 'ChannelA only, fixed volume15, tone enabled; envelope and noise disabled.',
      segaPsg: 'Tone0 only, attenuation0; remaining channels silent. The application Mixer cancels the legacy Genesis .35 engine trim; measured unity is raw source PCM.'},
    limits: 'Steady reference levels, not perceived loudness or music normalization. No envelope/gated-duty/polyphony weighting. Existing YM2608 FM/SSG ratio is retained by every Sega-only candidate. Source-unit Mixer gain equals raw-core gain; the separately recorded legacy engine trim must not be divided out again. Current default gains are snapshots, not authoritative baseline inputs. No physical audio device or external ROM.',
    sources, rows, comparisons, candidateReferenceFrequencyHz: 440};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await measureAnalyzerPsgBalance();
  if (process.argv.length > 2) {assert.equal(process.argv.length, 4, 'Usage: node scripts/measure_analyzer_psg_balance.mjs [--out report.json]'); assert.equal(process.argv[2], '--out'); await writeFile(resolve(process.argv[3]), `${JSON.stringify(report, null, 2)}\n`);}
  console.log('PASS: nine actual FM/SSG/PSG unity and calibrated references.');
}
