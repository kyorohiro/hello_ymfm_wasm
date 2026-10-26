# Playground: Atari ST mode

2026-10-26

## Configuration

- Mode ID: `atari-st`, display name: **Atari ST**.
- YM2149 at 2,000,000 Hz, three tone channels with shared noise and hardware envelope. Mono is sent to both output channels.
- Reuse the AY-family WASM with `type: 0x10`, `flags: 1`. The existing MSX and additional AY-3-8910 defaults remain type 0 at 1,789,773 Hz.
- The primary global is `ay`. `await useSoundChip('ay8910')` borrows this mode's YM2149; it does not allocate another chip. Independent `createSoundChip('ay8910')` keeps the ordinary AY profile.
- Keyboard and the YM2149 tab select physical channels 1–3 (API channels 0–2). The mode's declarations and completions omit OPN `fm`, `play`, and channel constants.
- The mode has its own starter, three curated examples, draft identity and declaration file. Examples cover three voices, tone/noise routing and the shared envelope. They preserve the selected Mixer preset.
- The built-in Mixer inherits the existing AY setting, volume 0.85, from MSX. This is not a new Atari-specific loudness calibration.

The clock and PSG configuration follow Atari's [ST Engineering Hardware Specification](https://www.cpcwiki.eu/imgs/b/b1/Atari_ST_-_Hardware_Specification.pdf). This mode configures the sound chip; it does not emulate an ST CPU, replay SNDH/YM files or add STE DMA audio. High-rate register modulation remains a separate task in [todo_schedule_register_01.md](todo_schedule_register_01.md).

## Backends and lifecycle

Browser and Tauri **Web Audio** use the existing YM2149-capable WASM. The fixed Native SDK AY adapter constructs AY-3-8910 only, so Native does not offer Atari ST. A saved URL requesting Native with Atari ST falls back to Web Audio.

The audio endpoint validates its fixed type/flags before loading assets and passes them through to the Worklet. Inspector snapshots expose the physical profile for the YM2149 label. Clock changes and reset retain the chosen variant.

The profile tests also reproduced a held nonzero resampler sample after Stop at a lower clock. Stop now clears only the cached left/right output, retaining phase and chip state. Main and Worker both return exact silence in that case.

Immutable SDK sources and pins remain at 0.1.2 in the consumers. This task changes the host profile and frontend, not the source SDK or a WASM build recipe. Tauri receives the current frontend ZIP through the normal importer, including earlier frontend updates that had not yet been imported there.

## Verification

- 244 focused Node tests passed: real YM2149 PCM equality with the direct low-level renderer, differences from AY output, 2 MHz pitch, profile validation, clock/reset, Main/Worker, initialization cancellation, mode/type/Keyboard/editor behavior and Mixer generation.
- 292 runtime, real logic Worker, project/starter, existing MSX and Mixer-state tests passed. These overlap with parts of the focused group; the counts are separate runs.
- All Playground mode type fixtures passed, including AY channel bounds and borrowed-primary ownership for Atari ST.
- Tauri frontend importer verification passed for 901 files; Python 22 and Node 31 tests passed.
- Chromium and WebKit both passed on the normal docs and final flat package. Main/Worker A4 was 440.13–440.15 Hz, with exact left/right PCM equality. Profile, borrowed-primary identity, Monaco, physical Keyboard channels, tone/noise/envelope editing, Stop/reRun and all three examples passed, with no page errors or missing assets.
- Browser verification uses `scripts/check_playground_atari_st_browser.cjs`, with actual Worklets and same-quantum stereo capture. It mutes only the final hardware output, retaining the real Mixer/FX/monitor path.
- Both consumers' immutable SDK checks passed: 0.1.2, 381 files each, unchanged archive hash `752d0f449fd69300881f7c369f190932154e96ab8fd103676917087a454b8c72`.

The local frontend ZIP SHA-256 is `dbdd72cd10fc6db72494868de625de45c3fb4830cc8bb2da00d7ea30a5f93b24`; Tauri's normal importer verified its 901 files. Its corresponding application source bundle contains 1,820 files, SHA-256 `b08bce2be5938158279ec25170346c2ee9f2f9c089d10a9701f8e507edb93a15`.

```sh
node scripts/check_playground_mode_types.mjs
node scripts/check_playground_atari_st_browser.cjs
node scripts/check_playground_atari_st_browser.cjs --docs-dir release/itch_playground_atari-st-dev
```

Local logs and generated package: `/private/tmp/tetorica-atari-st-*.log`, `release/hello_ymfm_wasm_atari-st-dev_itch_playground.zip`. No npm/itch.io publication, tag creation, desktop installer execution or physical listening is performed by these checks.
