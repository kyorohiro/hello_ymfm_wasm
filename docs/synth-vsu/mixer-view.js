// SPDX-License-Identifier: BSD-3-Clause
import { VSU_CHANNEL_COUNT } from './vsu.js';

export function setupOutputMixer(root, onEdit) {
  const doc = root.ownerDocument;
  const make = (name, text) => {
    const element = doc.createElement(name);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  for (let channel = 0; channel < VSU_CHANNEL_COUNT; channel += 1) {
    const name = 'CH' + (channel + 1);
    const row = make('div');
    row.className = 'vsu-output-channel';
    const toggle = make('button');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', name + ' output');
    const input = make('input');
    input.type = 'range';
    input.id = 'vsuOutputVolume' + (channel + 1);
    input.min = '0';
    input.max = '100';
    input.value = '100';
    input.setAttribute('aria-label', name + ' volume');
    const amount = make('output');
    amount.htmlFor.add(input.id);
    amount.setAttribute('aria-live', 'off');
    let enabled = true;
    function draw() {
      toggle.textContent = enabled ? 'On' : 'Off';
      toggle.setAttribute('aria-pressed', String(enabled));
      amount.value = input.value + '%';
      input.setAttribute('aria-valuetext', amount.value);
    }
    function update() {
      draw();
      onEdit(channel, { enabled, volume: input.valueAsNumber / 100 });
    }
    toggle.addEventListener('click', () => {
      enabled = !enabled;
      update();
    });
    input.addEventListener('input', update);
    draw();
    row.append(make('strong', name), toggle, input, amount);
    root.append(row);
  }
}
