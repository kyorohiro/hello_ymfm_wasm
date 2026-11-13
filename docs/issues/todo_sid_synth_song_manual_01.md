# SID Synth: song playback with manual controls

Keep SID songs and Code mutually exclusive, while allowing manual controls and
the keyboard to share the chip that is currently playing. Start with SID; PSF
playback in SPU Synth remains a separate follow-up.

- [x] Inspect the reference player and record the same-chip edit/ownership design.
- [x] Add partial voice/filter edits and keyboard commands to the running song chip.
- [x] Let later song writes win; ignore stale keyboard releases and pitch updates.
- [x] Keep CH selection, Live display and manual edits consistent without copying
      stale snapshots over newer song registers.
- [x] Preserve Pause/Resume, capture, model selection, edited presets and Code behavior.
- [x] Verify unchanged playback PCM without manual input, targeted register edits,
      keyboard ownership and transport lifecycle in Node.
- [x] Verify Chromium/WebKit with output gain zero before application JavaScript;
      never produce physical audio during automated checks.
- [x] Include readable source in the itch package and record results here.

## Design notes

The player Worklet receives manual actions on its actual SID. All three player
backends expose unclocked register writes and per-register source-write revisions;
same-value C64 writes also advance revisions. Gate and frequency ownership are
separate, so a later song frequency update steals keyboard Pitch without making
an old key-up clear a newer song Gate. This does not depend on diagnostic trace
capacity.

The editor sends sparse field patches. Waveform and LP/BP/HP toggles also carry
changed-bit masks; packed registers merge against the latest chip state. Model
selection stays in the song import controls. No observed full preset is written
back into the song or adopted into the saved author bank.

CH 1 / 2 / 3 selects the actual song channel while playing. Auto update off
freezes observation, retaining direct edits and keys. Synth · Round robin uses
the separate authored bank while the song continues. Pause keeps its chip frozen;
keys audition an available captured patch on the authoring chip. Resume releases
that temporary audition and restores the author's bank. Captured Voice selection
remains an explicit import that stops the preview. Starting Code or a song stops
the other automatic performance; changing tabs alone does not start Code.

## Verification

Complete: SID Synth 247/247, Player 149/149 and standalone 8580 endpoint 5/5
Node tests pass. Native non-intervention comparison is exact for 12 profiles /
196,608 mono samples, with gain, rendering blocks and pause bridge unchanged.
27 native waveform-off comparisons also pass with the historical proofs retained.

The final ZIP passes Chromium and WebKit: 86 Synth checks per browser, including
manual song controls, broad import/capture, transport upgrades, Code and ordinary
Synth behavior. The shared ordinary SID Player passes 35 checks per browser.
Every automated browser destination was muted before app JavaScript; Chromium
also used `--mute-audio`. No human listening, commit, push or publication occurred.

Package: `release/tetorica_sid_synth_sid-song-manual-20261113b_itch.zip`.
All 335 files match the stage byte-for-byte and ZIP CRC checks pass. Browser
modules and matching native rebuild inputs remain readable in the package.

Record: [verification_sid_synth_song_manual_20261113.json](verification_sid_synth_song_manual_20261113.json).
Detailed logs: `build/verification/sid-song-manual-20261113/`.

Next: expand the same automatic-performance/manual-control behavior to SPU's
PSF playback. Existing SPU Code/manual and paused-audition behavior is retained.
