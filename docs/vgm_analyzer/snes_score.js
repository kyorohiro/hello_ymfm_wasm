import {suggestLilyPondTempo} from './vgm_lilypond.js?v=wonderswan-vgm-1';

// Reuse the Note-ish observation and its exact tuning choices. This adapter
// neither runs the SPC CPU again nor changes the audible player.
export function prepareSnesScore(analysis) {
  if (analysis?.version !== 1 || analysis.clockRate !== 1024000 || analysis.displayRate !== 44100
    || !Number.isFinite(analysis.durationSeconds) || analysis.durationSeconds < .1 || analysis.durationSeconds > 600
    || !Number.isSafeInteger(analysis.durationClocks) || analysis.durationClocks < 102400
    || Math.abs(analysis.durationClocks / 1024000 - analysis.durationSeconds) > 1e-9
    || !Number.isFinite(analysis.time) || Math.abs(analysis.time / 44100 - analysis.durationSeconds) > 1e-9 || !Array.isArray(analysis.channels)
    || analysis.channels.length !== 8 || !Array.isArray(analysis.samples) || !(analysis.warnings instanceof Map)) {
    throw new TypeError('Expected a completed SNES Note-ish analysis');
  }
  const used = new Set(analysis.channels.flatMap(channel => channel.notes.map(note => note.sampleId)));
  const provisional = analysis.samples.filter(sample => used.has(sample.id) && sample.referenceKind === 'provisional').length;
  const exportSummary = `Analyzed interval: 0–${analysis.durationSeconds.toFixed(2)} seconds. ${provisional} used BRR version(s) have provisional C4 references; correct them in Note-ish or Sheet Music if needed. Current reference corrections apply to all note exports, never SPC playback.`;
  return {...analysis,chipKind:'snes',chipName:'SNES',
    warnings:[exportSummary,...Array.from(analysis.warnings,([text,entry]) => `${text} (${entry.count})`)],
    exportSummary,tempo:suggestLilyPondTempo(analysis.channels)};
}
