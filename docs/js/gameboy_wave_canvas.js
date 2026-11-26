// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
export function drawGameboyWave(canvas, samples) {
  const context = canvas.getContext('2d'); if (!context) return;
  const {width, height} = canvas, margin = 17, top = 18, bottom = height - 25, step = (width - 2 * margin) / 32;
  context.fillStyle = '#283427'; context.fillRect(0, 0, width, height);
  context.strokeStyle = '#546347'; context.lineWidth = 1;
  for (let index = 0; index <= 32; index++) {
    const x = margin + index * step; context.beginPath(); context.moveTo(x, top); context.lineTo(x, bottom); context.stroke();
  }
  for (const level of [0, 5, 10, 15]) {
    const y = bottom - level / 15 * (bottom - top); context.beginPath(); context.moveTo(margin, y); context.lineTo(width - margin, y); context.stroke();
  }
  context.fillStyle = '#c7d6ac'; context.font = '12px sans-serif'; context.fillText('15', 2, top + 4); context.fillText('0', 6, bottom + 4);
  context.fillText('WAVE RAM · 32 × 4-bit', margin, height - 7);
  context.strokeStyle = '#c6dd95'; context.lineWidth = 2.5; context.beginPath();
  for (let index = 0; index < 32; index++) {
    if (samples[index] < 0) continue;
    const x = margin + index * step, y = bottom - samples[index] / 15 * (bottom - top);
    if (!index || samples[index-1] < 0) context.moveTo(x, y); else context.lineTo(x, y);
    context.lineTo(x + step, y);
  }
  context.stroke();
}
