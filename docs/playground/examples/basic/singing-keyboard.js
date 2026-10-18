// Singing keyboard: Run, open Keyboard, and play a melody!
// 歌う鍵盤: Run → Keyboard を開き、鍵盤入力でメロディーを弾いてみてください。
// Choose Fixed channel / CH1 / Pre: Current. Click outside the code editor before typing.
// K: keyboard input. Stop, change experiment, then Run when switching K / A / B / C.
// A: fixed pitch / moving vowels; B: fixed vowel / moving pitch; C: both.
const carrierHz = 130; // A / B / C: try 65, 130 or 260 Hz. In K mode, Keyboard controls pitch.
const feedback = 6; // 0..7: 0 is a sine-like source; 6 supplies more harmonics.
const operatorLevel = 16; // OP1 total level, 0..127; larger is quieter.
let experiment = 'K'; // K: play Keyboard; A / B / C: automatic experiments.
const fixedVowel = 0; // 0:a 1:i 2:u 3:e 4:o
liveFx('formant-ym2612', {
  context: {
    vowel: fixedVowel, // 0:a/あ, 1:i/い, 2:u/う, 3:e/え, 4:o/お; fractions morph.
    autoVowels: experiment !== 'B', // false lets you choose vowel above.
    vowelSeconds: 1.4, // Hold, then morph: a → i → u → e → o → a.
    transitionMs: 60, // Smoothing time constant; state survives same-name Apply.
    lfoHz: 0, // Cycles per second, independent of BPM.
    lfoDepth: 0, // Formant shift in octaves; 0 disables it.
    gain: 4,
    mix: 1, // 0: input; 1: formant output. Changes are smoothed.
    formants: [
      [800, 1200, 2500], // a / あ: F1, F2, F3 in Hz (illustrative)
      [300, 2300, 3000], // i / い
      [350, 1200, 2500], // u / う
      [500, 1900, 2600], // e / え
      [500,  900, 2400], // o / お
    ],
    bandwidths: [100, 140, 200], // Hz; wider bands sound less sharply resonant.
    levels: [1, 0.7, 0.4],
  },
  process: formantProcess,
});

// Prepare once: applying edited FX does not retrigger the source.
await livePrepare('formant-ym2612-source', () => {
  // Algorithm 7 makes OP1 a carrier; its own feedback enriches the source.
  fm.setPreset(CH1, FM_PRESETS.sine);
  fm.setAlgo(CH1, 7, feedback);
  fm.setOperator(CH1, OP1, { tl: operatorLevel });
  fm.setOperator(CH1, OP4, { tl: 127 }); // Mute the sine preset's original carrier.
  fm.setPan(CH1, true, true);
  if (experiment !== 'K') {
    fm.setFrequency(CH1, carrierHz);
    fm.keyOn(CH1, [OP1]);
  }
});
// Apply source edits without resetting phase or retriggering the envelope.
fm.setAlgo(CH1, 7, feedback);
fm.setOperator(CH1, OP1, { tl: operatorLevel });
if (experiment !== 'K') fm.setFrequency(CH1, carrierHz);
liveLoop('formant-ym2612-control', async () => {
  // In K mode the keyboard owns pitch and note on/off; the FX still moves vowels.
  if (experiment !== 'K') {
    const hz = experiment === 'A' ? carrierHz : cycle([carrierHz, carrierHz * 1.25, carrierHz * 1.5, carrierHz * 1.25]);
    fm.setFrequency(CH1, hz);
  }
  await sleep(0.6); // seconds; Stop ends the notes and discards filter state.
});

// Filter implementation below. Start experimenting with context above.
/** @param {Float32Array[]} input @param {Float32Array[]} output
 * @param {Record<string, any>} state @param {any} context */
