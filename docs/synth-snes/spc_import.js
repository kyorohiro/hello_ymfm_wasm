// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Snapshot inspection only: no SPC700 execution, audio device or driver scan.
import {parseSpcFile} from '../js/spc_file.js';
import {readSnesVoices, extractBrrSamples} from '../js/snes_brr.js';
import {createDefaultPreset, readPreset, ECHO_BRR_MAX_BYTES} from './preset.js';
import {MAX_BRR_BYTES, encodeBase64} from './sample.js';

export const MAX_SPC_BYTES = 16 * 1024 * 1024;
const MAX_BLOCKS = MAX_BRR_BYTES / 9;
const clean = (value, limit) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').trim().slice(0, limit).trim();
const signed = value => value << 24 >> 24;
const DRY_ECHO_WARNING = 'Echo / FIR is not reproduced. This loads the dry voice only.';
const DRY_PMON_WARNING = 'PMON is not reproduced. This loads the unmodulated BRR voice at its captured base PITCH.';
const sampleMetadata = source => source ? {sourceNumber:source.sourceNumber,
  startAddress:source.startAddress, loopAddress:source.loopAddress, bytes:source.brr.length,
  frames:source.pcm.length, loopStartSamples:source.loopStartSamples} : null;

/** Inspect the eight physical voice records captured in an SPC snapshot.
 * Selecting a BRR preset declares C4 as a playback reference at that voice's
 * captured PITCH; this does not infer the instrument's original note. Noise
 * presets use the captured shared clock, independent of PITCH or SRCN data.
 * The current envelope value/history, BRR decoder history, SPC700 driver
 * updates and master mix are not restored. A new key-on starts a
 * fresh hardware envelope. Internal Noise LFSR state is not restored.
 * The default preset is dry. echoVariant offers captured Echo/FIR parameters
 * with a fresh empty buffer; saved Echo RAM and past tails are not restored.
 * pmonVariant / pmonEchoVariant optionally pair a BRR carrier with its preceding
 * BRR modulator, preserving both captured PITCH references and envelopes. Only
 * isolated two-voice pairs are supported. Modulator dry / Echo output is omitted.
 *
 * Inactive records are retained: nonzero ENVX/OUTX is only an activity hint.
 * Only BRR voices' explicit SRCNs are examined, at most eight distinct samples;
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
  const dsp = image.dsp, noiseClock = dsp[0x6c] & 31;
  const echo = {enabled:!(dsp[0x6c] & 0x20), delay:dsp[0x7d] & 15,
    feedback:signed(dsp[0x0d]), volumeLeft:signed(dsp[0x2c]), volumeRight:signed(dsp[0x3c]),
    fir:Array.from({length:8}, (_, index) => signed(dsp[0x0f + index * 16])),
    sendMask:dsp[0x4d], sourceAddress:dsp[0x6d] << 8};
  const displayName = clean(name, 160) || 'SPC snapshot';
  const metadata = Object.fromEntries(['title', 'game', 'artist'].map(key => [key, clean(image.metadata[key], 256)]));
  const sourceNumbers = voices.filter(voice => !voice.noise).map(voice => voice.sourceNumber);
  const extracted = sourceNumbers.length ? extractBrrSamples(image, {sourceNumbers,
    maxBlocks:MAX_BLOCKS, maxTotalBlocks:MAX_BLOCKS * 8})
    : {directory:dsp[0x5d], samples:[], rejected:[], warnings:[]};
  const samples = new Map(extracted.samples.map(sample => [sample.sourceNumber, sample]));
  const rejected = new Map(extracted.rejected.map(sample => [sample.sourceNumber, sample.reason]));
  const encoded = new Map();
  const candidates = voices.map(voice => {
    const source = voice.noise ? null : samples.get(voice.sourceNumber), warnings = [...(source?.warnings ?? [])];
    if (voice.pitchModulation) warnings.push(voice.noise
      ? 'Recorded PMON is not imported; it does not tune hardware Noise.'
      : DRY_PMON_WARNING);
    if (voice.noise && !noiseClock) warnings.push('Noise clock 0 holds the current generator value instead of advancing it; a fresh instrument starts from the hardware reset state.');
    if (voice.echo) warnings.push(DRY_ECHO_WARNING);
    if (!voice.volumeLeft && !voice.volumeRight) warnings.push('Both captured voice volumes are zero; increase Voice level to hear this instrument.');
    if (voice.envelopeMode === 'gain' && ['linear-decrease', 'exponential-decrease'].includes(voice.gainMode)) {
      warnings.push('Decreasing GAIN can be silent after a new key-on: the captured ENVX is not restored. Start with ADSR or Direct GAIN to audition it.');
    }
    let reason = !voice.noise && voice.pitch === 0 ? 'Captured PITCH is 0; a playable tuning reference cannot be recovered.' : null;
    if (!voice.noise && !reason && !source) {
      reason = rejected.get(voice.sourceNumber)?.includes('END')
        ? 'No BRR END within 64,512 bytes: the sample is incomplete or exceeds this Synth’s sample RAM budget.'
        : rejected.get(voice.sourceNumber) ?? 'No extractable BRR sample for this SRCN.';
    }
    if (!voice.noise && !reason && source.loop && !source.loopResolved) reason = 'Loop target is outside the extracted sample or is not aligned to a 9-byte BRR block.';
    let preset = null;
    if (!reason) {
      const label = `${metadata.title || displayName} · V${voice.index + 1} ${voice.noise ? 'Noise' : 'SRCN ' + voice.sourceNumber}`;
      const next = createDefaultPreset();
      next.name = clean(label, 80); next.source = voice.noise ? 'noise' : 'brr';
      if (voice.noise) next.noise = {clock:noiseClock};
      else {
        if (!encoded.has(voice.sourceNumber)) encoded.set(voice.sourceNumber, encodeBase64(source.brr));
        next.brr = {name:clean(label, 120), data:encoded.get(voice.sourceNumber), rootNote:60,
          basePitch:voice.pitch, loopStartSamples:source.loop ? source.loopStartSamples : null};
      }
      next.volume = {left:voice.volumeLeft, right:voice.volumeRight};
      next.envelope = {mode:voice.envelopeMode, attack:voice.attack, decay:voice.decay,
        sustainLevel:voice.sustainLevel, sustainRate:voice.sustainRate, gainMode:voice.gainMode,
        gainLevel:voice.gain & 127, gainRate:voice.gain & 31};
      // Use the same strict path as authored / JSON presets before offering a
      // candidate. Noise never depends on the captured BRR or musical pitch.
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
    return {id:`voice-${voice.index}`, voice, sample:sampleMetadata(source),
      preset, reason, warnings, echoVariant:{preset:echoPreset, reason:echoReason, warnings:echoWarnings}};
  });
  for (const candidate of candidates) {
    const {voice} = candidate, previous = candidates[voice.index - 1], next = candidates[voice.index + 1];
    const isCarrier = voice.pitchModulation && !voice.noise;
    candidate.pmonPair = isCarrier && previous?.sample
      ? {modulatorVoice:{...previous.voice}, sample:{...previous.sample}} : null;
    let pairReason = candidate.reason;
    if (!pairReason) {
      if (voice.noise) pairReason = 'Hardware Noise is not tuned by PMON; this voice has no importable PMON pair.';
      else if (!voice.pitchModulation || !previous) pairReason = 'This voice has no recorded PMON input from a preceding channel.';
      else if (previous.voice.noise) pairReason = `CH${previous.voice.index + 1} is a Noise modulator; only BRR modulator pairs are supported.`;
      else if (!previous.preset) pairReason = `Modulator CH${previous.voice.index + 1}: ${previous.reason}`;
      else if (previous.voice.pitchModulation) pairReason = 'Incoming PMON chain: the preceding modulator is itself modulated. Only an isolated two-voice pair can be imported.';
      else if (next?.voice.pitchModulation && !next.voice.noise) pairReason = 'Outgoing PMON chain: this carrier also modulates the next BRR voice. Only an isolated two-voice pair can be imported.';
    }
    const pairWarnings = isCarrier && previous ? [
      `PMON pair: both captured PITCH values are declared at C4. Their original musical roots and fundamental-frequency ratio are not inferred.`,
      'The modulator is silent in the dry mix (L/R zero) and its Echo send is omitted. Captured signed modulator volumes remain inspection metadata; its post-envelope signal drives PMON.',
      'Both hardware envelopes restart on key-on. Current ENVX, BRR decoder history, SPC700 driver updates, other voices and the original master mix are not restored.',
    ] : [];
    if (isCarrier && previous && !previous.voice.noise) {
      for (const warning of samples.get(previous.voice.sourceNumber)?.warnings ?? []) pairWarnings.push('Modulator: ' + warning);
      const mod = previous.voice;
      if (mod.envelopeMode === 'gain' && mod.gainMode === 'direct' && !(mod.gain & 127))
        pairWarnings.push('Modulator Direct GAIN is zero; PMON starts without modulation. Raise its envelope level to hear modulation.');
      if (mod.envelopeMode === 'gain' && ['linear-decrease', 'exponential-decrease'].includes(mod.gainMode))
        pairWarnings.push('Modulator decreasing GAIN can be silent after a fresh key-on: captured ENVX is not restored. Start with ADSR or Direct GAIN to audition modulation.');
      if (mod.envelopeMode === 'gain' && ['linear-increase', 'bent-increase'].includes(mod.gainMode) && !(mod.gain & 31))
        pairWarnings.push('Modulator increasing GAIN rate 0 holds its new envelope at zero; choose a nonzero rate to hear modulation.');
    }
    function pairVariant(base) {
      const warnings = [...base.warnings.filter(warning => warning !== DRY_PMON_WARNING), ...pairWarnings];
      let reason = base.reason ?? pairReason, preset = null;
      if (!reason) {
        // The Synth loads two physical samples even when both voices share SRCN.
        const bytes = candidate.sample.bytes + previous.sample.bytes;
        const budget = base.preset.echo.enabled ? ECHO_BRR_MAX_BYTES : MAX_BRR_BYTES;
        if (bytes > budget) reason = `PMON pair requires ${bytes.toLocaleString('en-US')} BRR bytes; the combined carrier and modulator budget is ${budget.toLocaleString('en-US')} bytes${base.preset.echo.enabled ? ' with Echo enabled' : ''}. Samples are counted separately even when SRCN is shared.`;
        else {
          try {
            preset = readPreset({...base.preset, pmon:{...base.preset.pmon, enabled:true, source:'brr', ratio:1,
              brr:{...previous.preset.brr}, envelope:{...previous.preset.envelope}}});
          } catch (error) {reason = error.message;}
        }
      }
      return {preset, reason, warnings};
    }
    candidate.pmonVariant = pairVariant(candidate);
    candidate.pmonEchoVariant = pairVariant(candidate.echoVariant);
  }
  return {name:displayName, metadata, directory:extracted.directory, noiseClock, echo, candidates,
    warnings:[...image.warnings, ...extracted.warnings,
      'Import is dry by default. Import Echo / FIR settings offers captured shared parameters with each voice’s own send setting; saved Echo buffer contents are not copied.',
      'PMON is omitted by default. Optional PMON import supports isolated adjacent BRR pairs only; both captured PITCH values use C4 as an audition reference. Modulator dry output and Echo send are omitted.',
      'Snapshot only: ENVX / OUTX activity is a hint. Current envelope and decoder history, song playback and later SPC700 driver updates are not restored.',
      'For BRR, Root C4 is a declared audition reference at the captured PITCH, not the original musical note. Noise uses its shared clock instead. Voice volumes and envelope registers are preserved; the original master mix is not imported.',
      ...(voices.some(voice => voice.noise) ? ['Noise uses one shared hardware generator for all voices. Its internal LFSR state is not restored; clock 0 holds its current value instead of advancing.'] : [])]};
}
