// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Snapshot inspection only: no SPC700 execution, audio device or driver scan.
import {parseSpcFile} from '../js/spc_file.js';
import {readSnesVoices, extractBrrSamples} from '../js/snes_brr.js';
import {createDefaultPreset, readPreset} from './preset.js';
import {MAX_BRR_BYTES, encodeBase64} from './sample.js';

export const MAX_SPC_BYTES = 16 * 1024 * 1024;
const MAX_BLOCKS = MAX_BRR_BYTES / 9;
const clean = (value, limit) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').trim().slice(0, limit).trim();
const signed = value => value << 24 >> 24;
const DRY_ECHO_WARNING = 'Echo / FIR is not reproduced. This loads the dry voice only.';

/** Inspect the eight physical voice records captured in an SPC snapshot.
 * Selecting a returned preset declares C4 as a playback reference at that
 * voice's captured PITCH; this does not infer the instrument's original note.
 * The current envelope value/history, BRR decoder history, SPC700 driver
 * updates, master mix and PMON are not restored. A new key-on starts a
 * fresh hardware envelope. Noise voices cannot become BRR instruments.
 * The default preset is dry. echoVariant offers captured Echo/FIR parameters
 * with a fresh empty buffer; saved Echo RAM and past tails are not restored.
 *
 * Inactive records are retained: nonzero ENVX/OUTX is only an activity hint.
 * Only their explicit SRCNs are examined, at most eight distinct samples;
 * unused directory slots are not scanned. All returned data is detached from
 * input bytes. Invalid individual voices remain visible with a reason.
 * @param {ArrayBuffer|ArrayBufferView} input
 * @param {{name?:string}} [options]
 */