function formantProcess(input, output, state, context) {
  // sampleRate is supplied by AudioWorkletGlobalScope, not a guessed 48000.
  const rate = Number(Reflect.get(globalThis, 'sampleRate'));
  if (!Number.isFinite(rate) || rate < 8000 || rate > 384000) {
    for (const channel of output) channel.fill(0);
    return;
  }
  if (state.schema !== 1 || state.rate !== rate) {
    state.schema = 1; state.rate = rate;
    state.defaults = new Float64Array([
      800, 1200, 2500, // a / あ
      300, 2300, 3000, // i / い
      350, 1200, 2500, // u / う
      500, 1900, 2600, // e / え
      500,  900, 2400, // o / お
    ]);
    state.frequency = new Float64Array([800, 1200, 2500]);
    state.bandwidth = new Float64Array([100, 140, 200]);
    state.level = new Float64Array([1, .7, .4]);
    state.coefficients = new Float64Array(12);
    state.memory = []; state.untilControl = 0;
    state.vowelPhase = 0; state.lfoPhase = 0;
    state.lfoHz = 0; state.depth = 0; state.gain = 0; state.mix = 1;
    state.vowelSeconds = 1.4;
  }
  // Two integrator memories per band, independently for left and right.
  while (state.memory.length < output.length) state.memory.push(new Float64Array(6));
  const frames = output[0]?.length ?? 0;
  for (let i = 0; i < frames; i++) {
    if (state.untilControl === 0) {
      // Recalculate at a fixed 16-sample control interval, across block edges.
      // This keeps tan() out of the per-channel/per-sample inner loop.
      const ms = Number.isFinite(context.transitionMs) ? Math.max(5, Math.min(500, context.transitionMs)) : 60;
      const alpha = 1 - Math.exp(-16 / (rate * ms * .001));
      const seconds = Number.isFinite(context.vowelSeconds) ? Math.max(.25, Math.min(10, context.vowelSeconds)) : 1.4;
      const hz = Number.isFinite(context.lfoHz) ? Math.max(0, Math.min(8, context.lfoHz)) : 0;
      const depth = Number.isFinite(context.lfoDepth) ? Math.max(0, Math.min(1, context.lfoDepth)) : 0;
      const gain = Number.isFinite(context.gain) ? Math.max(0, Math.min(12, context.gain)) : 4;
      const mix = Number.isFinite(context.mix) ? Math.max(0, Math.min(1, context.mix)) : 1;
      state.vowelSeconds += alpha * (seconds - state.vowelSeconds);
      state.lfoHz += alpha * (hz - state.lfoHz);
      state.depth += alpha * (depth - state.depth);
      state.gain += alpha * (gain - state.gain);
      state.mix += alpha * (mix - state.mix);
      const vowel = Number.isFinite(context.vowel) ? Math.max(0, Math.min(4, context.vowel)) : 0;
      const position = context.autoVowels === true ? state.vowelPhase : vowel;
      const first = Math.floor(position), next = (first + 1) % 5;
      const fraction = position - first;
      // Auto: hold each vowel for 60% of its time, then morph to the next.
      let blend = context.autoVowels === true ? Math.max(0, (fraction - .6) / .4) : fraction;
      blend = blend * blend * (3 - 2 * blend);
      const shift = 2 ** (state.depth * Math.sin(state.lfoPhase));
      for (let band = 0; band < 3; band++) {
        const a = context.formants?.[first]?.[band], b = context.formants?.[next]?.[band];
        const fa = Number.isFinite(a) && a > 0 ? a : state.defaults[first * 3 + band];
        const fb = Number.isFinite(b) && b > 0 ? b : state.defaults[next * 3 + band];
        const limit = Math.min(6000, rate * .2);
        const target = Math.max(40, Math.min(limit, Math.exp(Math.log(fa) * (1 - blend) + Math.log(fb) * blend) * shift));
        state.frequency[band] += alpha * (target - state.frequency[band]);
        const width = context.bandwidths?.[band], level = context.levels?.[band];
        const bw = Number.isFinite(width) ? Math.max(40, Math.min(600, width)) : band === 0 ? 100 : band === 1 ? 140 : 200;
        const amplitude = Number.isFinite(level) ? Math.max(0, Math.min(2, level)) : band === 0 ? 1 : band === 1 ? .7 : .4;
        state.bandwidth[band] += alpha * (bw - state.bandwidth[band]);
        state.level[band] += alpha * (amplitude - state.level[band]);
        // Trapezoidal state-variable band-pass (Andrew Simper / Cytomic).
        // k * bandPass gives approximately unity gain at the band centre.
        const g = Math.tan(Math.PI * state.frequency[band] / rate);
        const k = Math.max(1 / 24, Math.min(2, state.bandwidth[band] / state.frequency[band]));
        const a1 = 1 / (1 + g * (g + k)), offset = band * 4;
        state.coefficients[offset] = a1;
        state.coefficients[offset + 1] = g * a1;
        state.coefficients[offset + 2] = g * g * a1;
        state.coefficients[offset + 3] = k;
      }
      if (context.autoVowels === true) state.vowelPhase = (state.vowelPhase + 16 / (rate * state.vowelSeconds)) % 5;
      state.lfoPhase = (state.lfoPhase + 2 * Math.PI * state.lfoHz * 16 / rate) % (2 * Math.PI);
      state.untilControl = 16;
    }
    for (let ch = 0; ch < output.length; ch++) {
      const raw = input[ch]?.[i] ?? 0;
      const dry = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
      const memory = state.memory[ch];
      let sum = 0;
      for (let band = 0; band < 3; band++) {
        const offset = band * 4, m = band * 2, c = state.coefficients;
        const v3 = dry - memory[m + 1];
        let v1 = c[offset] * memory[m] + c[offset + 1] * v3;
        const v2 = memory[m + 1] + c[offset + 1] * memory[m] + c[offset + 2] * v3;
        const ic1 = 2 * v1 - memory[m], ic2 = 2 * v2 - memory[m + 1];
        if (!Number.isFinite(ic1) || !Number.isFinite(ic2) || Math.abs(ic1) > 1e6 || Math.abs(ic2) > 1e6) {
          memory[m] = memory[m + 1] = 0; v1 = 0;
        } else {
          memory[m] = Math.abs(ic1) < 1e-24 ? 0 : ic1;
          memory[m + 1] = Math.abs(ic2) < 1e-24 ? 0 : ic2;
        }
        sum += state.level[band] * c[offset + 3] * v1;
      }
      // Soft limiting keeps the wet signal below ±0.75, with headroom.
      const wet = .75 * Math.tanh(state.gain * sum / .75);
      output[ch][i] = dry * (1 - state.mix) + wet * state.mix;
    }
    state.untilControl--;
  }
}
