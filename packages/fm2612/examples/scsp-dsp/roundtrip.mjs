// SPDX-License-Identifier: BSD-3-Clause
// Run with Node or import from index.html. This example never opens audio.
import {assembleScspDsp, disassembleScspDsp} from 'tetorica-fm2612/scsp_dsp_assembler.js';

// Three physical DSP microsteps. Missing positions are zero-filled through 127.
// Coefficients, routing, RAM and actual execution are configured separately.
export const source = `; A one-pole IIR instruction image, not a running effect.
000: TRA=1 XSEL=0 YSEL=1 ZERO=1 COEF=1
001: XSEL=1 YSEL=1 IRA=32 BSEL=1 COEF=2
002: TWT=1 TWA=0 EWT=1 EWA=0 ZERO=1
`;

export const words = assembleScspDsp(source);
export const canonical = disassembleScspDsp(words);
const restored = assembleScspDsp(canonical);
export const equal = words.length === restored.length && words.every((word, index) => word === restored[index]);
if (!equal) throw new Error('SCSP DSP round trip did not preserve the word image.');

console.log(`SCSP DSP: ${words.length} unsigned 16-bit words / ${words.length / 4} physical steps`);
console.log(canonical);
console.log('Round trip preserved every word. No WASM or audio was initialized.');
