import {mixerDefaults} from './playback_mixer.js?v=pokey-vgm-1';
import {YM2608_SOURCE_LABELS, ym2608SourceDefaults} from './ym2608_source_mix.js?v=opna-source-mixer-1';

const names = {pokey:'POKEY 1','pokey:2':'POKEY 2',wonderswan: 'WonderSwan', psg: 'Sega PSG', gameBoyDmg: 'Game Boy', segaPcm: 'Sega PCM', nesApu: 'NES APU',
  rf5c164: 'RF5C164', pwm: 'PWM', k051649: 'SCC / SCC+', ay8910: 'AY8910'};
export function createMixerUi({container, resetButton, onChange, preferences, onReset = () => {}, onError = error => {throw error;}}) {
  let mixer = null;
  let configuration = null;
  const settings = new Map();
  const sourceSettings = new Map();
  const sourceMixerFor = (parent, next = mixer) => {
    const controller = next?.sourceMixers?.get(parent);
    if (next && !controller) throw new Error('YM2608 independent source gains are unavailable; reload the generated runtime.');
    return controller;
  };
  const change = (id, values) => {
    settings.set(id, {...settings.get(id), ...values});
    if (mixer?.strips.has(id)) mixer.set(id, settings.get(id));
    preferences?.setChip(id, values);
    onChange();
  };
  const changeSource = (parent, part, patch) => {
    // The native setter can reject an edit. Commit only after it succeeds so
    // saved preferences, the controls and checkpoint invalidation stay in sync.
    sourceMixerFor(parent)?.set(part, patch);
    Object.assign(sourceSettings.get(parent).get(part), patch);
    preferences?.setSource(parent, part, patch);
    onChange();
  };
  function renderSources(strip, parent, sources) {
    const group = document.createElement('div');
    group.className = 'mixer-source-group'; group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'YM2608 sources');
    for (const [part, values] of sources) {
      const name = `YM2608 ${YM2608_SOURCE_LABELS[part]}`;
      const source = document.createElement('div');
      source.className = 'mixer-source-strip'; source.dataset.source = part;
      const title = document.createElement('div'); title.className = 'mixer-strip-title';
      const heading = document.createElement('strong'); heading.textContent = YM2608_SOURCE_LABELS[part];
      const mute = document.createElement('button'); mute.type = 'button'; mute.className = 'channel-toggle';
      mute.setAttribute('aria-label', `${name} mute`);
      const row = document.createElement('label'); row.className = 'mixer-control'; row.append('Volume');
      const range = document.createElement('input'); range.type = 'range'; range.min = 0; range.max = 380; range.step = 1;
      range.setAttribute('aria-label', `${name} volume`);
      const output = document.createElement('output');
      const update = () => {
        const percent = Math.round(values.gain * 100);
        range.value = percent; output.textContent = `${percent}%`;
        source.classList.toggle('is-boosted', values.gain > 1);
        output.classList.toggle('is-boosted', values.gain > 1);
        mute.textContent = values.muted ? 'Muted' : 'Mute';
        mute.classList.toggle('is-muted', values.muted);
        mute.setAttribute('aria-pressed', String(values.muted));
      };
      const edit = patch => {
        try {changeSource(parent, part, patch);} catch (error) {update(); onError(error); return;}
        update();
      };
      mute.addEventListener('click', () => edit({muted: !values.muted}));
      range.addEventListener('input', () => edit({gain: Number(range.value) / 100}));
      update(); title.append(heading, mute); row.append(range, output); source.append(title, row); group.append(source);
    }
    strip.append(group);
  }
  function render() {
    container.replaceChildren();
    if (!settings.size) {
      const empty = document.createElement('p');
      empty.textContent = 'Load a supported VGM to adjust chip levels.';
      container.append(empty);
    }
    resetButton.disabled = false;
    for (const [id, values] of settings) {
      const name = names[id] ?? id.toUpperCase();
      const strip = document.createElement('div');
      strip.className = 'mixer-strip'; strip.dataset.chip = id;
      const title = document.createElement('div'); title.className = 'mixer-strip-title';
      const heading = document.createElement('strong'); heading.textContent = name;
      const mute = document.createElement('button'); mute.type = 'button'; mute.className = 'channel-toggle';
      const updateMute = () => {
        mute.textContent = values.muted ? 'Muted' : 'Mute';
        mute.classList.toggle('is-muted', values.muted);
        mute.setAttribute('aria-pressed', String(values.muted));
        mute.setAttribute('aria-label', `${name} mute`);
      };
      mute.addEventListener('click', () => {values.muted = !values.muted; updateMute(); change(id, {muted:values.muted});});
      updateMute(); title.append(heading, mute); strip.append(title);
      for (const [key, label, min, max, value, format] of [
        ['gain', 'Volume', 0, 200, Math.round(values.gain * 100), v => `${v}%`],
        ['pan', 'Pan', -100, 100, Math.round(values.pan * 100), v => v === 0 ? 'Center' : `${v < 0 ? 'L' : 'R'} ${Math.abs(v)}`],
      ]) {
        const row = document.createElement('label'); row.className = 'mixer-control'; row.append(label);
        const range = document.createElement('input'); range.type = 'range'; range.min = min; range.max = max;
        range.step = 1; range.value = value; range.setAttribute('aria-label', `${name} ${label.toLowerCase()}`);
        const output = document.createElement('output'); output.textContent = format(value);
        range.addEventListener('input', () => {
          const next = Number(range.value); values[key] = next / 100;
          output.textContent = format(next); change(id, {[key]:values[key]});
        });
        row.append(range, output); strip.append(row);
      }
      if (sourceSettings.has(id)) renderSources(strip, id, sourceSettings.get(id));
      container.append(strip);
    }
  }
  resetButton.addEventListener('click', () => {
    try {
      for (const [parent, sources] of sourceSettings) {
        for (const part of sources.keys()) sourceMixerFor(parent)?.set(part, ym2608SourceDefaults());
      }
      for (const id of settings.keys()) if(mixer?.strips.has(id))mixer.set(id,mixerDefaults(id,configuration));
    } catch (error) {
      // A reset spans several native sources; restore earlier setters if a
      // later one fails, and retain the authored preferences and controls.
      for (const [parent, sources] of sourceSettings) for (const [part, values] of sources) {
        try {sourceMixerFor(parent)?.set(part, values);} catch {}
      }
      for (const [id, values] of settings) {try {if(mixer?.strips.has(id))mixer.set(id,values);} catch {}}
      onError(error); return;
    }
    preferences?.resetMixer();
    for (const id of settings.keys()) settings.set(id,mixerDefaults(id,configuration));
    for (const sources of sourceSettings.values()) for (const part of sources.keys()) sources.set(part,ym2608SourceDefaults());
    onChange();
    onReset();
    render();
  });
  render();
  return {
    load(nextConfiguration) {
      configuration = nextConfiguration;
      mixer = null; settings.clear(); sourceSettings.clear();
      for (const chip of configuration?.chips ?? []) settings.set(chip.id, preferences?.getChip(chip.id,configuration) ?? mixerDefaults(chip.id,configuration));
      if (settings.has('ym2608')) sourceSettings.set('ym2608', new Map(Object.keys(YM2608_SOURCE_LABELS)
        .map(part => [part, preferences?.getSource('ym2608', part) ?? ym2608SourceDefaults()])));
      render();
    },
    attach(next) {
      if (mixer === next) return;
      mixer = null;
      for (const [id, values] of settings) if (next?.strips.has(id)) next.set(id, values);
      for (const [parent, sources] of sourceSettings) for (const [part, values] of sources) sourceMixerFor(parent,next)?.set(part, values);
      next?.reset();
      mixer = next;
    },
  };
}
