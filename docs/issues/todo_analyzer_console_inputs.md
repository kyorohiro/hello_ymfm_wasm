# Analyzer console music inputs

SID, SPC, Saturn SSF/miniSSF, PSF1/miniPSF and SCSP/VSU VGM/VGZ use the main playlist, transport, Master and Effect controls. The folder picker keeps relative library paths and lists the playable songs. Large playlists display 100 tracks per page. SID has an inline subtune selector, and SPC has the BRR explorer and Note-ish views.

## Verified

- PAL single-SID PSID/RSID v2 uses the SID Player machine, built-in IRQ environment and declared/default model. The header selects the initial subtune. Choosing another subtune stops the previous machine and prepares the new selection for Play. Browser checks cover the 6581 PSID, RSID IRQ and 8580 Preview PSID paths. Files requiring external C64 ROMs need the standalone SID Player.

- SID startup shows file reading, engine loading and subtune initialization beside Play. CH1–3 mute independently before the SID filter. The oscillators and envelopes keep running through mute. Volume-register sample playback and filter tails can remain audible with all three voices muted. Master feeds the Analyzer Effect chain in the SID AudioContext.
- Run `node --test docs/vgm_analyzer/sid_mixer.test.mjs` to compare unmuted fixture output with each original engine and exercise all three voices. The packaged browser test also checks mute, Effect gain and bypass at the destination.

- SSF and miniSSF execute the existing Synth sound-board core. PSF1 and miniPSF use the existing Play! HLE machine and MAME SPU. Libraries are resolved by their respective Synth loaders.
- The main monitor exposes 32 SCSP slot mutes, 24 PS1 SPU voice mutes and six VSU channel mutes. SCSP gates direct output and the DSP send, PS1 gates voice mix volume, and VSU uses the hardware renderer's channel mask. Existing DSP/reverb tails decay normally. The player uses the Analyzer Effect controls and saved settings. Mutes take effect as scheduled audio buffers drain.
- SCSP buttons show the 32 KYONB register bits sampled at PCM block boundaries. SSF reads the running sound board in its Worker. VGM reads the running slot registers. Indicators follow the consumed audio position including pause and seek. Mute is independent. Release tails and DSP output can continue after Key Off.
- The browser check uses original executable songs, verifies nonzero PCM for both standalone and library-backed files, and exercises pause, resume and stop. Its VGM fixtures exercise the SCSP renderer and VSU AudioWorklet. Run `node scripts/check_analyzer_console_songs.mjs release/itch_vgm_analyzer_console-test` after packaging with `sh scripts/package_itch_vgm_analyzer.sh console-test`. Extra file arguments exercise a local SSF/PSF set without copying the music into the distribution.
- YM2610 and YM2610B each expose FM, SSG, ADPCM-A and ADPCM-B source volume and mute. Integration tests render each source in isolation through the native engine. Master and chip strips reach 480%, individual YM2608 and YM2610 source gains reach 380%.
- The main Position sliders seek SCSP/VSU VGM, SSF/miniSSF and PSF1/miniPSF during playback or while paused. VSU restores a checkpoint. SCSP and PSF rebuild a separate machine before committing the new position. SSF runs this fast-forward on its Worker. Untimed PSFs show the 30-minute seek limit and continue playing until Stop or a track change.
- Console WAV export runs a separate renderer from frame zero at 44,100 Hz. It snapshots physical CH mutes and Master, bypasses the Analyzer Effect, honors finite track lengths and fades, and bounds untimed PSFs by the selected seconds. The packaged browser check downloads WAVs and compares PCM at full/half Master, with all channels muted and with one physical channel enabled.
- SNES SPC regression checks cover 8-voice monitoring, mute, raw and voice-configured BRR preview and returning to VGM.

## Next work

- Evaluate periodic SSF machine checkpoints if long, CPU-heavy songs approach the reconstruction deadline.
- Expose PS1 live voice observations and dry audition. Evaluate a passive per-slot envelope API for the SCSP cores if release-phase levels are needed.
- Evaluate NSF/NSFe (NES), GBS (Game Boy), HES (PC Engine) and SAP (Atari). Each needs a music-driver execution environment. Compare its generated PCM with a reference and determine which register/voice observations can be exposed. Game_Music_Emu provides reference implementations for these formats.
- Evaluate MIDI + DX7 SysEx as a paired input for FM21290. Track program/patch selection and distinguish MIDI events from register writes synthesized by Tetorica.

Reference: [Game_Music_Emu](https://github.com/libgme/game-music-emu).
