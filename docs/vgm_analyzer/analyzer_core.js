import {exportSamples,listSamples} from './sample_core.js';
import {exportOpmZip} from './opm_export.js';
import {exportVoiceSnapshot,exportTfiZip,exportVgiZip} from './tfi_archive.js';
// Environment-neutral API shared by the browser, Node adapter and future MCP server.
import { looksLikeS98, convertS98ToVgm } from '../js/s98_file.js';
import { Ym2612VGM } from '../js/ym2612vgm.js';
import { maybeDecodeVgmFile, parseVgmMetadata } from '../js/vgm_file.js';
import { analyzeLilyPondSource, createLilyPondScore } from './vgm_lilypond.js';
import { createMusicXmlScore } from './vgm_musicxml.js';
import { exportAnalysisMidi } from './vgm_midi.js';
import { exportMucomMml, exportOpnavoidMml } from './vgm_mml.js';
import { exportMxdrvMml } from './opm_mml.js';
import { exportMgsdrvMml } from './mgsdrv_mml.js';
export { analyzeLilyPondSource, exportLilyPondAnalysis } from './vgm_lilypond.js';
export { exportAnalysisMidi } from './vgm_midi.js';
export { createMusicXmlScore } from './vgm_musicxml.js';
export { renderVgmToWav } from './vgm_wav.js';
export const exportFormats = Object.freeze(['tfi', 'vgi', 'opm', 'tfi-zip', 'vgi-zip', 'opm-zip', 'midi', 'musicxml', 'lilypond', 'mucom', 'opnavoid', 'mxdrv', 'mgsdrv']);

/** Decode and normalize input, preserving original S98 information explicitly. */
export async function decodeSourceDocument(input) {
  const decoded = await maybeDecodeVgmFile(input);
  const normalized = looksLikeS98(decoded) ? convertS98ToVgm(decoded) : {buffer:decoded};
  const bytes = new Uint8Array(normalized.buffer);
  new Ym2612VGM(bytes);
  return {bytes, ...(normalized.sourceHeader ? {sourceHeader:normalized.sourceHeader} : {})};
}
/** Backward-compatible byte API; use decodeSourceDocument to retain S98 metadata. */
export async function decodeSource(input) { return (await decodeSourceDocument(input)).bytes; }
export function sourceBytes(source) {
  return source instanceof Uint8Array || source instanceof ArrayBuffer ? source : source.bytes;
}

/** JSON-compatible register-stream summary (no rendering or note extraction required). */
export function analyzeSource(source) {
  const bytes = sourceBytes(source);
  const parser = new Ym2612VGM(bytes);
  const { header } = parser;
  const chips = Object.entries(header).filter(([key, value]) => key.endsWith('Clock') && (value & 0x3fffffff))
    .map(([key, value]) => ({ id: key.slice(0, -5), clockHz: value & 0x3fffffff, rawClock: value >>> 0 }));
  return {
    schemaVersion: 1, header, chips, metadata: parseVgmMetadata(bytes),
    ...(source.sourceHeader ? {sourceHeader:source.sourceHeader} : {}),
    declaredDurationSeconds: header.totalSamples / 44100,
    commandUsage: Object.fromEntries(parser.analyzeCommandUsage()),
    dataBlocks: parser.dataBlockSummary(), pcmRamWrites: parser.pcmRamWriteSummary(),
    specialCommands: parser.analyzeSpecialCommands(),
  };
}

/** Export using exactly the browser's existing algorithms and chip restrictions. */
export function exportSource(source, { format, bpm, fileName = 'VGM', atSeconds, channel, channels } = {}) {
  source = sourceBytes(source);
  if (!exportFormats.includes(format)) throw new Error(`Unsupported format: ${format}`);
  if (bpm !== undefined && (!Number.isInteger(bpm) || bpm < 4 || bpm > 999)) throw new RangeError('BPM must be an integer from 4 to 999');
  if(channels!==undefined && !['musicxml','lilypond'].includes(format)) throw new Error('Channel selection requires musicxml or lilypond');
  if (['tfi','vgi','opm'].includes(format)) return exportVoiceSnapshot(source,{format,atSeconds,channel});
  if (atSeconds !== undefined || channel !== undefined) throw new Error('Time/channel options require tfi, vgi or opm snapshot format');
  if (format === 'opm-zip') return exportOpmZip(source);
  if (format === 'vgi-zip') return exportVgiZip(source,{fileName});
  if (format === 'tfi-zip') return exportTfiZip(source,{fileName});
  const score = bpm === undefined || ['musicxml','lilypond'].includes(format) ? analyzeLilyPondSource(source) : null;
  const options = { bpm: bpm ?? score.tempo.bpm, fileName };
  if (format === 'midi') return exportAnalysisMidi(source, options);
  if (format === 'musicxml' || format === 'lilypond') {
    const create = format === 'musicxml' ? createMusicXmlScore : createLilyPondScore;
    return create(selectScoreChannels(score.channels,channels), score.time, { ...options, warnings: score.warnings });
  }
  const exporters = { mucom: exportMucomMml, opnavoid: exportOpnavoidMml, mxdrv: exportMxdrvMml, mgsdrv: exportMgsdrvMml };
  return { text: exporters[format](source, options) };
}

export { playbackMuteControls, applyPlaybackMutes, selectPlaybackConfiguration, createPlaybackEngine, createPlaybackPlayer, PlaybackError } from './playback_core.js';


export function listSourceSamples(source, options = {}) {
  return listSamples(sourceBytes(source), options);
}


export function exportSourceSamples(source, options = {}) {
  return exportSamples(sourceBytes(source), options);
}


// IDs derive from existing chip/channel labels, not from score position.
function scoreChannelId(channel) {
  return channel.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}
function selectScoreChannels(available,ids) {
  if(ids===undefined)return available;
  if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw new Error('channels must be a nonempty array of unique channel IDs');
  const known=new Set(available.map(scoreChannelId));
  for(const id of ids)if(!known.has(id))throw new Error('Unknown score channel: '+id);
  return available.filter(ch=>ids.includes(scoreChannelId(ch)));
}
export function listSourceScoreChannels(source) {
  const score=analyzeLilyPondSource(sourceBytes(source));
  const channels=score.channels.map(ch=>({id:scoreChannelId(ch),name:ch.name,noteCount:ch.notes.length}));
  if(new Set(channels.map(ch=>ch.id)).size!==channels.length)throw new Error('Ambiguous score channel IDs');
  return {schemaVersion:1,channels,warnings:score.warnings};
}
