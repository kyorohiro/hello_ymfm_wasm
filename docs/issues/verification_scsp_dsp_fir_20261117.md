# SCSP DSP two-tap FIR example — 2026-11-17

The DSP example chooser now stages either **Built-in Delay** or **2-tap FIR
low-pass** in the existing editor. Selection and Check leave the live program /
coefficients unchanged. **Apply program + coefficients** installs the checked
source and its recommended three-entry table in one audio-owner transaction.

## Try / restart

1. Open **DSP → Example → 2-tap FIR low-pass**.
2. Check the draft and staged codes `[4095,2048,2048]`, then **Check → Apply program + coefficients**.
3. Enable **DSP return** under **Experimental · FIR routing**. Use direct level 0
   for wet-only comparison. High notes, Saw / Noise and Spectrum reveal the
   gentle high-frequency reduction; a low sine changes little.
4. Choose **Built-in Delay**, Check and Apply to return to its program and
   recommended codes `[4095,1433,4095]`.

The applied label, live coefficient roles and routing hint follow recognized
program words. FIR roles are History capture / Previous sample / Current sample.
**Time** is disabled because this program does not use the Delay RAM ring.
The existing normalized COEF1 control is labelled **Previous tap · COEF1** for
FIR; Code `setEffect({feedback})` still updates that same existing coefficient.

**Reset draft** replaces text / drops the pending recommendation without changing
live coefficients. Selecting / checking another example while an Apply is pending
keeps the newer draft, coefficient recommendation and Check result after the old
acknowledgement arrives. Manual source edits invalidate Check but retain staged
coefficients for explicit review / Apply.

Copy / Save exports text with coefficient comments, not an executable setup
container. FIR downloads use `tetorica-scsp-fir2-lowpass.scspasm`; the package
includes the editable fixture. Reload restores text only, without staging or
applying coefficients. Choose the example again to stage the full setup. Voice
preset / idle formats, COEF0/2 session scope and separate SSF / audition ownership
remain unchanged. The saved Feedback field still controls COEF1.

## Actual DSP behavior

The fixture [fir2-lowpass.scspasm](../synth-scsp/examples/fir2-lowpass.scspasm)
contains four physical steps using MIXS0, rotating TEMP history and EFREG0:

1. Compute current input history with COEF0.
2. Read preceding TEMP history with TRA=1, multiply by COEF1, and store the
   previous accumulator using TWT / TWA=0. Operand reads precede TWT writes;
   frame-end DEC decrement makes this exactly one preceding sample.
3. Add current MIXS0 input × COEF2 to the preceding product.
4. EWT emits the preceding accumulator to EFREG0.

For 24-bit input `x[n]` after the core's MIXS shift:

```text
h[n] = sat24(floor(x[n] * COEF0 / 4096))
y[n] = sat24(floor(x[n] * COEF2 / 4096)
             + floor(h[n-1] * COEF1 / 4096))
EFREG0 = y[n] >> 8
```

Recommended codes approximate
`y[n] = 0.5*x[n] + 0.5*(4095/4096)*x[n-1]`. Positive unity 4096 is not
representable in signed Q12, so the history gain uses 4095. This is a short
low-pass with fixed adjacent-sample timing, not a variable-cutoff / resonant filter.
The initial post-switch frame may read preceding TEMP contents. Its write primes
history, so the next frame depends only on new input history. Apply does not
render a priming frame or reset unrelated voices. Stop resets the core normally.

## Transactions and recovery

Existing program-only Apply and live coefficient APIs remain compatible.
Optional setup coefficients are validated as all three signed integer entries;
the shared validator is used by both Main cold setup and the audio owner.

- Changed setup mutes EFREG0 return, updates changed coefficient words and MPRO
  as needed, clears the existing packed ring and restores return synchronously.
- Coefficient-only setup Apply clears the ring without MPRO writes. Program
  revision advances only for changed words. An identical setup performs no
  hardware / RAM writes. Explicit raw codes normalize the saved Feedback field.
