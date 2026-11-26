# Analyzer console music inputs

The browser Analyzer opens C64 SID songs, Saturn SSF and PlayStation PSF1 sets in the console song player. Select a folder to retain relative library paths. The main file picker also accepts individual files and flat sets. SCSP and Virtual Boy VSU VGM/VGZ open the same player from the playlist. Reopen console songs returns to the last imported set. SNES SPC uses the existing eight-voice player, BRR explorer and Note-ish views.

## Verified

- PAL single-SID PSID/RSID v2 uses the SID Player machine, built-in IRQ environment and declared/default model. The header selects the initial subtune. Choosing another subtune stops the previous machine and prepares the new selection for Play. Browser checks cover the 6581 PSID, RSID IRQ and 8580 Preview PSID paths. Files requiring external C64 ROMs need the standalone SID Player.

- SSF and miniSSF execute the existing Synth sound-board core. PSF1 and miniPSF use the existing Play! HLE machine and MAME SPU. Libraries are resolved by their respective Synth loaders.
- The browser check uses original executable songs, verifies nonzero PCM for both standalone and library-backed files, and exercises pause, resume and stop. Its VGM fixtures exercise the SCSP renderer and VSU AudioWorklet. Run `node scripts/check_analyzer_console_songs.mjs release/itch_vgm_analyzer_console-test` after packaging with `sh scripts/package_itch_vgm_analyzer.sh console-test`. Extra file arguments exercise a local SSF/PSF set without copying the music into the distribution.
- YM2610 and YM2610B each expose FM, SSG, ADPCM-A and ADPCM-B source volume and mute. Integration tests render each source in isolation through the native engine. Master and chip strips reach 480%, individual YM2608 and YM2610 source gains reach 380%.
- SNES SPC regression checks cover 8-voice monitoring, mute, raw and voice-configured BRR preview and returning to VGM.

## Next work

- Integrate console playback with the main timeline, automatic playlist advance and offline WAV export. The current console player has its own transport.
- Expose PS1 live voice observations and dry audition. Investigate a passive snapshot from the **running SSF worker** for Saturn slot monitoring, with positions matched to the audible PCM.
- Evaluate NSF/NSFe (NES), GBS (Game Boy), HES (PC Engine) and SAP (Atari). Each needs a music-driver execution environment. Compare its generated PCM with a reference and determine which register/voice observations can be exposed. Game_Music_Emu provides reference implementations for these formats.
- Evaluate MIDI + DX7 SysEx as a paired input for FM21290. Track program/patch selection and distinguish MIDI events from register writes synthesized by Tetorica.

Reference: [Game_Music_Emu](https://github.com/libgme/game-music-emu).
