// Gate SSG volume or ADPCM-A stereo routing at the final register write.
// Trigger, envelope, decoder and sample position continue independently.
export function installOpnChannelMutes(engine, kind) {
  const method = {ym2203:'writeYm2203', ym2608:'writeYm2608', ym2610:'writeYm2610B'}[kind];
  if (!method) return;
  const write = engine[method].bind(engine);
  const groups = [];
  function addGroup(setter, port, first, count, resetValue, mutedBits) {
    const values = new Uint8Array(count).fill(resetValue);
    const group = {port, first, values, resetValue, mutedBits, mask:0};
    groups.push(group);
    function apply(channel) {
      const value = values[channel] & (group.mask & (1 << channel) ? ~mutedBits : 255);
      if (kind === 'ym2203') write(first + channel, value);
      else write(port, first + channel, value);
    }
    engine[setter] = (channel, muted) => {
      if (!Number.isInteger(channel) || channel < 0 || channel >= count) throw new RangeError('Invalid OPN channel');
      const bit = 1 << channel;
      if (Boolean(group.mask & bit) === Boolean(muted)) return;
      group.mask = muted ? group.mask | bit : group.mask & ~bit;
      apply(channel);
    };
  }
  addGroup('setSsgChannelMuted', 0, 8, 3, 0, 255);
  if (kind !== 'ym2203') {
    const opna = kind === 'ym2608';
    addGroup('setAdpcmAChannelMuted', opna ? 0 : 1, opna ? 0x18 : 8, 6, 0xdf, 0xc0);
  }
  engine[method] = (...args) => {
    const port = kind === 'ym2203' ? 0 : args[0];
    for (const group of groups) {
      const index = args.at(-2) - group.first;
      if (port !== group.port || index < 0 || index >= group.values.length) continue;
      group.values[index] = args.at(-1);
      if (group.mask & (1 << index)) args[args.length-1] &= ~group.mutedBits;
      break;
    }
    return write(...args);
  };
  const reset = engine.reset.bind(engine);
  engine.reset = () => {
    reset();
    for (const group of groups) {
      group.values.fill(group.resetValue);
      if (!group.resetValue) continue;
      for (let i = 0; i < group.values.length; i++) {
        if (group.mask & (1 << i)) write(group.port, group.first + i, group.resetValue & ~group.mutedBits);
      }
    }
  };
  const key = engine.stateSettingsKey.bind(engine);
  engine.stateSettingsKey = () => JSON.stringify([key(), ...groups.map(group => group.mask)]);
  const snapshots = new WeakMap();
  const save = engine.saveState.bind(engine), load = engine.loadState.bind(engine);
  engine.saveState = () => {
    const state = save();
    snapshots.set(state, groups.map(group => group.values.slice()));
    return state;
  };
  engine.loadState = state => {
    load(state);
    snapshots.get(state).forEach((values,i) => groups[i].values.set(values));
  };
}
