// Environment-neutral API shared by the browser, Node adapter and future MCP server.
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
export const exportFormats = Object.freeze(['midi', 'musicxml', 'lilypond', 'mucom', 'opnavoid', 'mxdrv', 'mgsdrv']);

/** Decode VGM/VGZ bytes; filesystem access belongs to the caller. */
export async function decodeSource(input) {
  const source = new Uint8Array(await maybeDecodeVgmFile(input));
  new Ym2612VGM(source); // Validate the header before exposing a decoded source.
  return source;
}

/** JSON-compatible register-stream summary (no rendering or note extraction required). */
export function analyzeSource(source) {
  const parser = new Ym2612VGM(source);
  const { header } = parser;
  const chips = Object.entries(header).filter(([key, value]) => key.endsWith('Clock') && (value & 0x3fffffff))
    .map(([key, value]) => ({ id: key.slice(0, -5), clockHz: value & 0x3fffffff, rawClock: value >>> 0 }));
  return {
    schemaVersion: 1, header, chips, metadata: parseVgmMetadata(source),
    declaredDurationSeconds: header.totalSamples / 44100,
    commandUsage: Object.fromEntries(parser.analyzeCommandUsage()),
    dataBlocks: parser.dataBlockSummary(), pcmRamWrites: parser.pcmRamWriteSummary(),
    specialCommands: parser.analyzeSpecialCommands(),
  };
}

/** Export using exactly the browser's existing algorithms and chip restrictions. */
export function exportSource(source, { format, bpm, fileName = 'VGM' } = {}) {
  if (!exportFormats.includes(format)) throw new Error(`Unsupported format: ${format}`);
  if (bpm !== undefined && (!Number.isInteger(bpm) || bpm < 4 || bpm > 999)) throw new RangeError('BPM must be an integer from 4 to 999');
  const score = bpm === undefined || ['musicxml','lilypond'].includes(format) ? analyzeLilyPondSource(source) : null;
  const options = { bpm: bpm ?? score.tempo.bpm, fileName };
  if (format === 'midi') return exportAnalysisMidi(source, options);
  if (format === 'musicxml' || format === 'lilypond') {
    const create = format === 'musicxml' ? createMusicXmlScore : createLilyPondScore;
    return create(score.channels, score.time, { ...options, warnings: score.warnings });
  }
  const exporters = { mucom: exportMucomMml, opnavoid: exportOpnavoidMml, mxdrv: exportMxdrvMml, mgsdrv: exportMgsdrvMml };
  return { text: exporters[format](source, options) };
}

export { selectPlaybackConfiguration, createPlaybackEngine, createPlaybackPlayer, PlaybackError } from './playback_core.js';
