# Atari POKEY JS and Playground integration

POKEY is available through the JavaScript raw core, Synth helpers, generic
AudioWorklet endpoint and Playground's Browser/Native backends. Each instance
owns four physical channels and its own registers, counters, polynomials,
mute state and lifecycle. Two instances can be used together without sharing
chip state.

## Playground modes

| Mode ID | Display name | Clock | Globals / Mixer IDs |
| --- | --- | --- | --- |
| `pokey` | Atari 8-bit | 1,789,790 Hz | `pokey` / `pokey` |
| `pokey-dual` | Atari Arcade (Dual POKEY) | 1,789,773 Hz | `pokey`, `pokey2` / `pokey`, `pokey:2` |

Channel numbers are zero based, 0–3 per chip. Both modes provide starter code
and editable examples. Keyboard selects a physical chip and channel; Mixer
controls each chip separately. `useSoundChip('pokey')` borrows the first primary
chip, while `createSoundChip('pokey')` creates another independent instance.
Main-thread and Worker execution use the same ownership and stop rules.

For example, in the dual mode:

```js
pokey.setVolume(0, 6);
pokey2.setVolume(0, 6);
pokey.noteOn(0, 'C5');
pokey2.noteOn(0, 'C3');
await beat(1);
pokey.keyOff(0);
pokey2.keyOff(0);
```

The Synth supports tone, polynomial distortion, volume-only mode, shared base
clock, high clocks, 16-bit joined pairs and raw register access. A joined pair
uses its upper channel for sound and lower channel as a timer helper. Frequency
requests outside the selected hardware timer range are rejected. Playground
clock is fixed at creation; setting the same clock acknowledges it, while a
different clock requires a new chip. Hardware reads return the read register
map, rather than the write-register shadow.

Raw `Pokey` PCM preserves the SDK's positive mono output and legacy scale.
Browser and Native speaker paths both apply a 10 Hz DC blocker at unity gain;
this is separate from Mixer. The two new modes use explicit Mixer volume 1.0
and are marked uncalibrated. Existing chip gains and PSG calibration values
remain unchanged. Starter code does not set Mixer volume.

## Distribution and verification

The fixed source is the local, unpublished SDK 0.1.5 candidate described in
[sdk_015_adoption_01.md](sdk_015_adoption_01.md). It includes the BSD-3-Clause
libvgm POKEY adaptation, upstream source, notices and rebuild recipe. No
unlicensed framework headers are required.

The npm staging build includes the JS/WASM modules, declarations and a
self-contained POKEY corresponding-source bundle. Its manifest remains
`tetorica-fm2612@0.2.30` during development. Published npm 0.2.30 does **not**
contain these new POKEY APIs. No package publication, tag, commit, push or remote
CI run is part of this work.

Verification is complete:

- All 4,419 Web/Playground regression tests passed. The two Main-thread
  `createSoundChip`/`useSoundChip` regression cases verify that POKEY returns the
  Synth rather than falling through to a PCM client.
- All 29 SDK WASM artifacts / 57 outputs passed 40,474 exact comparisons using
  the previously rebuilt candidate outputs. Only four test fixture/cache
  expectations changed after that run; production inputs remain identical.
- Native Cargo passed 756 tests with four existing ignored tests. Native and
  Browser speaker paths matched over 36 configurations / 294,912 frames.
- The final flat Playground passed Chromium and WebKit in both Main and Worker
  execution: single/dual starters, borrowed first chip, Keyboard chip/channel
  selection, independent Mixer volume/pan/mute, stop/rerun, and two extra POKEYs
  inside Genesis with independent disposal. Physical output was muted during
  these automatic PCM checks; no claim of human listening is made.
- All 272 served runtime asset hashes match the final ZIP. Every staged file
  matches its ZIP member. Tauri imported all 953 payload files and verified its
  corresponding-source ZIP (1,913 files), plus 24 Python and 31 Node tests.
- The npm candidate built 302 modules / 28 WASM pairs / 349 declarations.
  NodeNext, Bundler and DOM-only consumers passed, as did the installed real
  WASM checks and dual-handle isolation. All 874 tarball members match staging
  and the isolated installation. The candidate remains unpublished.

The Playground ZIP is
`release/hello_ymfm_wasm_pokey-mode-dev_itch_playground.zip`, SHA-256
`e2cf91820eb2b5c946edbfe42fa9f6dd604f344dc2818768306442d9cdd734fe`.
The Synth ZIP was rebuilt and its package dependency checks also passed.
Machine-readable archive, Browser PCM/hash, Native, npm and SDK evidence is in
[atari_pokey_playground_01.json](atari_pokey_playground_01.json).

Subsequent work added [VGM Analyzer playback](atari_pokey_vgm_analyzer_01.md),
[Playground VGM import](atari_pokey_vgm_import_01.md),
[bounded timeline preparation](pokey_timeline_prepare_01.md), and the
[POKEY voice editor](atari_pokey_operators_01.md).
External POKEY I/O and analog board emulation remain separate work. Automated
PCM comparisons do not replace listening or comparison with Atari hardware.
