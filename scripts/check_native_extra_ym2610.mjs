/** Additional four-FM YM2610 versus its actual deployed Worklet; no device. */
process.argv.push('--extra');
await import('./check_native_ym2610b.mjs');
