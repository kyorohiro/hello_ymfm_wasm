/** The selected core belongs to a physical additional YM2612 instance. */
export function validateYm2612Engine(engine = 'ymfm') {
  if (engine !== 'ymfm' && engine !== 'nuked') throw new TypeError('YM2612 engine must be "ymfm" or "nuked"');
  return engine;
}

/** Validate before reserving a Mixer ID, allocating a core or posting Worker RPC. */
export function validateSoundChipOptions(name, options) {
  const allowed = ['id', ...(name === 'nes' ? ['fds', 'clock'] : name==='sid'?['clock','model']:name==='pokey'?['clock']:[]), ...(name === 'ym2612' ? ['engine'] : [])];
  if (!options || typeof options !== 'object' || Array.isArray(options) || Reflect.ownKeys(options).some(key => !allowed.includes(key))) {
    throw new TypeError('createSoundChip supports {id}, {engine} for YM2612, {clock} for POKEY, {clock, model} for SID, and {fds, clock} for NES');
  }
  if (name === 'nes' && options.fds !== undefined && typeof options.fds !== 'boolean') throw new TypeError('fds must be boolean');
  if(name==='pokey'&&options.clock!==undefined&&(!Number.isInteger(options.clock)||options.clock<100000||options.clock>100000000))throw new RangeError('POKEY clock must be integer Hz from 100000 to 100000000');
  if(name==='sid'){
    if(options.clock!==undefined&&(!Number.isInteger(options.clock)||options.clock<900000||options.clock>1100000))throw new RangeError('SID clock must be integer Hz from 900000 to 1100000');
    if(options.model!==undefined&&!['6581','8580'].includes(options.model))throw new TypeError('SID model must be "6581" or "8580"');
    if(options.model==='8580'&&options.clock!==undefined&&options.clock!==985248)throw new RangeError('SID 8580 Preview requires PAL 985248 Hz');
  }
  if (name === 'ym2612') validateYm2612Engine(options.engine);
}
