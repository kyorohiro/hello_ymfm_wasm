// SPDX-License-Identifier: BSD-3-Clause
import { VSU_CHANNEL_COUNT } from './vsu.js';

export function setupAuthorMixer(root, onEdit) {
  const doc = root.ownerDocument;
  const make = (name, text) => {
    const element = doc.createElement(name);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const channels = Array.from({ length: VSU_CHANNEL_COUNT }, (_, index) => {
    const strip = make('div');
    strip.className = 'vsu-author-channel';
    strip.append(make('h3', 'CH' + (index + 1)));
    const controls = {};
    for (const side of ['left', 'right']) {
      const label = make('label', side === 'left' ? 'L' : 'R');
      const input = make('input'), amount = make('output');
      input.type = 'range';
      input.min = '0';
      input.max = '15';
      input.setAttribute('aria-label', 'Synth CH' + (index + 1) + ' ' + side + ' level');
      input.addEventListener('input', () => onEdit(index, side, input.valueAsNumber));
      label.append(input, amount);
      strip.append(label);
      controls[side] = { input, amount };
    }
    root.append(strip);
    return controls;
  });
  function drawLevels(index, settings) {
    for (const [side, { input, amount }] of Object.entries(channels[index])) {
      input.value = amount.value = settings[side];
    }
  }
  return { drawLevels };
}
