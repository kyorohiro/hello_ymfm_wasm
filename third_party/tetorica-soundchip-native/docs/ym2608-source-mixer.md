# YM2608 four-source software mixing (unpublished candidate)

`ym2608_set_source_gains(handle, fm, ssg, rhythm, adpcm)` accepts four finite
floating-point multipliers in0..1024 and returns1 on success,0 on rejection.
All fields validate before mutation. The order is FM, SSG, Rhythm, ADPCM-B.
Defaults are all1. These are software gains, not YM2608 register controls.

The previous `ym2608_set_output_gains(handle, fm_side, ssg)` remains available
and retains its existing meaning: `fm_side` scales the combined FM/Rhythm/
ADPCM stereo bus, and `ssg` scales the separate mono SSG bus. New source gains
apply before the combined FM-side clamp; legacy bus gains apply afterwards.
The source SSG multiplier composes with the legacy SSG multiplier. Final mixed
output keeps the original16-bit range clamp and float normalization.

The pinned vendor core is unchanged. The bridge derives a small host adapter
from `ymfm::ym2608`, reusing its protected engines and resampler. It repeats
the exact original generate/clock cadence while caching the three stereo
source contributions. At all-source unity, the historical integer sum, clamp
and prescale averaging are retained exactly. Sources continue to clock when
their host gain is zero. Faders do not rewrite FM TL, Rhythm attenuation,
ADPCM-B Level, routing, sample memory or any other authored register.

Checkpoints are in-process, same-build state. A56-byte host trailer follows
the unchanged core/interface/memory payload:

| Offset in trailer | Payload |
| --- | --- |
| 0 | Legacy FM-side float gain |
| 4 | Legacy SSG float gain |
| 8,12,16,20 | Four source float gains |
| 24..47 | Six signed32-bit FM/Rhythm/ADPCM cached-stem values |
| 48 | Magic0x3450584d |
| 52 | Version1 |

This is48 bytes larger than the previous two-bus layout. Older raw checkpoint
buffers are rejected explicitly; JS same-instance opaque state can continue
to save and restore within the matching module build. Gain, trailer and memory
length validation completes before live state changes. Host gains survive
`ym2608_reset`, matching the previous output-bus controls.

Build and verify without an audio device:

```sh
sh scripts/build-wasm.sh ym2608 /absolute/path/to/wasm
node tests/ym2608_source_gains_wasm_smoke.mjs --wasm-dir /absolute/path/to/wasm
```

The optional `--legacy-dir` argument compares default output/status/core state
with a previous two-bus build over quiet/loud single-source and mixed programs,
irregular chunks and prescale changes. The separate Native Playground wrapper
has its own public C ABI and does not acquire these gains from this change.
