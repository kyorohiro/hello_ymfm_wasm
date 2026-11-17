// Pure instruction inspection: this example does not apply DSP or play notes.
// Run may prepare the selected chip's audio through Playground's normal policy.
// Coefficients, RAM, routing and execution are separate from this field codec.
const source = `; Three physical SCSP DSP microsteps, with zero-filled positions.
000: TRA=1 XSEL=0 YSEL=1 ZERO=1 COEF=1
001: XSEL=1 YSEL=1 IRA=32 BSEL=1 COEF=2
002: TWT=1 TWA=0 EWT=1 EWA=0 ZERO=1
`;

const words = assembleScspDsp(source);
log(`SCSP DSP: ${words.length} words / ${words.length / 4} physical steps`);

// Logical MPRO order: four unsigned 16-bit words for each physical step.
console.table(Array.from({length: 3}, (_, step) => ({
  step,
  word0: '0x' + words[step * 4].toString(16).padStart(4, '0'),
  word1: '0x' + words[step * 4 + 1].toString(16).padStart(4, '0'),
  word2: '0x' + words[step * 4 + 2].toString(16).padStart(4, '0'),
  word3: '0x' + words[step * 4 + 3].toString(16).padStart(4, '0'),
})));

// The pg aliases are the same synchronous helpers, in Main and Worker.
const canonical = pg.disassembleScspDsp(words);
log('Canonical source:\n' + canonical);
const restored = pg.assembleScspDsp(canonical);
const equal = words.length === restored.length && words.every((word, index) => word === restored[index]);
if (!equal) throw new Error('The SCSP DSP word image changed during the round trip.');
log('SCSP DSP round trip: PASS');

const full = disassembleScspDsp(words, {includeTrailingZeros: true});
log(`Full listing: ${full.trimEnd().split('\n').length} physical steps`);
// To inspect every zero-filled position, uncomment: log(full);
// This lossless codec accepts more than Synth's guarded execution profile.
// Successful assembly alone does not establish a runnable hardware effect.
