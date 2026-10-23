/** Additional YM2608 against the actual deployed Worklet; no audio device. */
process.argv.push('--extra');
await import('./check_native_ym2608.mjs');