- Any transfer failure restores the old program, affected coefficient words,
  ring and return before rendering resumes. Metadata commits after full success;
  persistent restoration failure uses the existing fatal-owner shutdown path.
- The acknowledged complete setup, including Feedback, is stored in Main before
  awaiting a view refresh. A failed post-ACK read does not turn a successful
  transaction into a failed Apply. Audio restart restores the acknowledged
  program / coefficients and the UI Applied label.

## Verification

Machine evidence: [verification_scsp_dsp_fir_20261117.json](verification_scsp_dsp_fir_20261117.json).

- `npm run test:scsp-synth`: 247/247 pass, including six new example / real-WASM
  tests and nine complete-setup transaction tests. Existing default register
  sequence, PCM, program-only response shape and coefficient behavior remain valid.
- An independent word vector checks all four instructions. Fixture and browser
  module source match byte-for-byte; descriptors return owned arrays / words.
- Real shipped-WASM EFREG0 and stereo PCM match an independent fixed-point
  reference for positive / negative full-range stimuli and coefficient extremes.
  Input impulse 4096 produces adjacent output taps 2048 / 2047, then only zeros.
  DSP execution leaves sample / ring RAM unchanged for this FIR.
- Measured response matches the two quantized taps within 0.0005 amplitude gain
  at 344.53125 Hz, 11,025 Hz and Nyquist. Passband gain exceeds 0.99, quarter-rate
  gain is 0.70–0.72, and Nyquist gain is below 0.001. Partitioned rendering and
  Delay Time changes retain the exact sample sequence. Old TEMP influence is
  bounded to the first processed frame.
- After-mutation failures are injected during coefficient / MPRO / Start / ring /
  return transfers. Rollback restores all register / RAM / metadata snapshots
  and the reference engine's following same-phase stereo PCM exactly. Held Code,
  keyboard owners and independent audition are preserved.
- `npm run test:scsp-dsp-assembler`: 12/12 pass. Both mixer generators pass
  `--check` without changing measured inputs, gains or calibration adapters.
- Source and isolated readable ZIP run real Chromium / WebKit. Cases include
  cold staging / Check / Apply / startup, atomic command payloads, role / control
  synchronization, Check / failure retention, old-ACK / newer-stage races,
  identical-setup continuity, Code / keyboard ownership, Delay restoration,
  downloads, 390px layout and source-only reload scope.
- An additional recovery case holds the app's post-ACK authoring refresh while
  Apply remains pending, closes the AudioContext, and restarts it. FIR words,
  all three codes, Feedback 0.5 and Applied label remain consistent.
- The previous program Check / Apply browser regression also passes in both
  engines. No new generic DSP language, additional RAM layout or public API.

All physical destinations remain behind permanent zero gains before page modules
run. PCM is measured upstream; no human listening is claimed. The clipboard is
stubbed, optional Monaco CDN blocked, and ordinary browser / native apps untouched.
Closed-context analyser windows are excluded from active-output metering because
they retain their last window despite being unable to output. Desktop / mobile
screenshots are inspected.

## Distribution

Affected entry / stylesheet / audio-owner imports use `scsp-dsp-fir-1`.
Readable packaging includes `dsp_examples.js` and `examples/fir2-lowpass.scspasm`
unchanged, with authenticated source receipts and deterministic ZIP verification.

- ZIP: `release/tetorica_scsp_synth_dsp-fir2-20261117_itch.zip`.
- Stage: `release/itch_scsp_synth_dsp-fir2-20261117-Oq3nAP`.
- 363 files; 4,224,416 compressed bytes.
- SHA-256: `a579c8f151990e33252307e448ec28a6496c20b43fa77cdffed11b0331fd233a`.

No commit, push, publication, Tauri import or SDK / WASM rebuild. The independent
checks establish consistency with the pinned core, not physical Saturn accuracy.
