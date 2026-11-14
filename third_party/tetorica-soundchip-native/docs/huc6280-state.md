# HuC6280 core checkpoints

Local SDK development version **0.1.8-huc-state** adds a complete, versioned checkpoint to
the raw HuC6280 core. Creating a source archive does not publish this version.
The existing `huc6280_generate` PCM ABI and synthesis behavior are unchanged.

Include `<tetorica/huc6280_state.h>` and link `tetorica::huc6280`, or use the
same `huc6280_*` exports in the HuC6280 WASM module. These functions operate on
handles from **`huc6280_create(clock, rate)`**. They must not receive handles
from `native_huc6280_create`: that older wrapper owns additional clock-resampler
and observation state, which this raw-core checkpoint does not represent.

```c
uint32_t size = huc6280_state_size(chip); /* 512; NULL returns 0 */
uint8_t bytes[512];
if (huc6280_save_state(chip, bytes, sizeof bytes) &&
    huc6280_validate_state(other_matching_chip, bytes, sizeof bytes)) {
    huc6280_load_state(other_matching_chip, bytes, sizeof bytes);
}
```

Save, validate and load return **1** on success or **0** on rejection. Exact
size and non-null storage are required. The caller supplies valid storage and
serializes access with writes/rendering. WASM additionally rejects buffers that
extend outside linear memory. Buffers overlapping the core object are rejected.
These operations allocate no C++ memory and do not advance audio. Loading copies
all decoded values; the caller can immediately discard or overwrite its bytes.

Validation checks the entire format, synthesis-compatibility ID, clock/rate,
reserved bytes, all eight voice fields, enabled/control consistency, timers,
indices, five-bit values, LFSRs and finite bounded output values. Load decodes to
a temporary value structure and commits only after every check passes. Rejected
data leaves native settings, phase and future PCM unchanged.

Matching raw-core instances can exchange these bytes without sharing an object,
memory address or WASM heap. The format contains no pointers, allocation sizes,
C++ padding or derived volume table. A future incompatible synthesis/state
change must update the compatibility ID; a changed byte layout must also update
the format version. Application caches should additionally bind snapshots to
their parser position, configured output rate, source identity and module build.

## Version 1 byte layout

All multibyte integers are little-endian. Signed integers use two's complement;
outputs are IEEE-754 binary32 bit patterns. The exact length is **512 bytes**.

| Offset | Encoding | Value |
| --- | --- | --- |
| 0 | 8 bytes | ASCII `HUCSAVE1` |
| 8 | u32 | Format version `1` |
| 12 | u32 | Length `512` |
| 16 | u64 | Compatibility ID `0x5693c83943957e2e` |
| 24 | u32 | Matching chip clock |
| 28 | u32 | Matching output sample rate |
| 32 | u64 | Integer resampler phase, less than sample rate |
| 40, 44 | float32 | Last native left/right output, finite and within ±1 |
| 48 | u8 | Selected channel, 0–7 |
| 49 | u8 | Enabled mask, matching all eight channel control gates |
| 50 | u8 | Global balance |
| 51, 52 | u8 | LFO frequency/control |
| 53 | u8 | Output mute mask, bits 0–5 |
| 54–63 | 10 bytes | Reserved, zero |
| 64 | 8 × 56 bytes | Eight channel records described below |

The compatibility ID records the SHA-256 prefix of the unchanged pre-checkpoint
PCM implementation. It is an explicit semantic version identifier, not a claim
that modified source files still have their old hashes. The source inventory
records both original and amended source hashes.

| Channel offset | Encoding | Value |
| --- | --- | --- |
| 0 | u16 | Frequency code, 0–4095 |
| 2, 3 | u8 | Control/balance |
| 4 | 32 × u8 | Wave RAM, each 0–31 |
| 36, 37 | u8 | Wave index 0–31 / Noise control |
| 38 | i16 | DDA value, 0–31 |
| 40 | i32 | Noise counter, 0–1984 |
| 44 | u32 | Reserved Noise-frequency state, currently zero |
| 48 | u32 | 18-bit Noise LFSR; nonzero for CH5/CH6, zero for other channels |
| 52 | i32 | Tick counter; CH1 −255–4336, CH2 0–1044480, others 0–4096 |

The signed carrier bound retains real negative LFO steps. The larger CH2 bound
retains a full 4096 × 255 modulation timer even when later register writes change
its period. Reset retains output mute flags, as before this addition.

## Offline checks

```sh
cmake -S . -B build/huc-state -DCMAKE_BUILD_TYPE=Release -DTETORICA_NATIVE_BUILD_EXAMPLES=OFF
cmake --build build/huc-state --target tetorica_huc6280_fixture tetorica_huc6280_state_fixture
ctest --test-dir build/huc-state -R tetorica.huc6280 --output-on-failure
sh scripts/build-wasm.sh huc6280 build/huc-state-wasm
node tests/huc6280_state_wasm_smoke.mjs build/huc-state-wasm build/huc-state/native/tetorica_huc6280_state_fixture dist/wasm
```

The smoke compares generated PCM against the retained legacy WASM, checks exact
Native/WASM state bytes and continuation in both directions, and exercises
malformed headers, values, clocks/rates, offsets and buffer ranges. All fixtures
generate original data and PCM arrays/files; no browser, game ROM or audio
device is opened.
