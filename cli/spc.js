// Node-only SPC facade. Existing synchronous VGM APIs retain their contracts.
import {readFile} from 'node:fs/promises';
import factory from '../docs/generated/spc_wasm.js';
import {parseSpcFile} from '../docs/js/spc_file.js';
import {captureSpcPerformance} from '../docs/js/spc_performance.js';
import {estimateBrrPitch} from '../docs/js/spc_pitch.js';
import {noteToHz} from '../docs/js/soundchip_pitch.js';
import {buildSnesNoteAnalysis} from '../docs/vgm_analyzer/snes_notes.js';
import {prepareSnesScore} from '../docs/vgm_analyzer/snes_score.js';
import {exportNoteAnalysisMidi} from '../docs/vgm_analyzer/vgm_midi.js';
import {createLilyPondScore} from '../docs/vgm_analyzer/vgm_lilypond.js';
import {createMusicXmlScore} from '../docs/vgm_analyzer/vgm_musicxml.js';
import {groupScoreChannels,parseScoreGroups} from '../docs/vgm_analyzer/score_groups.js';

const SIGNATURE = new TextEncoder().encode('SNES-SPC700 Sound File Data');
const channelId = index => `snes-voice-${index + 1}`;

/** Recognize an SPC signature, including malformed/truncated SPCs that should
 * receive an SPC validation error rather than being interpreted as VGM. */
export function isSpcSource(input) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input)
    : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer,input.byteOffset,input.byteLength) : null;
  return Boolean(bytes && bytes.length >= SIGNATURE.length
    && SIGNATURE.every((byte,index) => bytes[index] === byte));
}

function manualReferences(input) {
  if (!Array.isArray(input) || input.length > 256) throw new TypeError('references must be an array of at most 256 BRR references');
  const seen = new Set();
  return input.map(reference => {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)
      || !Number.isInteger(reference.sampleId) || reference.sampleId < 0 || reference.sampleId > 255
      || seen.has(reference.sampleId)) throw new TypeError('Each BRR reference requires a unique sampleId from 0 to 255');
    seen.add(reference.sampleId);
    const hasHz = Object.hasOwn(reference,'referenceHz'), hasNote = Object.hasOwn(reference,'note');
    const allowed = hasHz ? ['sampleId','referenceHz'] : ['sampleId','note','cents'];
    if (hasHz === hasNote || Object.keys(reference).some(key => !allowed.includes(key))) {
      throw new TypeError('BRR reference must use either {sampleId, referenceHz} or {sampleId, note, cents?}');
    }
    let referenceHz = reference.referenceHz;
    if (hasNote) {
      const cents = reference.cents === undefined ? 0 : reference.cents;
      if (typeof reference.note !== 'string' || !Number.isFinite(cents) || cents < -100 || cents > 100) {
        throw new RangeError('BRR reference note must be a note name; cents must be finite and between -100 and 100');
      }
      referenceHz = noteToHz(reference.note.trim()) * 2 ** (cents / 1200);
    }
    if (!Number.isFinite(referenceHz) || referenceHz <= 0) throw new RangeError('BRR referenceHz must be finite and positive');
    return {sampleId:reference.sampleId,referenceHz,kind:'manual'};
  });
}

/** Analyze the first bounded SPC interval with the browser's capture, pitch and
 * note algorithms. Musical references describe BRR at native 32 kHz / PITCH
 * 4096; they change note interpretation, never the original SPC bytes or PCM.
 * Note start/end/time use 44,100-Hz analysis ticks, not SPC clocks or PCM frames.
 * @param {ArrayBuffer|ArrayBufferView} bytes
 * @param {{durationSeconds?:number,controlStepMs?:number,
 * references?:Array<{sampleId:number,referenceHz:number}|{sampleId:number,note:string,cents?:number}>,
 * signal?:AbortSignal,onProgress?:(progress:object)=>void}} [options]
 */
export async function analyzeSpcSource(bytes, {durationSeconds,controlStepMs = 20,references = [],signal,onProgress} = {}) {
  signal?.throwIfAborted();
  const manual = manualReferences(references), parsed = parseSpcFile(bytes);
  const taggedSeconds = parsed.metadata.durationSeconds;
  if (durationSeconds === undefined) durationSeconds = Number.isFinite(taggedSeconds) && taggedSeconds > 0
    ? Math.max(.1,Math.min(120,taggedSeconds)) : 120;
  if (!Number.isFinite(durationSeconds) || durationSeconds < .1 || durationSeconds > 600) {
    throw new RangeError('SPC durationSeconds must be between 0.1 and 600');
  }
  if (!Number.isFinite(controlStepMs) || controlStepMs < 0 || controlStepMs > 1000) {
    throw new RangeError('SPC controlStepMs must be between 0 and 1000');
  }
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('onProgress must be a function');
  const wasmBinary = await readFile(new URL('../docs/generated/spc_wasm.wasm',import.meta.url));
  signal?.throwIfAborted();
  const performance = await captureSpcPerformance(parsed.originalBytes,{
    durationSeconds,controlStepMs,moduleFactory:factory,moduleOptions:{wasmBinary},signal,onProgress,
  });
  const estimates = performance.samples.map((sample,index) => {
    signal?.throwIfAborted();
    const estimate = {sampleId:sample.id,...estimateBrrPitch(sample)};
    onProgress?.({stage:'pitch',completed:index + 1,total:performance.samples.length});
    signal?.throwIfAborted();
    return estimate;
  });
  signal?.throwIfAborted();
  const chosen = new Map(estimates.filter(estimate => estimate.confidence === 'high').map(estimate => [estimate.sampleId,{
    sampleId:estimate.sampleId,referenceHz:estimate.referenceHz,kind:'estimated',confidence:'high',
  }]));
  for (const reference of manual) {
    if (!performance.samples[reference.sampleId]) throw new RangeError(`Unknown BRR sampleId: ${reference.sampleId}; analyze without references to list captured BRR versions`);
    chosen.set(reference.sampleId,reference);
  }
  const applied = [...chosen.values()].sort((a,b) => a.sampleId - b.sampleId);
  const score = prepareSnesScore(buildSnesNoteAnalysis(performance,{references:applied}));
  return {...score,format:'SPC',metadata:parsed.metadata,estimates,references:applied,
    statistics:performance.statistics,sourceWarnings:[...parsed.warnings],
    warnings:[...score.warnings,...parsed.warnings]};
}

