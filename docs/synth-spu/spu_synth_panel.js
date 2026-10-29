// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {createPlaygroundPs1VoicePanel} from '../playground/playground_ps1_voice_panel.js?v=ps1-deferred-release-1';

/** Reuse the PCM/ADSR/FX editors with one instrument for all keyboard voices.
 * Physical-channel inspection and audition controls belong to Playground. */
export function createSpuInstrumentPanel({root, envelopeMount, invoke, ...options}) {
  const panel = createPlaygroundPs1VoicePanel({root, ...options, invoke(method, args = []) {
    if (method === 'setPreset' || method === 'setChannel') return invoke('setInstrumentPreset', args.slice(1));
    if (method === 'setEnvelope') return invoke('setInstrumentEnvelope', args.slice(1));
    if (method === 'setWaveform') return invoke('setInstrumentWaveform', args.slice(1));
    return invoke(method, args);
  }});
  root.querySelector('.chip-channel-list')?.remove();
  root.querySelector('.chip-editor-body > .chip-section')?.remove();
  root.querySelector('.chip-advanced')?.remove();
  for (const node of [...root.children]) if (node.tagName === 'P' && !node.classList.contains('chip-editor-status')) node.remove();
  const label = root.querySelector('[data-chip-control="ps1-reverb-send"]')?.closest('label')?.querySelector('.chip-field-label');
  if (label) label.textContent = 'Enable reverb';
  for (const node of root.querySelectorAll('p')) {
    if (node.textContent.startsWith('One cycle uses')) node.textContent = 'Draw a 112-sample PCM cycle or choose a shape. All 24 voices use the same instrument. The cycle is encoded as four SPU ADPCM packets; quantization changes the resulting sound. Use Load audio for recordings and longer samples.';
    else if (node.textContent.startsWith('The graph shows')) node.textContent = 'The graph shows envelope shape, not measured timing. With Apply edits on, ADSR changes update every sounding note at its current level and sample position. Attack changes affect an active attack or the next note. With it off, each running note keeps its ADSR until the next Note On. Release rates 27–31 hold indefinitely; use Stop all sound for immediate silence. PCM edits update the common cycle and can restart held notes when Apply edits is on.';
    else if (node.textContent.startsWith('Choose a reverb preset')) node.textContent = 'Enable reverb and choose a preset to hear it on the instrument. Return levels control the shared SPU effect. These are the core’s named reverb approximations.';
  }
  // The editor keeps its canvas/handle references and listeners when moved.
  // Share the same ADSR controls with the top instrument display.
  const envelopeEditor = root.querySelector('.chip-envelope-editor');
  if (envelopeMount && envelopeEditor) envelopeMount.append(envelopeEditor);
  return {...panel, update(state) {
    panel.update(state);
    for (const node of envelopeEditor?.querySelectorAll('[data-chip-envelope-handle]') ?? []) {
      for (const attr of ['aria-label', 'title']) node.setAttribute(attr, (node.getAttribute(attr) ?? '').replace(/^Voice 1 · /, ''));
    }
    const waveInfo = root.querySelector('[data-chip-output="ps1-wave-info"]');
    if (waveInfo) waveInfo.textContent = waveInfo.textContent.replace('for this voice', 'for this instrument');
  }};
}
