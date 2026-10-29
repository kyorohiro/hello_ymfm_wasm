// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {readPmon} from './spu_synth_pmon.js';
import {createPlaygroundPs1VoicePanel} from '../playground/playground_ps1_voice_panel.js?v=ps1-deferred-release-1';

/** Reuse the PCM/ADSR/FX editors with one instrument for all keyboard voices.
 * Physical-channel inspection and audition controls belong to Playground. */
export function createSpuInstrumentPanel({root, invoke, ...options}) {
  const panel = createPlaygroundPs1VoicePanel({root, ...options, invoke(method, args = []) {
    if (method === 'setPreset' || method === 'setChannel') return invoke('setInstrumentPreset', args.slice(1));
    if (method === 'setEnvelope') return invoke('setInstrumentEnvelope', args.slice(1));
    if (method === 'setWaveform') return invoke('setInstrumentWaveform', args.slice(1));
    if (method === 'setReverb' && Object.hasOwn(args[0] ?? {}, 'preset')) return invoke('setInstrumentReverbPreset', args);
    return invoke(method, args);
  }});
  root.querySelector('.chip-channel-list')?.remove();
  root.querySelector('.chip-editor-body > .chip-section')?.remove();
  root.querySelector('.chip-advanced')?.remove();
  for (const node of [...root.children]) if (node.tagName === 'P' && !node.classList.contains('chip-editor-status')) node.remove();
  const label = root.querySelector('[data-chip-control="ps1-reverb-send"]')?.closest('label')?.querySelector('.chip-field-label');
  if (label) label.textContent = 'Enable reverb';
  for (const node of root.querySelectorAll('p')) {
    if (node.textContent.startsWith('One cycle uses')) node.textContent = 'Draw a 112-sample PCM cycle or choose a shape. All notes use the same instrument. The cycle is encoded as four SPU ADPCM packets; quantization changes the resulting sound. Use Load audio for recordings and longer samples.';
    else if (node.textContent.startsWith('The graph shows')) node.textContent = 'The graph shows envelope shape, not measured timing. With Apply edits on, ADSR changes update every sounding note at its current level and sample position. Attack changes affect an active attack or the next note. With it off, each running note keeps its ADSR until the next Note On. Release rates 27–31 hold indefinitely; use Stop all sound for immediate silence. PCM edits update the common cycle and can restart held notes when Apply edits is on.';
    else if (node.textContent.startsWith('Choose a reverb preset')) node.textContent = 'Choosing a preset enables reverb; Off disables it. Uncheck Enable reverb to bypass it while keeping the preset. Return levels control the shared SPU effect. These are the core’s named reverb approximations.';
  }
  const envelopeEditor = root.querySelector('.chip-envelope-editor');
  const sections = [...root.querySelectorAll('.chip-editor-body > .chip-section')];
  const sectionNames = ['pcm', 'adsr', 'fx'];
  sections.forEach((section, index) => {
    const name = sectionNames[index];
    section.id = `instrumentPanel-${name}`;
    section.setAttribute('role', 'tabpanel');
    section.setAttribute('aria-labelledby', `instrumentTab-${name}`);
    section.hidden = index !== 0;
  });
  const pmon = root.ownerDocument.createElement('fieldset');
  pmon.className = 'spu-pmon';
  pmon.innerHTML = `<legend>Pitch Modulation</legend>
    <label class="pmon-enable"><input type="checkbox" data-pmon="enabled"> Enable PMON</label>
    <div class="pmon-fields">
      <label>Ratio <input type="number" data-pmon="ratio" min="0.01" max="16" step="0.01" value="1" aria-label="Modulator frequency ratio"></label>
      <div class="pmon-ratios" aria-label="Ratio presets">${[.5,1,2,3].map(value => `<button type="button" data-pmon-ratio="${value}">${value}×</button>`).join('')}</div>
      <label>Depth <input type="range" data-pmon="depth" min="0" max="1" step="0.01" value="0.5" aria-label="Modulation depth"><output data-pmon-output="depth">50%</output></label>
      <label>Decay <input type="range" data-pmon="decayMs" min="0" max="5000" step="10" value="500" aria-label="Modulator decay"><output data-pmon-output="decayMs">≈ 500 ms</output></label>
    </div>
    <p class="subtext">A silent Sine modulates each note. Ratio and Depth update sounding notes. Decay applies to new notes; zero holds the modulation. High ratios are limited by the SPU pitch range.</p>
    <p class="subtext">PMON uses two voices per note: 12 notes total. Switching On or Off stops current notes.</p>`;
  sections[2].classList.add('spu-fx');
  sections[2].append(pmon);
  const controls = Object.fromEntries([...pmon.querySelectorAll('[data-pmon]')].map(node => [node.dataset.pmon,node]));
  const displayPmon = () => {
    pmon.querySelector('[data-pmon-output="depth"]').textContent = `${Math.round(Number(controls.depth.value)*100)}%`;
    pmon.querySelector('[data-pmon-output="decayMs"]').textContent = Number(controls.decayMs.value) ? `≈ ${controls.decayMs.value} ms` : 'Hold';
  };
  let pmonPending = 0, lastPmon=readPmon();
  async function changePmon() {
    const revision = ++pmonPending;
    try {
      const value = readPmon({enabled:controls.enabled.checked,ratio:Number(controls.ratio.value),depth:Number(controls.depth.value),decayMs:Number(controls.decayMs.value)});
      await invoke('setInstrumentPmon',[value]);
    } catch(error) {
      if (revision === pmonPending) for(const [key,node] of Object.entries(controls)) {
        if(key==='enabled')node.checked=lastPmon.enabled;else node.value=String(lastPmon[key]);
      }
      options.onError?.(error);
    } finally {if (revision === pmonPending) displayPmon();}
  }
  for (const node of Object.values(controls)) {
    node.addEventListener('input',displayPmon);
    node.addEventListener('change',changePmon);
  }
  for (const button of pmon.querySelectorAll('[data-pmon-ratio]')) button.addEventListener('click',() => {controls.ratio.value=button.dataset.pmonRatio; void changePmon();});
  let activeSection = 'pcm', visible = true;
  return {...panel, setSection(name) {
    if (![...sectionNames, 'audio'].includes(name)) throw new RangeError('Unknown SPU instrument section');
    if (name === activeSection) return;
    // Cancel a drawing/ADSR gesture before hiding its controls. Keyboard note
    // ownership belongs to the standalone controller and is unaffected.
    panel.setVisible(false);
    activeSection = name;
    root.hidden = name === 'audio';
    sections.forEach((section, index) => {section.hidden = sectionNames[index] !== name;});
    panel.setVisible(visible && name !== 'audio');
  }, setVisible(value) {
    visible = Boolean(value);
    panel.setVisible(visible && activeSection !== 'audio');
  }, update(state) {
    panel.update(state);
    const settings=readPmon(state.pmon); lastPmon=settings;
    for (const [key,node] of Object.entries(controls)) {
      if (node === root.ownerDocument.activeElement) continue;
      if (key === 'enabled') node.checked=settings.enabled; else node.value=String(settings[key]);
    }
    displayPmon();
    for (const node of envelopeEditor?.querySelectorAll('[data-chip-envelope-handle]') ?? []) {
      for (const attr of ['aria-label', 'title']) node.setAttribute(attr, (node.getAttribute(attr) ?? '').replace(/^Voice 1 · /, ''));
    }
    const waveInfo = root.querySelector('[data-chip-output="ps1-wave-info"]');
    if (waveInfo) waveInfo.textContent = waveInfo.textContent.replace('for this voice', 'for this instrument');
  }};
}
