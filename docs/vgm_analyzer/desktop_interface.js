// Optional desktop bridge. Ordinary browser pages keep their existing file picker.
// The Tauri shell injects the versioned implementation before page scripts run.
export function connectDesktop({openFiles}, host = globalThis) {
  const bridge = host.__tetoricaDesktop;
  if (bridge?.version !== 1 || !bridge.available || typeof bridge.connect !== 'function') {
    return {available: false, disconnect() {}};
  }
  const disconnect = bridge.connect(openFiles);
  return {available: true, disconnect};
}
