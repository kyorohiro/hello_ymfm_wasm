# YM2149 ST Synth — reference playback verification

Date: 2026-11-16. Requested scope: VGM / VGZ and SNDH / YM reference performances in Tetorica YM2149 ST Synth.

## Result and use

Open `docs/synth-ym2149-st/index.html` over HTTP and choose **Menu → Music · VGM / SNDH / YM…**. Original files are retained in `/vgm/` or `/music/` and Cassette exports. Use the compact song selector above Envelope / Waveform / Spectrum for Play, Pause / Resume, Stop, seeking and SNDH subsongs.

Auto update defaults to On. CH1–CH3 follows the registers heard at the current playback position using the existing parameter UI. Following fields are read-only; Auto or Auto update Off returns to editing. While paused, the selected sounding CH can be auditioned from the keyboard. **Capture to Synth** saves a static editable instrument and the previous instrument as readable presets, without discarding the paused position. Starting Code stops reference playback and vice versa.

All paths use the existing AudioContext, calibrated Mixer gain and Master output. Reference replay does not modify the public AY/YM SDK or its existing core.

## Playback engines and provenance

- VGM / VGZ uses the existing AY renderer, preserving source clock, register timing and repeated Envelope Shape writes. An independent VgmPlayer / shared Worklet PCM comparison covers supported AY / YM profiles.
- SNDH / YM uses AtariAudio **1.31**, pinned to `1dd9fca810a4f00b4b5e6a5348872ac0a21d88fb`, in a bounded disposable module Worker. Sources, MIT / Musashi notices, ICE / LZH attribution, local patches and rebuild inputs are retained under `third_party/atari-audio/` and in the readable distribution.
- Raw and ICE-packed SNDH, including genuine 68000 init/play and subsong selection, are tested. Raw and level-0 LH5/LHA YM2 / YM3 / YM3b / YM5 / YM6 are supported. No commercial music is included.
- Native source / expanded data is limited to 8 MiB with a 64 MiB WASM memory ceiling, Worker cap, cancellation and request deadlines. VGM source / expansion limits are 16 / 32 MiB. Existing Cassette data limit is 16 MiB.

## Automated verification

`npm run test:ym2149-st-synth`: **102 passed, 0 failed**. Coverage includes actual native and AY PCM; source parsing / timing; ICE / LHA bounds; non-returning 68000 initialization; cancellation / stale requests; transport scheduling / resume / seek rollback; resource disposal; live-clock conversion; static capture; original binary project round trips; calibrated audio routing; legacy Code / keyboard ownership; and deterministic readable packaging with source / WASM tamper rejection. Deleting or replacing a source during preparation cancels the pending selection and preserves the previous song; panel disposal cancels preparation as well.

`node scripts/atari_audio_player_artifacts.mjs --check`: **passed**.

`node scripts/generate_soundchip_mixer_presets.mjs --check`: **passed**. Existing shared calibration remains current.

`git diff --check`: **passed**.

Actual browser checks passed on source and the final packaged root entry in **Chromium and WebKit**:

- VGM, VGZ, LHA-packed YM5 and ICE-packed SNDH generate measurable PCM before the speaker mute.
- Passive import opens no AudioContext and preserves the edited instrument; malformed import keeps the current song playing and reports the failure.
- Live controls follow the selected CH. Pause freezes the position; temporary keyboard audition preserves it and the edited instrument.
- Capture saves both instruments, keeps Pause and allows Resume from the retained position. Selecting another CH returns to its original reference settings.
- Seek, default / changed SNDH subsongs, Code exclusion, Auto update On / Off and Stop silence work.
- One AudioContext and final speaker route; all native Workers terminated after cleanup; no uncaught errors or missing local assets.
- Desktop and 390 / 320 pixel layouts remain within the viewport. Legacy instrument checks cover Keyboard / Code, shared controls, stopped output and closed-context recovery.

Reports: [source reference](verification_ym2149_st_reference_source_browser_20261116.json), [packaged reference](verification_ym2149_st_reference_browser_20261116.json), [packaged instrument regressions](verification_ym2149_st_reference_instrument_browser_20261116.json).

Every physical speaker route was test-muted. These checks establish generated PCM and control behavior; they do not replace human listening or broad collection compatibility testing. Optional Monaco CDN access was blocked to exercise the offline text fallback.

## Distribution and CI

Created with:

```sh
sh scripts/package_itch_ym2149_st_synth.sh reference-20261116-r2
```

Archive: `release/tetorica_ym2149_st_synth_reference-20261116-r2_itch.zip`.

- 197 files, 2,383,500 bytes.
- SHA-256: `a72bb97eb06851c5594ae8eede2447458cd6a0d3471ae3301ecf96b13cac7031`.
- Five explicit browser entry modules, including the native Worker. Authored JavaScript / CSS is readable and not bundled or minified. Original browser inputs and native rebuild kits include hashes / provenance.
- Source and packaged browser verification are wired into `.github/workflows/ym2149-st-synth.yml`; remote Actions has not been run for these uncommitted changes.
- No commit, push, tag or publication was performed.

## Limits and next work

VGM supports a single AY / YM chip; companion chips, dual chips and unsupported streams / commands are rejected. Playback is one pass; unknown duration uses a disclosed three-minute limit. PCM-only MIX1 / YMT files are unsupported.

Capture retains a static register sound, with clock-dependent periods converted to the editable 2 MHz range. It does not reconstruct oscillator / envelope phase, later register automation, Sync-buzzer routines or volume-register sample streams. Silent, incomplete or direct DAC states are not advertised as playable static instruments. SNDH may contain STE audio while Live observes only the three YM register voices.

Human listening, real collection feedback, editable STE DMA, high-rate JavaScript register reservations, standalone timer-effect examples, Looper / Event Rec and Tauri remain separate work. See [the TODO](todo_ym2149_st_synth_20261116.md) and [guide / format limits](../synth-ym2149-st/README.md).
