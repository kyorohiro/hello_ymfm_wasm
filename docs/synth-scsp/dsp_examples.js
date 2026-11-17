// SPDX-License-Identifier: BSD-3-Clause
import {delayProgram} from './dsp.js?v=scsp-dsp-ui-routing-1';
import {disassembleScspDsp} from './dsp_assembler.js';
import {checkScspDspDelaySource, checkScspSynthDspSource} from './dsp_program.js?v=scsp-dsp-ui-routing-1';

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

const firHighpassSource = firSource
  .replace('two-tap FIR low-pass example', 'two-tap FIR high-pass example')
  .replace('COEF1=2048', 'COEF1=-2048')
  .replace('(x[n] + (4095/4096) * x[n-1]) / 2', '(x[n] - (4095/4096) * x[n-1]) / 2')
  .replace(
    '; The filter averages adjacent native 44.1 kHz samples. High frequencies\n; change most, while a low sine note changes little. Listen to the wet output.',
    '; The filter subtracts adjacent native 44.1 kHz samples to suppress low\n; frequencies. Q12 history quantization leaves a small DC residual.\n; Listen to the wet output and compare low notes with the low-pass example.',
  );

const iirSource = `; Tetorica SCSP DSP - one-pole IIR low-pass example
; Recommended codes are COEF0=4095, COEF1=3840, COEF2=256.
; COEF0 is unused by these instructions. Values and routing are configured separately.
;
; x[n] is the 24-bit MIXS0 input after the core's four-bit input shift.
; y[n] = sat24(floor(y[n-1] * COEF1 / 4096)
;              + floor(x[n] * COEF2 / 4096)).
; TEMP stores y[n] and EFREG0 receives y[n] >> 8.
; Recommended values give y[n] ~= 0.9375*y[n-1] + 0.0625*x[n].
; Their positive coefficients sum to 4096 for nominal unity DC gain.
;
; The shifter uses the previous accumulator. Each physical step also
; calculates a new accumulator with its selected operands.

; Read the preceding output and compute its feedback product.
; DEC decreases after every frame, so TRA=1 reads the preceding TWA=0 cell.
000: TRA=1 XSEL=0 YSEL=1 ZERO=1 COEF=1
; Add the current input product to the preceding feedback accumulator.
001: XSEL=1 YSEL=1 IRA=32 BSEL=1 COEF=2
; Store the preceding saturated accumulator as current output history and emit it.
002: TWT=1 TWA=0 EWT=1 EWA=0 ZERO=1

; The native sample rate is 44100 Hz. Delay Time does not affect this program.
; Output history is recursive. At the recommended feedback it decays gradually.
; Inherited TEMP history can therefore influence several later frames.
; Q12 floor divisions can retain a small negative zero-input residual.
; COEF1=-4096 has unit feedback magnitude and can preserve alternating history.
; Stop resets DSP history. Apply keeps the current voices and their sample phase.
; Unlisted steps 003..127 contain zero words.
`;

const delaySource = [
  '; Tetorica SCSP DSP - built-in Synth Delay example',
  '; Recommended codes are COEF0=4095, COEF1=1433, COEF2=4095.',
  '; Coefficient values, MADRS, ring RAM and routing are configured separately.',
  '; Each physical step selects parallel controls. Output uses the previous ACC.',
  '',
  disassembleScspDsp(delayProgram()),
].join('\n');