function validateAnalysis(score) {
  if (!score || score.version !== 1 || score.chipKind !== 'snes' || score.clockRate !== 1024000
    || score.displayRate !== 44100 || !Number.isFinite(score.durationSeconds)
    || score.durationSeconds < .1 || score.durationSeconds > 600
    || !Number.isSafeInteger(score.durationClocks)
    || Math.abs(score.durationClocks / 1024000 - score.durationSeconds) > 1e-9
    || !Number.isFinite(score.time) || Math.abs(score.time / 44100 - score.durationSeconds) > 1e-9
    || !Array.isArray(score.channels) || score.channels.length !== 8
    || !Array.isArray(score.warnings) || score.warnings.length > 4096
    || score.warnings.some(warning => typeof warning !== 'string' || warning.length > 65536)) {
    throw new TypeError('Expected a completed SNES score from analyzeSpcSource');
  }
  let total = 0;
  for (const channel of score.channels) {
    if (!channel || typeof channel.name !== 'string' || channel.name.length > 65536 || !Array.isArray(channel.notes)) {
      throw new TypeError('Invalid SNES score channel');
    }
    total += channel.notes.length;
    if (total > 1000000) throw new RangeError('SNES score exceeds 1,000,000 intervals');
    let previousEnd = 0;
    for (const note of channel.notes) {
      if (!note || !Number.isFinite(note.start) || !Number.isFinite(note.end)
        || note.start < previousEnd || note.end < note.start || note.end > score.time
        || (note.midi !== null && !Number.isFinite(note.midi))
        || !['number','string'].includes(typeof note.key)
        || (typeof note.key === 'number' && !Number.isFinite(note.key))) {
        throw new TypeError('Invalid or overlapping SNES score intervals');
      }
      previousEnd = note.end;
    }
  }
}

/** Stable physical voice IDs, independent of which voices have notes. */
export function listSpcScoreChannels(score) {
  validateAnalysis(score);
  return {schemaVersion:1,channels:score.channels.map((channel,index) => ({
    id:channelId(index),name:channel.name,noteCount:channel.notes.length,
  })),warnings:[...score.warnings]};
}

/** Export an already analyzed interval without executing the SPC CPU again.
 * Channel selection/grouping applies to scores only, as in exportSource(). */
export function exportSpcAnalysis(score, {format,bpm = score?.tempo?.bpm,fileName = 'SPC',channels,groups,group,mergeAll} = {}) {
  validateAnalysis(score);
  if (!['midi','musicxml','lilypond'].includes(format)) throw new Error('SPC export format must be midi, musicxml or lilypond');
  if (!Number.isInteger(bpm) || bpm < 4 || bpm > 999) throw new RangeError('BPM must be an integer from 4 to 999');
  if (format === 'midi') {
    if (channels !== undefined) throw new Error('Channel selection requires musicxml or lilypond');
    if (groups !== undefined || group !== undefined || mergeAll) throw new Error('Grouping requires musicxml or lilypond');
    return exportNoteAnalysisMidi(score,{bpm,fileName});
  }
  if (groups !== undefined && (group !== undefined || mergeAll)) throw new Error('Use groups or CLI group options');
  let selected = score.channels.map((channel,index) => ({...channel,id:channelId(index)}));
  if (channels !== undefined) {
    if (!Array.isArray(channels) || !channels.length || channels.some(id => typeof id !== 'string')
      || new Set(channels).size !== channels.length) throw new Error('channels must be a nonempty array of unique channel IDs');
    const known = new Set(selected.map(channel => channel.id));
    for (const id of channels) if (!known.has(id)) throw new Error('Unknown score channel: '+id);
    selected = selected.filter(channel => channels.includes(channel.id));
  }
  const grouped = groupScoreChannels(selected,groups ?? parseScoreGroups(group,mergeAll,selected));
  const create = format === 'musicxml' ? createMusicXmlScore : createLilyPondScore;
  return create(grouped,score.time,{bpm,fileName,warnings:score.warnings,chipKind:'snes'});
}
