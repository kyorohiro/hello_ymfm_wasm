# HuC6280 #121: wait for heard Live observation

Run `44548993746` fails `song_manual_preview.test.mjs` before browser checks:
the initial observed volume is 0 rather than 31. The native cache becoming
available does not guarantee the throttled Live state has been published.

- [x] Reproduce cooperative startup parsing deterministically with the real
  WASM core and inert audio buffers, without real sleeps or speaker output.
- [x] Wait for the initial heard Live state as well as the checkpoint; retain
  producer/heard separation, PCM immutability and manual-boundary assertions.
- [x] Run the affected test and HuC6280 Synth suite locally; record results.

No runtime change, broader calibration, remote execution or publication planned.

## Verification

The first manual-boundary test now runs both normally and with a test-scoped
`performance.now()` that consumes the 4ms VGM budget after each parser event.
This deterministically reproduces cooperative startup without real delays.
Before the waiting fix, only the split-startup case failed with the same
`0 !== 31` as CI: `/private/tmp/huc121-before.log`.

The bounded wait now requires both a native checkpoint and the original expected
heard volume. It advances only the fake audio clock, retains the strict final
assertions and does not force a Live refresh or expose future producer state.
All original manual-boundary, old-PCM immutability, source ownership and cache
assertions remain unchanged.

- Affected file: 11 tests pass, including both startup variants;
  `/private/tmp/huc121-after.log`.
- `npm run test:huc6280-synth`: 749 tests pass in about 4.3 seconds;
  `/private/tmp/huc121-synth-suite.log`.
- `git diff --check` passes. No product/runtime/Worklet/WASM changes.

No commit, push or remote rerun was performed. After pushing, use
`gh workflow run huc6280-synth.yml --ref main` to test the corrected commit;
rerunning #121 itself would still use its original commit.
