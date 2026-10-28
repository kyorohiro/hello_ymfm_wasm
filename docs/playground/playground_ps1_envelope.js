// Editable rate-code guides, not a model of elapsed SPU envelope time.
const stages = [
  ['attack', 'attackRate', 127, .07, .23],
  ['decay', 'decayRate', 15, .30, .46],
  ['sustain', 'sustainRate', 127, .55, .71],
  ['release', 'releaseRate', 31, .80, .96],
];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function ps1EnvelopeGeometry(values, width = 800, height = 180) {
  const top = 18, bottom = height - 32, y = gain => bottom - gain * (bottom - top);
  const attackStopped = values.attackRate >= (values.attackExponential ? 100 : 108);
  const sustainHeld = values.sustainRate >= (values.sustainExponential && !values.sustainDecrease ? 100 : 108);
  const level = (values.sustainLevel + 1) / 16;
  const endLevel = sustainHeld ? level : values.sustainDecrease ? 0 : 1;
  // Targets remain reachable when a rate stops a stage. The panel separately
  // marks a stopped attack's actual zero output; SL still edits its nominal gain.
  const gains = [1, level, endLevel, values.releaseRate >= 27 ? endLevel : 0];
  const handles = stages.map(([id, key, max, from, to], index) => ({
    id, key, max, from:from * width, to:to * width,
    x:(from + (to - from) * values[key] / max) * width, y:y(gains[index]),
  }));
  return {top, bottom, y, level, endLevel, attackStopped, sustainHeld, handles};
}

export function ps1EnvelopePointPatch(values, handle, x, y, width = 800, height = 180) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const geometry = ps1EnvelopeGeometry(values, width, height);
  const point = geometry.handles.find(value => value.id === handle);
  if (!point) return null;
  const patch = {[point.key]:clamp(Math.round((x - point.from) / (point.to - point.from) * point.max), 0, point.max)};
  if (handle === 'decay') patch.sustainLevel = clamp(Math.round((geometry.bottom - y) / (geometry.bottom - geometry.top) * 16 - 1), 0, 15);
  return patch;
}