export function parseSpcVoices(input, {name = 'SPC snapshot'} = {}) {
  if (typeof name !== 'string') throw new TypeError('SPC name must be a string');
  if ((input instanceof ArrayBuffer || ArrayBuffer.isView(input)) && input.byteLength > MAX_SPC_BYTES) {
    throw new RangeError('SPC exceeds the 16 MiB file limit');
  }
  const image = parseSpcFile(input), voices = readSnesVoices(image);
  const dsp = image.dsp;
  const echo = {enabled:!(dsp[0x6c] & 0x20), delay:dsp[0x7d] & 15,
    feedback:signed(dsp[0x0d]), volumeLeft:signed(dsp[0x2c]), volumeRight:signed(dsp[0x3c]),
    fir:Array.from({length:8}, (_, index) => signed(dsp[0x0f + index * 16])),
    sendMask:dsp[0x4d], sourceAddress:dsp[0x6d] << 8};
  const displayName = clean(name, 160) || 'SPC snapshot';
  const metadata = Object.fromEntries(['title', 'game', 'artist'].map(key => [key, clean(image.metadata[key], 256)]));
  const extracted = extractBrrSamples(image, {sourceNumbers:voices.map(voice => voice.sourceNumber),
    maxBlocks:MAX_BLOCKS, maxTotalBlocks:MAX_BLOCKS * 8});
  const samples = new Map(extracted.samples.map(sample => [sample.sourceNumber, sample]));
  const rejected = new Map(extracted.rejected.map(sample => [sample.sourceNumber, sample.reason]));
  const encoded = new Map();
  const candidates = voices.map(voice => {
    const source = samples.get(voice.sourceNumber), warnings = [...(source?.warnings ?? [])];
    if (voice.pitchModulation) warnings.push('PMON is not reproduced. This loads the unmodulated BRR voice at its captured base PITCH.');
    if (voice.echo) warnings.push(DRY_ECHO_WARNING);
    if (!voice.volumeLeft && !voice.volumeRight) warnings.push('Both captured voice volumes are zero; increase Voice level to hear this instrument.');
    if (voice.envelopeMode === 'gain' && ['linear-decrease', 'exponential-decrease'].includes(voice.gainMode)) {
      warnings.push('Decreasing GAIN can be silent after a new key-on: the captured ENVX is not restored. Start with ADSR or Direct GAIN to audition it.');
    }
    let reason = voice.noise ? 'Noise voice: this Synth cannot import the shared noise generator as a BRR instrument.'
      : voice.pitch === 0 ? 'Captured PITCH is 0; a playable tuning reference cannot be recovered.' : null;
    if (!reason && !source) {
      reason = rejected.get(voice.sourceNumber)?.includes('END')
        ? 'No BRR END within 64,512 bytes: the sample is incomplete or exceeds this Synth’s sample RAM budget.'
        : rejected.get(voice.sourceNumber) ?? 'No extractable BRR sample for this SRCN.';
    }
    if (!reason && source.loop && !source.loopResolved) reason = 'Loop target is outside the extracted sample or is not aligned to a 9-byte BRR block.';
    let preset = null;
    if (!reason) {
      if (!encoded.has(voice.sourceNumber)) encoded.set(voice.sourceNumber, encodeBase64(source.brr));
      const label = `${metadata.title || displayName} · V${voice.index + 1} SRCN ${voice.sourceNumber}`;
      const next = createDefaultPreset();
      next.name = clean(label, 80); next.source = 'brr';
      next.brr = {name:clean(label, 120), data:encoded.get(voice.sourceNumber), rootNote:60,
        basePitch:voice.pitch, loopStartSamples:source.loop ? source.loopStartSamples : null};
      next.volume = {left:voice.volumeLeft, right:voice.volumeRight};
      next.envelope = {mode:voice.envelopeMode, attack:voice.attack, decay:voice.decay,
        sustainLevel:voice.sustainLevel, sustainRate:voice.sustainRate, gainMode:voice.gainMode,
        gainLevel:voice.gain & 127, gainRate:voice.gain & 31};
      // Use the same strict path as authored / JSON presets before offering a
      // candidate. Do not repair an unresolved loop or invent a nonzero pitch.
      try {preset = readPreset(next);} catch (error) {reason = error.message;}
    }
    const echoWarnings = warnings.filter(warning => warning !== DRY_ECHO_WARNING);
    echoWarnings.push('Captured Echo / FIR parameters start with an empty buffer. Saved Echo RAM, past tails, other voices and the original master mix are not restored.');
    if (!echo.enabled) echoWarnings.push('Captured Echo RAM writes are disabled; Echo is imported Off with its parameter values retained. Frozen-buffer audio is not restored.');
    if (!voice.echo) echoWarnings.push(`CH${voice.index + 1} was not sent to Echo. Send all notes is imported Off; turn it on to send newly played notes.`);
    if (!echo.volumeLeft && !echo.volumeRight) echoWarnings.push('Both captured Echo Return values are zero; increase Return to hear the wet signal.');
    let echoPreset = null, echoReason = reason;
    if (preset) {
      try {
        echoPreset = readPreset({...preset, echo:{enabled:echo.enabled, delay:echo.delay,
          feedback:echo.feedback, volumeLeft:echo.volumeLeft, volumeRight:echo.volumeRight,
          send:voice.echo, fir:echo.fir.slice()}});
      } catch (error) {echoReason = error.message;}
    }
    return {id:`voice-${voice.index}`, voice, sample:source ? {sourceNumber:source.sourceNumber,
      startAddress:source.startAddress, loopAddress:source.loopAddress, bytes:source.brr.length,
      frames:source.pcm.length, loopStartSamples:source.loopStartSamples} : null,
      preset, reason, warnings, echoVariant:{preset:echoPreset, reason:echoReason, warnings:echoWarnings}};
  });
  return {name:displayName, metadata, directory:extracted.directory, echo, candidates,
    warnings:[...image.warnings, ...extracted.warnings,
      'Import is dry by default. Import Echo / FIR settings offers captured shared parameters with each voice’s own send setting; saved Echo buffer contents are not copied.',
      'Snapshot only: ENVX / OUTX activity is a hint. Current envelope and decoder history, song playback and later SPC700 driver updates are not restored.',
      'Root C4 is a declared audition reference at the captured PITCH, not the original musical note. Voice volumes and envelope registers are preserved; the original master mix is not imported.']};
}
