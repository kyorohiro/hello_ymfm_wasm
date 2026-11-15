# SCSP performance Note Off click guard

Requested 2026-11-16 after hearing release clicks on Sine. Add Synth-level
software release smoothing for keyboard release and scoped JavaScript
`noteOff()`. Keep explicit `keyOff()` on the hardware release path.

- [x] Review the SPU / other PCM Synth approaches and SCSP voice rendering.
      Choose a per-voice method that leaves unrelated notes and shared DSP
      audible and preserves long programmed hardware releases.
- [x] Record the selected design before implementation. Make the software
      nature visible, matching the existing Synth conventions.
- [x] Implement for grouped Auto keyboard / Code and direct physical CH
      keyboard ownership, including paused SSF audition where appropriate.
      Keep raw keyOff separate and protect newer notes from stale releases.
- [x] Cover real native Sine release discontinuity, tail completion,
      retrigger / reuse, multiple voices, long releases, raw bypass and host
      render partitions without changing saved PCM or hardware ADSR codes.
- [x] Verify the affected Worklet / browser paths with physical output muted,
      update Code declarations / help and distribution checks as needed.

Existing staged Apply-highlight changes are separate and must be preserved.
Do not change the shared Native / WASM implementation or package / publish
unrelated products as part of this Synth performance feature.

## Selected design

Use an app-only fast-Release rate limit, default On, rather than a global
audio fade or a fixed-duration cutoff. On performance Note Off, only slots
whose latched effective native Release is faster than rate index 50 receive
a masked RR=25 write before hardware Key Off. Slower / infinite releases
remain on their original native path. Native phase, PCM, other register bits,
requested ADSR values and portable presets are retained; next keyOn writes
the authored RR again. Explicit keyOff bypasses the rate limit.

Track the effective RR index at every actual keyOn using its OCT / FNS / KRS,
including when the preference is Off. The native core latches this rate at
keyOn; a later live pitch bend must not reclassify a long existing release.
No per-voice timer or delayed Key Off is introduced, so an obsolete tail
cannot silence a reused slot. Reset / retirement clears obsolete latches.

Actual-WASM Sine probe at a peak: RR31 release edge 0.0181885 becomes
0.0026245 with RR25 (~6.9x smaller). Audible / complete tail in that fixture
is about 15.5 / 21.1 ms. This is a software-selected SCSP envelope rate, not
SPU's 128-frame minimum envelope and not a new hardware register feature.

## Verification / distribution

- `npm run test:scsp-synth`: 178 passed, including 12 focused native guard
  tests and the primary / paused-audition Worklet preference test.
- `npm run test:runtime:types` passed. Scoped Code types document noteOff /
  keyOff and expose the read-only host preference through getState; portable
  presets, the shared Playground / npm API and native binaries are unchanged.
- The preference starts On and can be toggled without stopping Code or held
  notes. Main-thread requests are intent-fenced; startup replays after a
  passive-draft edit through the final preference ACK. Processor validates
  one boolean before setting both native Synth instances.
- CI includes `test:scsp-synth:click-guard-browser` against the extracted ZIP.
  Browser output is intercepted at gain zero throughout verification.
- The dedicated browser runner passed seven scenario groups in Chromium and
  WebKit on both docs and the final ZIP. It measures actual post-Master PCM,
  subtracts the natural Sine curvature baseline, and verifies scoped noteOff,
  raw keyOff, Auto / physical keyboard release, held-phase preservation while
  toggling, long RR5 tails, preset reload and paused SSF audition.
- In the browser fixture, worst normalized excess curvature falls from
  0.04631 to about 0.00635–0.00676. Fast noteOff / paused audition tails finish
  in about 21 ms with the guard, versus about 2.7 ms on the raw path. The
  frozen SSF position, source PCM / authored RR31 and instrument JSON remain
  unchanged. These are measured fixtures, not a fixed-duration envelope.
- Existing base Synth, Code, Channels, SSF Live and Capture regressions also
  passed both engines against the same ZIP. No physical sound was emitted;
  listening on the user's setup remains the final subjective check.
- The 353-file review ZIP is under
  `/private/tmp/tetorica-scsp-click-guard-review-20261116/` (unpacked sibling
  included). SHA-256:
  `c16d65734ff2329c21e7cf0f2d0a5b73b17eb0a945c5bcf69f9fd8a1514ca176`.
  Focused receipt: `/private/tmp/scsp-guard-zip.json`; regression receipts:
  `/private/tmp/scsp-click-guard-zip-{base,code,channels,live,capture}.json`.
  JavaScript / CSS are byte-exact copies; only packaged HTML navigation links
  receive the existing standalone rewrites. No release, tag or push performed.
