/** Raw DMG register writes; same offsets as GameboyApu.writeRegister(). */
export function createGameboyClient(port) {
  let disposed = false;
  const send = (method, args = []) => {
    if (disposed) throw new Error('Game Boy disposed');
    port.postMessage({method, args});
  };
  return {
    writeRegister(offset, value) {
      if (!Number.isInteger(offset) || offset < 0 || offset > 0x2f || !Number.isInteger(value) || value < 0 || value > 255) throw new RangeError('Invalid Game Boy register write');
      send('writeRegister', [offset, value]);
    },
    reset() { send('reset'); },
    dispose() { if (disposed) return; send('dispose'); disposed = true; port.close(); },
  };
}
