/** The selected core belongs to a physical additional YM2612 instance. */
export function validateYm2612Engine(engine = 'ymfm') {
  if (engine !== 'ymfm' && engine !== 'nuked') throw new TypeError('YM2612 engine must be "ymfm" or "nuked"');
  return engine;
}

/** Validate before reserving a Mixer ID, allocating a core or posting Worker RPC. */
export function validateSoundChipOptions(name, options) {
  const allowed = ['id', ...(name === 'nes' ? ['fds', 'clock'] : []), ...(name === 'ym2612' ? ['engine'] : [])];
  if (!options || typeof options !== 'object' || Array.isArray(options) || Reflect.ownKeys(options).some(key => !allowed.includes(key))) {
    throw new TypeError('createSoundChip supports {id}, {engine} for YM2612, and {fds, clock} for NES');
  }
  if (name === 'nes' && options.fds !== undefined && typeof options.fds !== 'boolean') throw new TypeError('fds must be boolean');
  if (name === 'ym2612') validateYm2612Engine(options.engine);
}
