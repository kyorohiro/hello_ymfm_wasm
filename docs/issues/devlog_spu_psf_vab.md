# Tetorica SPU Synth adds PSF and VAB instrument import

Tetorica SPU Synth can now import instruments from standard PlayStation sound banks and play them from your computer keyboard, directly in the browser.

The new **PSF / VAB** tab brings the bank controls together, separate from **Audio**, which remains the place to load recordings and other audio files.

## Open a bank and play a Tone

Open a standard Sony **VAB v6/v7** file, or select its matching **VH and VB** files together. Choose a Tone and click **Load selected Tone** to play it across the keyboard.

The importer uses the original SPU ADPCM sample, loop position, ADSR and tuning without converting the sample to WAV or encoding it again. You can edit the instrument and use **Save preset** to keep it as a `.spu.json` file.

## Extract instruments from PSF sets

For **PSF1 / MiniPSF**, select the song and its related **PSFLib** files together, or open their folder to preserve subdirectories. Extract downloaded ZIP archives first.

1. Open **PSF / VAB** and choose **Open PSF set…** or **Open PSF folder…**.
2. Select a **PSF entry** and click **Extract VAB banks**.
3. Choose a **Sound bank** and **Tone**, then click **Load selected Tone**.
4. Play the keyboard, adjust the instrument and save a preset.

Opening or extracting banks keeps your current instrument playing until you load a Tone. Unavailable Tones are disabled, and the first supported Tone is selected automatically. The computer keyboard also remains playable while the entry, bank or Tone selector has focus.

The update also fixes a brief Morph checkbox rollback when the audio engine confirms a change before the next display refresh.

## Current support

PSF extraction finds contiguous standard VAB banks in the expanded program data. It runs locally in your browser. PSF2, song playback, custom or runtime-packed banks, and separate VH/VB layouts inside PSF are outside the current support. Each loaded Tone plays across the keyboard; game-specific key zones, layers and driver effects are not reconstructed. Volume and pan are approximations.

No game files or game samples are included. If you try a PSF set, feedback about which banks and Tones work will help guide the next round of compatibility improvements.

---

Posting notes — exclude this section from the itch.io post:

- Draft date: 2026-10-30. Codex has not posted this draft. Check the existing itch.io devlogs before posting it again.
- Current local upload artifact: `release/tetorica_spu_synth_dev_itch_v0.1.0.zip`. Upload as an HTML project with the root `index.html`.
- Local commit and release filenames use `v0.1.0`; the ZIP's internal packaging label remains `dev`. Public upload status has not been checked.
- This post describes the standalone Synth update. Playground also has the shared PSF importer. Its calibration gate has since been resolved and a new local ZIP candidate has been validated; see playground_spu_vab_release_01.md. Its public upload status has not been checked.
