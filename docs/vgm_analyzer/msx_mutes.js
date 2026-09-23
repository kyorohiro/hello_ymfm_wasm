// UI mute descriptors share the actual engine registry used for playback.
export function msxMuteControls(kind, header = {}) {
  const controls = [];
  const add = (chip, label, method, channel) => controls.push({
    key: `${chip}:${method}:${channel ?? 'all'}`, chip, label, method, channel,
  });
  if (kind === 'msx' && header.ay8910Clock) {
    add('ay8910', 'AY / YM2149', 'setAyMuted');
    for (let ch = 0; ch < 3; ch++) add('ay8910', `AY ${'ABC'[ch]}`, 'setAyChannelMuted', ch);
  }
  if (kind === 'msx' && header.ym2413Clock) {
    add('ym2413', 'YM2413', 'setChipMuted');
    for (let ch = 0; ch < 9; ch++) add('ym2413', `YM2413 CH${ch + 1}`, 'setChannelMuted', ch);
  }
  if (kind === 'y8950' || (kind === 'msx' && header.y8950Clock)) {
    add('y8950', 'Y8950', 'setY8950Muted');
    add('y8950', 'Y8950 ADPCM', 'setAdpcmMuted');
    for (let ch = 0; ch < 9; ch++) add('y8950', `Y8950 CH${ch + 1}`, 'setChannelMuted', ch);
  }
  if (kind === 'y8950' && header.psgClock) add('psg', 'PSG', 'setPsgMuted');
  if (kind === 'msx' && header.k051649Clock) {
    const label = header.k051649Clock & 0x80000000 ? 'SCC+' : 'SCC';
    add('k051649', label, 'setSccMuted');
    for (let ch = 0; ch < 5; ch++) add('k051649', `${label} ${ch + 1}`, 'setSccChannelMuted', ch);
  }
  return controls;
}
export function applyMsxMute(engine, kind, control, muted) {
  if (!engine) return;
  if (kind === 'msx' && control.method === 'setChipMuted') {
    engine.setChipMuted(control.chip, 0, muted);
    return;
  }
  const target = kind === 'msx' ? engine.entries.get(`${control.chip}:0`)?.engine : engine;
  if (!target) throw new Error(`Missing mute target: ${control.chip}`);
  if (control.channel === undefined) target[control.method](muted);
  else target[control.method](control.channel, muted);
}
