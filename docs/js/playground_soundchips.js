/** Per-runtime lookup cache. Creation and Stop disposal remain owned by the runtime. */
export function createSoundChipRegistry() {
  const entries = new Map();
  let generation = 0;
  return {
    use(name, options, resolve, {evictOnDispose = !['ym2612', 'ym2203', 'ym2610'].includes(name)} = {}) {
      if (!['ym2612', 'ym2203', 'ym2610', 'rf5c164', 'ym2608', 'gameboy', 'segapsg', 'ym2151', 'pwm', 'nes'].includes(name)) {
        return Promise.reject(new Error(`Unsupported useSoundChip name: ${String(name)}`));
      }
      if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options) || Reflect.ownKeys(options).length)) {
        return Promise.reject(new Error('useSoundChip options (including id) are not supported yet; omit options or use {}.'));
      }
      if (entries.has(name)) return entries.get(name);
      const epoch = generation;
      const pending = Promise.resolve().then(() => {
        if (epoch !== generation) throw new Error('Run stopped');
        return resolve(name);
      }).then(chip => {
        if (epoch !== generation) throw new Error('Run stopped');
        // Additional clients expose dispose. Evict a manually disposed instance;
        // the runtime retains responsibility for its audio device and Stop cleanup.
        if (evictOnDispose && typeof chip.dispose === 'function') {
          const dispose = chip.dispose.bind(chip);
          chip.dispose = () => {
            if (entries.get(name) === pending) entries.delete(name);
            dispose();
          };
        }
        return chip;
      }).catch(error => {
        if (entries.get(name) === pending) entries.delete(name);
        throw error;
      });
      entries.set(name, pending);
      return pending;
    },
    clear() { generation++; entries.clear(); },
  };
}
