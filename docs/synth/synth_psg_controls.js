import {createParamControl} from './synth_controls.js?v=op-gates-1';

/** Compact session controls for the shared keyboard's Sega PSG voice. */
export function setupSynthPsgControls({
  voice,
  onBeforeSourceChange = () => {},
  onSettingsChange = () => {},
  onVisualModeChange = () => {},
}) {
  if (!voice?.getSettings || !voice?.setSettings) throw new TypeError('PSG controls need a voice');
  const root = document.getElementById('synthChipPsg');
  const canvas = document.getElementById('synthPsgCanvas');
  const description = document.getElementById('synthPsgVisualizerDescription');
  const attenuationHost = document.getElementById('synthPsgAttenuationControl');
  const noiseControls = document.getElementById('synthPsgNoiseControls');
  const hint = document.getElementById('synthPsgHint');
  const help = document.getElementById('synthPsgHelp');
  const listeners = [];
  let settings = voice.getSettings(), visualMode = 'waveform', disposed = false;
  const attenuationControl = createParamControl({
    label:'PSG attenuation', min:0, max:15, step:1, value:settings.attenuation,
    showLabel:false, category:'level', onChange:value => change('attenuation', value),
  });
  attenuationControl.element.classList.add('synth-psg-number');
  attenuationControl.element.setAttribute('role', 'group');
  attenuationControl.element.setAttribute('aria-label', 'Hardware attenuation, 0 to 15');
  attenuationHost.replaceWith(attenuationControl.element);
  const attenuation = attenuationControl.element.querySelector('.param-value');
  attenuation.id = 'synthPsgAttenuation';
  for (const [index, button] of [...attenuationControl.element.querySelectorAll('.param-button')].entries()) {
    button.dataset.psgAttenuationStep = String(index ? 1 : -1);
    button.setAttribute('aria-label', index ? 'Increase attenuation: quieter' : 'Decrease attenuation: louder');
  }
  const sourceButtons = [...root.querySelectorAll('[data-psg-source]')];
  const typeButtons = [...root.querySelectorAll('[data-psg-noise-type]')];
  const rateButtons = [...root.querySelectorAll('[data-psg-noise-rate]')];
  const attenuationButtons = [...root.querySelectorAll('[data-psg-attenuation-step]')];
  const visualButtons = [...root.querySelectorAll('[data-psg-visual-mode]')];
  const clockLabels = {low:'Clock / 512', medium:'Clock / 1024', high:'Clock / 2048', tone3:'Tone 3'};
  // Match drawing coordinates to the displayed size so axis text keeps its
  // proportions on narrow screens. Resize only on layout changes, not frames.
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
    const {width, height} = entries[0].contentRect;
    if (width <= 0 || height <= 0) return;
    const w = Math.round(width), h = Math.round(height);
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w; canvas.height = h;
    onVisualModeChange(visualMode);
  });
  resize?.observe(canvas);
  const listen = (node, type, handler) => {
    node.addEventListener(type, handler);
    listeners.push(() => node.removeEventListener(type, handler));
  };
  const readState = () => ({...settings});
  function selected(buttons, attribute, value) {
    for (const button of buttons) {
      const active = button.dataset[attribute] === value;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-selected', active);
    }
  }
  function update(next = voice.getSettings()) {
    if (disposed) return readState();
    settings = {...next};
    selected(sourceButtons, 'psgSource', settings.source);
    selected(typeButtons, 'psgNoiseType', settings.noiseType);
    selected(rateButtons, 'psgNoiseRate', settings.noiseRate);
    attenuationControl.updateVisual(settings.attenuation);
    attenuation.title = (settings.attenuation === 15 ? 'Muted' : `−${settings.attenuation * 2} dB from loudest`) + ' · Drag left/right to adjust.';
    for (const button of attenuationButtons) {
      const delta = Number(button.dataset.psgAttenuationStep);
      button.disabled = delta < 0 ? settings.attenuation === 0 : settings.attenuation === 15;
    }
    noiseControls.hidden = settings.source !== 'noise';
    const text = settings.source === 'tone'
      ? 'Tone · 3 hardware channels · round robin.'
      : settings.noiseRate === 'tone3'
        ? 'Noise · 1 hardware channel · Tone 3 clock follows keyboard and Pitch.'
        : `Noise · 1 hardware channel · ${clockLabels[settings.noiseRate]} · keys retrigger the fixed clock.`;
    if (hint.textContent !== text) hint.textContent = text;
    return readState();
  }
  function change(field, value) {
    if (disposed) return;
    const previous = voice.getSettings();
    if (previous[field] === value) return;
    if (field === 'source') onBeforeSourceChange(value, previous);
    const patch = {[field]:value};
    voice.setSettings(patch);
    const next = update();
    onSettingsChange(next, previous, patch);
  }
  function chooseVisualMode(mode) {
    if (visualMode === mode) return;
    visualMode = mode;
    selected(visualButtons, 'psgVisualMode', mode);
    description.textContent = mode === 'spectrum'
      ? 'Final output spectrum · after volume · dB.'
      : 'Final output waveform · after volume.';
    canvas.setAttribute('aria-label', mode === 'spectrum' ? 'Final output frequency spectrum' : 'Final output waveform');
    onVisualModeChange(mode);
  }
  // These are performance controls, not text fields. Pointer clicks leave
  // letter keys available; keyboard activation stays local instead of Record.
  for (const button of [...sourceButtons, ...typeButtons, ...rateButtons, ...attenuationButtons, attenuation, ...visualButtons]) {
    listen(button, 'pointerdown', event => event.preventDefault());
    listen(button, 'keydown', event => {
      if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
    });
    listen(button, 'keyup', event => {
      if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
    });
    listen(button, 'click', () => {
      if (button.dataset.psgSource) change('source', button.dataset.psgSource);
      else if (button.dataset.psgNoiseType) change('noiseType', button.dataset.psgNoiseType);
      else if (button.dataset.psgNoiseRate) change('noiseRate', button.dataset.psgNoiseRate);
      else if (button.dataset.psgVisualMode) chooseVisualMode(button.dataset.psgVisualMode);
    });
  }
  listen(attenuation, 'lostpointercapture', () => attenuation.classList.remove('is-dragging'));
  const summary = help.querySelector('summary');
  listen(summary, 'keydown', event => {
    if ([' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) event.stopPropagation();
  });
  listen(help, 'keydown', event => {
    if (event.key === 'Escape' && help.open) {
      event.preventDefault(); event.stopPropagation(); help.open = false; summary.focus();
    }
  });
  listen(document, 'pointerdown', event => {if (help.open && !help.contains(event.target)) help.open = false;});
  update();
  return {
    canvas,
    getVisualMode: () => visualMode,
    readState,
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const remove of listeners) remove();
      resize?.disconnect();
      help.open = false;
    },
  };
}
