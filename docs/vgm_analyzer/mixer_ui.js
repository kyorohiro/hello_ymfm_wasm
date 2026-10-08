import {mixerDefaults} from './playback_mixer.js';

const names = {psg: 'Sega PSG', gameBoyDmg: 'Game Boy', segaPcm: 'Sega PCM', nesApu: 'NES APU',
  rf5c164: 'RF5C164', pwm: 'PWM', k051649: 'SCC / SCC+', ay8910: 'AY8910'};
export function createMixerUi({container, resetButton, onChange, preferences, onReset = () => {}}) {
  let mixer = null;
  const settings = new Map();
  const change = (id, values) => {
    settings.set(id, {...settings.get(id), ...values});
    if (mixer?.strips.has(id)) mixer.set(id, settings.get(id));
    preferences?.setChip(id, settings.get(id));
    onChange();
  };
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
      mute.addEventListener('click', () => {values.muted = !values.muted; updateMute(); change(id, values);});
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
          output.textContent = format(next); change(id, values);
        });
        row.append(range, output); strip.append(row);
      }
      container.append(strip);
    }
  }
  resetButton.addEventListener('click', () => {
    preferences?.resetMixer();
    for (const id of settings.keys()) change(id, mixerDefaults(id));
    onReset();
    render();
  });
  render();
  return {
    load(configuration) {
      mixer = null; settings.clear();
      for (const chip of configuration?.chips ?? []) settings.set(chip.id, preferences?.getChip(chip.id) ?? mixerDefaults(chip.id));
      render();
    },
    attach(next) {
      if (mixer === next) return;
      mixer = next;
      for (const [id, values] of settings) if (mixer?.strips.has(id)) mixer.set(id, values);
      mixer?.reset();
    },
  };
}
