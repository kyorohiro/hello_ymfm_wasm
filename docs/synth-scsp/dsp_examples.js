// SPDX-License-Identifier: BSD-3-Clause
import {delayProgram} from './dsp.js?v=scsp-dsp-fir-1';
import {disassembleScspDsp} from './dsp_assembler.js';
import {checkScspDspDelaySource} from './dsp_program.js?v=scsp-dsp-fir-1';

const firSource = `; Tetorica SCSP DSP - two-tap FIR low-pass example
; Recommended codes are COEF0=4095, COEF1=2048, COEF2=2048.
; Coefficient values and send/return routing are configured separately.
;
; x[n] is the 24-bit MIXS0 input after the core's four-bit input shift.
; h[n] = sat24(floor(x[n] * COEF0 / 4096)).
; y[n] = sat24(floor(x[n] * COEF2 / 4096)
;              + floor(h[n-1] * COEF1 / 4096)).
; EFREG0 receives y[n] >> 8. With the recommended Q12 codes this is
; approximately (x[n] + (4095/4096) * x[n-1]) / 2 before rounding.
;
; The shifter uses the previous accumulator. Each physical step also
; calculates a new accumulator with its selected operands.

; Calculate the current input history value.
000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0
; Read the previous frame before writing the current history value.
; DEC decreases after every frame, so TRA=1 reads the previous TWA=0 cell.
001: TRA=1 TWT=1 TWA=0 XSEL=0 YSEL=1 ZERO=1 COEF=1
; Add the current input tap to the preceding history product.
002: XSEL=1 YSEL=1 IRA=32 BSEL=1 COEF=2
; Emit the previous accumulator to EFREG0.
003: EWT=1 EWA=0 ZERO=1

; No RAM delay-ring access is used. Delay Time does not affect this program.
; The filter averages adjacent native 44.1 kHz samples. High frequencies
; change most, while a low sine note changes little. Listen to the wet output.
; Switching programs can expose one frame of preceding TEMP history.
; The first FIR frame stores new history, so later frames use this input only.
; Unlisted steps 004..127 contain zero words.
`;

const delaySource = [
  '; Tetorica SCSP DSP - built-in Synth Delay example',
  '; Recommended codes are COEF0=4095, COEF1=1433, COEF2=4095.',
  '; Coefficient values, MADRS, ring RAM and routing are configured separately.',
  '; Each physical step selects parallel controls. Output uses the previous ACC.',
  '',
  disassembleScspDsp(delayProgram()),
].join('\n');

const examples = [
  {
    id: 'delay',
    name: 'Built-in Delay',
    source: delaySource,
    words: checkScspDspDelaySource(delaySource).words,
    codes: [4095, 1433, 4095],
    description: 'Read the delay ring, output its sample and mix feedback with new input.',
    equation: 'Ring read + new input + feedback',
    roles: ['Ring read', 'Feedback', 'Input'],
    filename: 'tetorica-scsp-delay.scspasm',
  },
  {
    id: 'fir2-lowpass',
    name: '2-tap FIR low-pass',
    source: firSource,
    words: checkScspDspDelaySource(firSource).words,
    codes: [4095, 2048, 2048],
    description: 'Average the current and previous input sample to reduce high-frequency content.',
    equation: 'y[n] ~= 0.5*x[n] + 0.5*(4095/4096)*x[n-1]',
    roles: ['History capture', 'Previous sample', 'Current sample'],
    filename: 'tetorica-scsp-fir2-lowpass.scspasm',
  },
];

/** Fresh descriptors for a compact example chooser. */
export function listScspDspExamples() {
  return examples.map(({id, name}) => ({id, name}));
}

/** Return owned program / coefficient data for staging an example. */
export function createScspDspExample(id) {
  const example = examples.find(value => value.id === id);
  if (!example) throw new RangeError('Unknown SCSP DSP example');
  return {...example, words: example.words.slice(), codes: [...example.codes], roles: [...example.roles]};
}

/** Identify only the program words. Coefficients remain independently editable. */
export function identifyScspDspExample(words) {
  if (!(words instanceof Uint16Array) && !Array.isArray(words)) return null;
  if (words.length !== 512) return null;
  return examples.find(example => example.words.every((value, index) => value === words[index]))?.id ?? null;
}
