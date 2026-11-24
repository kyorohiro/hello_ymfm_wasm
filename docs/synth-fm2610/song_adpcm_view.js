// SPDX-License-Identifier: BSD-3-Clause

const hexAddress = address => '0x' + address.toString(16).toUpperCase().padStart(6, '0');
const onOff = value => value ? 'On' : 'Off';
const rateFormat = new Intl.NumberFormat('en-US', {maximumFractionDigits: 2});

function voiceFields(voice) {
  return {
    key: onOff(voice.keyed),
    range: voice.rangeValid ? `${hexAddress(voice.start)}–${hexAddress(voice.playbackEnd ?? voice.end)}` : '—',
    level: String(voice.volume),
    pan: [voice.left && 'L', voice.right && 'R'].filter(Boolean).join(' + ') || 'Off',
    rom: voice.rangeValid ? (voice.available ? 'Loaded' : 'Unavailable') : '—',
  };
}

export function createFm2610AdpcmReadouts(document, selectA) {
  function readout(labels) {
    const list = document.createElement('dl');
    list.className = 'adpcm-readout';
    const values = new Map();
    for (const [id, name] of Object.entries(labels)) {
      const label = document.createElement('dt');
      label.textContent = name;
      const value = document.createElement('dd');
      value.dataset.field = id;
      if (id === 'range') value.title = 'The end address is exclusive';
      values.set(id, value);
      list.append(label, value);
    }
    return {
      list,
      update(fields) {
        for (const [id, value] of Object.entries(fields)) {
          const output = values.get(id);
          if (output.textContent !== value) output.textContent = value;
        }
      },
    };
  }

  const fields = {key: 'Key latch', range: 'ROM range', level: 'Level', pan: 'Pan', rom: 'ROM data'};
  const aPanel = document.createElement('div');
  aPanel.id = 'adpcmAVgm';
  aPanel.hidden = true;
  const aSummary = readout({'total-level': 'Total level'});
  const voices = document.createElement('div');
  voices.className = 'fm2610-section-grid';
  const aReadouts = Array.from({length: 6}, (_, index) => {
    const card = document.createElement('section');
    card.className = 'fm2610-voice';
    card.dataset.adpcmVoice = String(index + 1);
    const title = document.createElement('h3');
    const select = document.createElement('button');
    select.type = 'button';
    select.textContent = 'A' + (index + 1);
    select.setAttribute('aria-pressed', 'false');
    select.addEventListener('click', () => selectA(index));
    title.append(select);
    const values = readout({...fields, trigger: 'Last key-on'});
    card.append(title, values.list);
    voices.append(card);
    return {values, select};
  });
  aPanel.append(aSummary.list, voices);

  const bReadout = readout({key: 'Key latch', rom: 'ROM data', rate: 'Playback rate'});
  const bPanel = bReadout.list;
  bPanel.id = 'adpcmBHardware';
  bPanel.querySelector('[data-field="key"]').title = 'Last Key On or Key Off command; a one-shot can end while the latch is on.';

  return {
    aPanel, bPanel,
    updateA(state, channel) {
      aSummary.update({'total-level': String(state.volume)});
      state.voices.forEach((voice, index) => {
        const {values, select} = aReadouts[index];
        values.update({...voiceFields(voice), trigger: voice.lastTriggerTime === null ? '—' : `${voice.lastTriggerTime.toFixed(3)} s`});
        const pressed = String(index === channel);
        if (select.getAttribute('aria-pressed') !== pressed) select.setAttribute('aria-pressed', pressed);
      });
    },
    updateB({keyed, available, playbackRate}) {
      bReadout.update({key: onOff(keyed), rom: available ? 'Loaded' : 'Unavailable',
        rate: rateFormat.format(playbackRate) + ' Hz'});
    },
  };
}
