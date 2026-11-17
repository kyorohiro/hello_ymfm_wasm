# SCSP Synth live DSP coefficients — 2026-11-17

The DSP tab now exposes COEF0–2 as three live controls. Each shows its signed
13-bit integer code, Q12 multiplier and register word / address. Existing
Feedback and COEF1 control the same hardware coefficient. The previous
program draft / Check / Apply workflow remains independent.

## Try / restart

Open **DSP → Synth DSP coefficients · live**. Enable the effect under
**Experimental · Delay parameters** to hear its return. Coefficient changes
apply immediately; they do not need program Check / Apply.

- COEF2 = 2048 halves new input to the built-in Delay. COEF2 = 0 stops new
  input without erasing the current tail. Restore 4095 for the default input.
- COEF1 = −2048 is Feedback = −0.5. Successive built-in feedback echoes alternate
  polarity. Both the raw-code and normalized Feedback controls stay synchronized.
- COEF0 = 2048 halves the built-in ring-read output. Restore 4095 for its default.

An edited microprogram may use the three entries differently. The **?** explains
the fixed-point encoding and scope. Values −4096..4095 encode as
`(code & 0x1fff) << 3` at `0x700`, `0x702`, `0x704`; the DSP multiplier is
`code / 4096`. Low three register bits are zero. For example, −2048 produces
word `0xC000`, and 4095 produces `0x7FF8` / multiplier 0.999755859375.

Feedback displays the actual quantized multiplier. The default requested 0.35
still generates the legacy code 1433 / multiplier 0.349853515625. The existing
Code API `scsp.setEffect({feedback:-0.5})` updates the same value and observer
display. `getState().dspCoefficients` exposes the three current codes with types.
No new public DSP Code / npm setter is introduced.

## State and ownership

COEF0 / COEF2 are session settings. They survive Stop, mode / voice-preset loads,
cold audio startup and audio-owner restart. Reloading the page starts them at
4095. COEF1 follows the existing voice-preset Feedback field, including the
existing restored voice draft. Voice-preset and six-key idle-state formats are
unchanged. New negative / above-0.85 Feedback values require this newer reader;
older versions accepted only 0–0.85.

`.scspasm` Copy / Save still exports instructions without coefficients.
Program Apply / Reset draft does not reset coefficients. Coefficient edits do
not rewrite MPRO, clear ring RAM, restart voices or retire Code. The controls
target the primary Synth and are disabled while the separate SSF Live editor
is active. Audition and SSF DSP remain independent.

Each UI edit sends only its selected coefficient. The Worklet validates the
whole partial patch before writes and resolves it against current owned values.
A concurrent Code Feedback update is therefore retained when another coefficient
edit reaches the owner later. Same-value edits do not write hardware.

Only changed coefficient words are written synchronously. Transfer failures
restore all affected register words before metadata changes or subsequent
rendering. A restoration failure uses the existing fatal-owner shutdown path.
Main retains acknowledged COEF0 / COEF2 for restarting audio; no new continuous
polling or local coefficient persistence is added.

## Verification

Machine evidence: [verification_scsp_dsp_coefficients_20261117.json](verification_scsp_dsp_coefficients_20261117.json).

- `npm run test:scsp-synth`: 232/232 pass. New real-WASM tests check signed
  register words, partial edits, default parity, input / output gain, negative
  feedback impulse echoes, zero input, unchanged RAM / MPRO / owners, preset /
  idle / Stop retention, Code synchronization and primary-only dispatch.
- Injected coefficient-write exceptions occur after mutation. Rollback restores
  metadata / registers / RAM and reproduces the reference engine's following
  stereo PCM at the same phase. Persistent restoration failure stops the owner.
- Three number-control tests verify exact 1/4096 increments, signed endpoints,
  drag / arrow / button paths, ordinary decimals, scientific-notation steps,
  integer behavior and disposal. Rounding uses step precision before final
  clamping, replacing the old unconditional six-decimal truncation.
- Code declarations expose the actual three-code state and document Feedback's
  expanded range. The existing strict consumer checks still pass.
- `npm run test:scsp-dsp-assembler`: 12/12 pass. Both mixer generators pass
  `--check`, retaining existing measurements, gain values and provenance.
- Source / isolated readable ZIP use real Chromium and WebKit with the shipped
  Worklet. Cases cover cold edits / startup, bidirectional Feedback / Code sync,
  fractional steppers / endpoints / drag, real wet output, held Code / keyboard,
  partial-patch concurrency, rejection recovery, program replacement, Stop /
  mode / presets, audio restart, narrow layout and reload scope.
- The preceding program Check / Apply browser regression also runs in both
  engines. Coefficient editing does not break its explicit program workflow.

All physical destinations stay behind permanent zero gains installed before
application scripts. PCM is measured upstream; no human listening is claimed.
The OS clipboard is stubbed and the optional Monaco CDN is blocked. No ordinary
browser tab or native app is touched. Desktop / 390px screenshots are inspected.

## Distribution

Changed entry / control / audio / patch / project import paths use
`scsp-dsp-coef-1`, including every consumer of the expanded Feedback validator.
The readable package retains byte-exact live modules and authenticated source
receipts; the deterministic package test remains successful.

- ZIP: `release/tetorica_scsp_synth_dsp-coefficients-20261117-r2_itch.zip`.
- Stage: `release/itch_scsp_synth_dsp-coefficients-20261117-r2-KwcZrm`.
- 361 files, 4,209,492 bytes.
- SHA-256: `b08b5ab333aac52c5affce0088e7e1026059735078512e29ce2e17042dcf18ff`.

No commit, push, upload, npm publication, Tauri import or SDK / WASM rebuild.
Only the current three-entry coefficient table is editable; general coefficient
banks, MADRS / RAM layout, macros and additional DSP examples remain future work.
