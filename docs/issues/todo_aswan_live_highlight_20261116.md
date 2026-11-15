# ASWAN Synth: Live parameter change highlighting

- [x] Reuse the existing Synth Live highlight mechanism on ASWAN's current
      Wave, source, stereo volume, Sweep and Noise controls during VGM / Code.
- [x] Add a default-On, locally remembered Live highlight switch. Off clears
      pulses immediately and skips comparisons; retain the current editor layout.
- [x] Establish clean baselines on first observation, CH / source-session
      switches, Pause, seek, Stop, frozen Auto update and leaving Code. Never
      present unknown Wave RAM / transient PCM placeholders as recovered edits.
- [x] Use the existing Live refresh cadence and bounded CSS pulses, without
      adding an audio graph, timer, forced layout read or replay operation.
- [x] Verify scalar changes, unchanged fields, real VGM / Code observations,
      setting persistence, keyboard focus and source/standalone ZIP behavior
      in muted Chromium / WebKit. Preserve live manual editing and audition.
- [x] Update help, guide and verification; rebuild the dev ZIP after checks.

Scope: display-only ASWAN changes. No chip/DSP/calibration/public-API changes,
Looper, Event Rec, Tauri, commit, push, tag or publication. Use self-authored
fixtures and mute physical audio output during automated checks.

## Completed behavior and verification

- VGM / Code Live changes briefly highlight the existing Source, Wave, stereo
  volume, CH3 Sweep and CH4 Noise fields. Complete Code PCM samples may also
  highlight their existing scalar settings without traversing sample payloads.
- The channel **?** contains **Live highlight**, default On and remembered
  locally. Off clears pulses and skips comparisons without changing audio.
  No extra permanent toolbar row was added.
- The existing shared helper owns bounded pulses; local CSS lasts 500ms and
  uses a gentle static tint for reduced motion. No new timer, animation loop,
  forced layout measurement, sound source or transport operation was added.
- New CH/session, first-known settings, Pause, seek, Stop, frozen Auto update,
  hidden/collapsed panels and Code transitions rebaseline. Code polling rejects
  stale pre-transition reads; Auto update Off→On waits for a fresh observation.
- `npm run test:aswan-synth`: 161 passed. Source and the fresh final ZIP pass
  13 browser groups each in Chromium and WebKit (52 groups total), including
  prior live manual / paused audition regressions. All physical audio was muted;
  the active app retained one AudioContext and one destination. Preference-only
  sibling pages created no audio contexts.
- Rebuilt `release/tetorica_aswan_synth_dev_itch.zip` with 135 readable files.
  Its module graph includes both the ASWAN adapter and shared highlight helper.
  The ASWAN workflow now also triggers on changes to that shared dependency.
  Chip core, calibration, public API and other Synth applications are unchanged.

Highlights follow the current sampled Live display, rather than every
intermediate register write. Human listening remains unperformed. No publication.

See [verification](verification_aswan_live_highlight_20261116.json).
