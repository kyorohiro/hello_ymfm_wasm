/** Compare the additional Native profile to the actual additional OPN Worklet. */
process.argv.push('--extra');
await import('./check_native_ym2203.mjs');
