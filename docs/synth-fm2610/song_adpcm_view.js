// SPDX-License-Identifier: BSD-3-Clause

const hexAddress = address => '0x' + address.toString(16).toUpperCase().padStart(6, '0');
const onOff = value => value ? 'On' : 'Off';

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
    const values = readout(fields);
    card.append(title, values.list);
    voices.append(card);
    return {values, select};
  });
  aPanel.append(aSummary.list, voices);

  const bReadout = readout({...fields, delta: 'Delta-N', rate: 'Playback rate', repeat: 'Repeat'});
  const bPanel = bReadout.list;
  bPanel.id = 'adpcmBVgm';
  bPanel.hidden = true;

  return {
    aPanel, bPanel,
    updateA(state, channel) {
      aSummary.update({'total-level': String(state.volume)});
      state.voices.forEach((voice, index) => {
        const {values, select} = aReadouts[index];
        values.update(voiceFields(voice));
        const pressed = String(index === channel);
        if (select.getAttribute('aria-pressed') !== pressed) select.setAttribute('aria-pressed', pressed);
      });
    },
    updateB(state) {
      bReadout.update({...voiceFields(state), delta: String(state.deltaN),
        rate: Math.round(state.sampleRate).toLocaleString('en-US') + ' Hz', repeat: onOff(state.repeat)});
    },
  };
}
