# HuC6280 Synth: compact channels, paused edits and Files routes

Started: 2026-11-14. User request: manage VGM CH On/Off in Mixer; hide Sounds from
VGM explanations behind `?`; use Auto / CH1–CH6; edit individual paused song CHs;
provide useful Files examples and an obvious path to presets/.

- [x] Move the existing six VGM output switches into Mixer without changing output/state/cache semantics.
- [x] Collapse extraction explanations behind `?`, retaining the loudest-variant option and operation/error status.
- [x] Rename the common round-robin channel target to Auto, keeping physical display/edit/keyboard aligned.
      Selecting Auto alone must not overwrite other channels.
- [x] Edit a selected paused VGM CH, audition its edited state, switch CHs without losing edits,
      and Resume from the same cursor. Later VGM writes take over; Seek restores the original song.
      Preserve the existing asynchronous ownership and clean-cache boundaries.
- [x] Save a playable selected CH directly to Files presets/ without stopping playback or Code,
      forcing a Capture/Auto switch, changing the keyboard/Code tab, or overwriting existing files.
      Explain unsupported transient DDA/unknown-wave snapshots.
- [x] Add a discoverable, explicit Files route to examples/; never overwrite user files or run imported code.
- [x] Update docs and targeted tests, package a readable standalone ZIP, and verify the changed UI/flows
      in Chromium/WebKit with physical audio muted.

Preserve HuC/MSM/CD-DA source sharing, Mixer/Master levels, Files/Cassette/session storage rules,
existing presets, and original readable sources. No npm/Tauri release, tag, commit or push in this task.

## Implementation and verification progress

The selector displays Auto / CH1–CH6 without changing the historical internal `synth` target.
Copy to Auto copies the configured paused voice; Save to presets saves directly without changing views.
Auto retains its complete authored DDA asset. A physical changing DAC value is not guessed into PCM.
Files → Examples adds missing HuC6280/MSM5205/CD-DA examples explicitly and preserves existing files.

Paused hardware edits are projected onto the heard snapshot using the existing register model and
hardware edit planner, preserving other channels' heard settings. The native writes remain after
retained PCM; Resume plays that buffer first. Later VGM writes win. Successful Seek clears edits,
and cancelled Seek retains them. LFO output settings are not owned by audition keyboard cleanup.

All619 final Node checks pass, with zero failures/skips. The final195-file ZIP2 passes all13 suites,
26 Chromium/WebKit runs and242 checks. All114 readable modules,154 original inputs,6 runtime
artifacts and124 uniquely served assets match the package/current source. All three existing runtime
pairs are unchanged. Browser verification is physically muted; real listening is not performed.
[Verification record](verification_huc6280_synth_channel_ui_20261114.json).