const routingSource = `; Tetorica SCSP DSP - Gain left / IIR right
; Recommended codes: COEF0=4095, COEF1=3840, COEF2=256.
; Send one voice to MIXS0 and another to MIXS1 using the routing controls.
; Return 0: level 7 / pan 31 (left). Return 1: level 7 / pan 15 (right).
; The program controls hardware DSP paths; choosing sends / returns is separate.
;
; Left: EFREG0 = MIXS0 * COEF0.
000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0
001: EWT=1 EWA=0 ZERO=1
; Right: y[n] = COEF1*y[n-1] + COEF2*MIXS1, using TEMP history.
002: TRA=1 XSEL=0 YSEL=1 ZERO=1 COEF=1
003: XSEL=1 YSEL=1 IRA=33 BSEL=1 COEF=2
004: TWT=1 TWA=0 EWT=1 EWA=1 ZERO=1

; No RAM access. The existing Delay Time control does not affect this program.
; Two physical CH tabs can send different sounds to the two input buses.
; Auto source routing is Synth software grouping over physical SCSP slots.
; Applying this source stages only the program and coefficients, not routing.
`;

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
  {
    id: 'fir2-highpass',
    name: '2-tap FIR high-pass',
    source: firHighpassSource,
    words: checkScspDspDelaySource(firHighpassSource).words,
    codes: [4095, -2048, 2048],
    description: 'Subtract the preceding input sample to reduce low-frequency content.',
    equation: 'y[n] ~= 0.5*x[n] - 0.5*(4095/4096)*x[n-1]',
    roles: ['History capture', 'Previous sample', 'Current sample'],
    filename: 'tetorica-scsp-fir2-highpass.scspasm',
  },
  {
    id: 'iir1-lowpass',
    name: '1-pole IIR low-pass',
    source: iirSource,
    words: checkScspDspDelaySource(iirSource).words,
    codes: [4095, 3840, 256],
    description: 'Feed the preceding output back into the current input sum to smooth high frequencies.',
    equation: 'y[n] ~= 0.9375*y[n-1] + 0.0625*x[n]',
    roles: ['Unused', 'Output feedback', 'Input'],
    filename: 'tetorica-scsp-iir1-lowpass.scspasm',
  },
  {
    id: 'routing-gain-iir',
    name: 'Gain left / IIR right',
    source: routingSource,
    words: checkScspSynthDspSource(routingSource).words,
    codes: [4095, 3840, 256],
    description: 'MIXS0 reaches Gain / EFREG0; MIXS1 reaches IIR / EFREG1. Set sends and Return Pan separately.',
    equation: 'Left = gain*MIXS0; right = a*history + b*MIXS1',
    roles: ['Left gain', 'Right feedback', 'Right input'],
    filename: 'tetorica-scsp-routing-gain-iir.scspasm',
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

/** Identify the shared instruction program independently of its coefficients. */
export function identifyScspDspProgram(words) {
  if (!(words instanceof Uint16Array) && !Array.isArray(words)) return null;
  if (words.length !== 512) return null;
  const example = examples.find(candidate => candidate.words.every((value, index) => value === words[index]));
  if (!example) return null;
  if (example.id === 'routing-gain-iir') return 'routing';
  if (example.id === 'iir1-lowpass') return 'iir1';
  return example.id === 'delay' ? 'delay' : 'fir2';
}

/** Match named coefficient configurations, retaining the legacy word-only identifier
 * when coefficients are omitted. */
export function identifyScspDspExample(words, codes) {
  if (codes !== undefined) {
    if (!Array.isArray(codes) || codes.length !== 3) return null;
    for (const value of codes) {
      if (!Number.isInteger(value) || value < -4096 || value > 4095) return null;
    }
  }
  const program = identifyScspDspProgram(words);
  if (program === 'routing') return codes === undefined || examples.find(value => value.id === 'routing-gain-iir')
    .codes.every((value, index) => value === codes[index]) ? 'routing-gain-iir' : null;
  if (program === 'delay') return 'delay';
  if (program === 'iir1') {
    return codes === undefined || (codes[1] === 3840 && codes[2] === 256) ? 'iir1-lowpass' : null;
  }
  if (program !== 'fir2') return null;
  if (codes === undefined) return 'fir2-lowpass';
  return examples.find(example => example.id.startsWith('fir2-') &&
    example.codes.every((value, index) => value === codes[index]))?.id ?? null;
}
