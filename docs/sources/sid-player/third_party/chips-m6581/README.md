# chips / m6581 — experimental SID component

Upstream: https://github.com/floooh/chips

Pinned revision: `9e88298ce56319953ac7a43213a1120359f7a3a6`.
Only `chips/m6581.h` and the upstream license are included. The header credits
Andre Weissflog and Attila Grosz (tedplay); its zlib license remains unchanged.
The surrounding Tetorica bridge and test instrument use BSD-3-Clause.

| Original file | SHA-256 |
| --- | --- |
| `upstream/m6581.h` | `a793225ee69b91e0ea8c91b221d06ee024e45e6c8179176980abfa95d5a54cdf` |
| `LICENSE` | `0c692ece632a8ec6d2a566c9234fdabda655644e6abc70027da9ff7c35e48634` |

The marked adaptation and host behavior are documented in [PATCHES.md](PATCHES.md).
This is a **6581 approximation**, not an 8580 model or full C64/SID music player.
The filter is simplified; exact analog chip variation is outside this version.
See `docs/issues/sid_core_selection_01.md` for alternative cores and comparison.

The normal browser Playground provides **C64 (SID 6581)** mode (`?mode=c64`)
through `sid`, `createSoundChip('sid')` and `useSoundChip('sid')`, in Main and
Worker execution. `SidSynth` adds musical note, voice and shared-filter helpers;
its explicit TypeScript contracts accompany the readable JavaScript. The
Playground factory and package-root raw chip factory have different coverage:
this SID is not a new package-root factory or fixed SDK entry. Native audio
output and `.sid` song playback remain subsequent work.

SID filter mode `off` clears filter output bits. Voices routed into that filter
are then silent; use `routing: 0` for dry output, or e.g.
`{mode:'lowpass', routing:7}` for a shared filtered signal. This follows the
register routing rather than hiding it behind an automatic bypass.

The marked no-wave helper keeps the oscillator's 24-bit phase/MSB sequence
running while the waveform selector is off. Gate continues to control the
envelope, while TEST and oscillator Sync retain their own reset/hold behavior.
Deselected-wave output uses the previous 12-bit output latch, halved per tick;
this is a simple digital fade rather than measured floating-DAC timing. See
patch 7 for the distinct phase and DAC/OSC3 effects and startup differences.

The repository's independent
[phase/Native/WASM checker](https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/scripts/check_sid_waveoff.mjs)
uses an observation-only Native probe and a separate 24-bit arithmetic oracle.
It compares ordinary wave-first fixtures byte for byte and explicitly classifies
frequency-before-wave and waveform-off history changes. It opens no audio device
and uses no third-party music, firmware or GPL reference-engine code.

Build from the repository root with an installed Emscripten SDK:

```sh
python3 scripts/prepare_sid_core.py --check
sh scripts/build_sid_wasm.sh
node scripts/sid_artifacts.mjs --check
node --test test/runtime/sid.test.mjs
```

An explicit output directory keeps a test build isolated:
`sh scripts/build_sid_wasm.sh /tmp/tetorica-sid-build`.
No SDK snapshot, third-party installer, network download, or C64 ROM is required
at build/runtime. This prototype has its own source-hash receipt and does not
claim membership in the authenticated `tetorica-soundchip-native` release.
