// SPDX-License-Identifier: BSD-3-Clause
import { createVsuEnvelope, envelopeLevels, envelopeStepMs } from './envelope.js';

export function setupEnvelopeMonitor(canvas, fitCanvas, onEdit) {
  const doc = canvas.ownerDocument;
  const byId = id => doc.getElementById(id);
  const controls = {
    initial: byId('envInitial'), rate: byId('envRate'), direction: byId('envDirection'),
    enabled: byId('envEnabled'), repeat: byId('envRepeat'),
  };
  const initialValue = byId('envInitialValue'), step = byId('envStep');
  let current = createVsuEnvelope();

  function draw() {
    if (canvas.hidden || !canvas.getClientRects().length) return;
    const { width, height, context } = fitCanvas(canvas);
    if (width < 90 || height < 60) return;
    const left = 34, top = 16, bottom = height - 25, right = width - 22;
    const levels = envelopeLevels(current);
    const horizontal = (right - left) / (levels.length - 1);
    const y = level => bottom - (bottom - top) * level / 15;

    context.fillStyle = '#18090f';
    context.fillRect(0, 0, width, height);
    context.font = '11px ui-monospace, monospace';
    context.fillStyle = '#e9b3be';
    context.strokeStyle = '#5c293b';
    context.lineWidth = 1;
    context.textAlign = 'right';
    for (const level of [0, 5, 10, 15]) {
      context.fillText(level, left - 6, y(level) + 4);
      context.beginPath();
      context.moveTo(left, y(level));
      context.lineTo(right, y(level));
      context.stroke();
    }

    context.strokeStyle = '#ff6978';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(left, y(levels[0]));
    for (let index = 1; index < levels.length; index += 1) {
      const x = left + index * horizontal;
      context.lineTo(x, y(levels[index - 1]));
      context.lineTo(x, y(levels[index]));
    }
    context.stroke();
    if (current.enabled) {
      context.textAlign = 'left';
      context.fillText('0 ms', left, height - 7);
      context.textAlign = 'right';
      const duration = envelopeStepMs(current) * (levels.length - 1);
      context.fillText(duration.toFixed(2) + ' ms', right, height - 7);
    }
  }

  function setSettings(envelope) {
    current = envelope;
    controls.initial.value = initialValue.value = envelope.initial;
    controls.rate.value = envelope.rate;
    controls.direction.value = envelope.direction;
    controls.enabled.checked = envelope.enabled;
    controls.repeat.checked = envelope.repeat;
    step.value = envelope.enabled ? envelopeStepMs(envelope).toFixed(2) + ' ms / step' : 'Fixed level';
    draw();
  }

  for (const [key, input] of Object.entries(controls)) {
    const parameter = key === 'enabled' || key === 'repeat' ? 'ev1' : 'ev0';
    input.addEventListener(key === 'initial' ? 'input' : 'change', () => {
      const value = parameter === 'ev1' ? input.checked : key === 'direction' ? input.value : Number(input.value);
      const next = { ...current, [key]: value };
      setSettings(next);
      onEdit(next, parameter);
    });
  }
  new ResizeObserver(draw).observe(canvas);
  return { setSettings, draw };
}
