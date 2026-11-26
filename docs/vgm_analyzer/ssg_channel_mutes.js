// As in the OPNA Synth, gate only the three SSG volume writes. The shared
// envelope and oscillators keep advancing, including while a channel is muted.
export function installSsgChannelMutes(engine, kind) {
  const method = {ym2203:'writeYm2203', ym2608:'writeYm2608', ym2610:'writeYm2610B'}[kind];
  if (!method) return;
  const volumes = new Uint8Array(3);
  let mask = 0;
  const write = engine[method].bind(engine);
  engine[method] = (...args) => {
    const reg = args.at(-2);
    if ((kind === 'ym2203' || args[0] === 0) && reg >= 8 && reg <= 10) {
      const channel = reg - 8;
      volumes[channel] = args.at(-1);
      if (mask & (1 << channel)) args[args.length-1] = 0;
    }
    return write(...args);
  };
  engine.setSsgChannelMuted = (channel, muted) => {
    if (!Number.isInteger(channel) || channel < 0 || channel > 2) throw new RangeError('Invalid SSG channel');
    const bit = 1 << channel;
    if (Boolean(mask & bit) === Boolean(muted)) return;
    mask = muted ? mask | bit : mask & ~bit;
    const value = muted ? 0 : volumes[channel];
    if (kind === 'ym2203') write(8 + channel, value);
    else write(0, 8 + channel, value);
  };
  const reset = engine.reset.bind(engine);
  engine.reset = () => { reset(); volumes.fill(0); };
  const key = engine.stateSettingsKey.bind(engine);
  engine.stateSettingsKey = () => JSON.stringify([key(), mask]);
  const snapshots = new WeakMap();
  const save = engine.saveState.bind(engine), load = engine.loadState.bind(engine);
  engine.saveState = () => {
    const state = save();
    snapshots.set(state, volumes.slice());
    return state;
  };
  engine.loadState = state => { load(state); volumes.set(snapshots.get(state)); };
}
