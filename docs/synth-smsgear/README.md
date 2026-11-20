# Tetorica SMSGEAR Synth

A PSG-first Master System / Game Gear sound laboratory with optional YM2413 FM.
Open `docs/synth-smsgear/index.html` through your local HTTP server.

- **PSG** is selected initially: three square-wave tones, one Noise voice,
  hardware attenuation and Game Gear left/right routing.
- **YM2413** offers 15 fixed instruments plus one shared User patch. User edits
  affect every instrument-0 voice. OP1 is the modulator, OP2 the carrier;
  Envelope fields use hardware codes. Rhythm uses physical CH7–CH9 and replaces
  those melody voices with five percussion instruments. Drum keys are 1–5.
- **Auto** allocates keyboard notes in software; physical CH selection aligns
  the controls and keyboard target. Selecting a channel makes no writes.
- Keyboard: A/W/S/E…; pointer keys also work. Octave and Pitch are software
  performance controls. Code view keeps keyboard input active outside the editor.
- **Mixer** source gains use Tetorica's calibrated output units. These software
  faders are separate from chip attenuation. Master permits 0–380%; boosting
  above 100% turns the bar orange and can overdrive the output.

## Code and Files

Use `const psg = await useSoundChip("segapsg")` or
`const fm = await useSoundChip("ym2413")`. These borrow the same instrument chips
as the controls. There is no hidden YM2612. `liveLoop`, `livePrepare`, `tween`,
`beat`, `context` and software `liveFx` use the existing Synth Code runtime.
Run starts a new performance; Apply preserves context and named loops. Code
and reference playback are mutually exclusive; keyboard can accompany either.

Files reuses working/saved storage: Auto apply is On initially, dirty files have
●, Save/Save all/Discard/Discard all and Cmd/Ctrl+S are available. Cassette ZIPs
retain accepted files plus working differences. Import never runs source.
New Cassette is in Menu → New. Examples are seeded into new projects. Right
click file rows for basic operations. Selecting JSON never forces Keyboard into
Code view. Physical channel edits are direct and do not rewrite the Auto sound.

## VGM reference performance

Menu → Import → VGM / VGZ accepts PSG-only, YM2413-only and combined logs.
Original bytes stay in `/vgm/`; up to 512 static sounds are extracted under
`/presets/`. Choose a preset to load it. Import does not start audio.
Select the song, then Play. Pause/Resume retains chip state and position exactly;
Stop closes the reference player. Each song plays one pass.

Song view displays the selected physical CH from applied registers. Auto update
can freeze this display. Capture to Synth copies its static parameters while
preserving reference transport. Paused keyboard audition uses the Synth route;
it does not overwrite the frozen reference chip. The curves above are output
RMS, waveform and spectrum after Master, not hardware ADSR reconstruction.

Supported events: Sega PSG writes, Game Gear stereo, YM2413 writes and VGM waits.
Limits: 16 MiB compressed/expanded file, two million writes, one-hour preview.
Dual chips, VRC7 variants, unrelated chip writes and DAC stream commands reject
explicitly rather than silently dropping audio. No games, ROMs or song files
are bundled. Synthetic demonstration data in `fixtures.js` is original.

## Current limits

Direct reference-song editing, reference seek/cache, software PSG Envelope,
Looper/Event Rec, timed operation recording and Tauri deployment remain later
work. FM fixed patches are not exposed as editable ROM bytes; choose User to
edit the shared patch. Captures are static sounds, not complete game-driver
software automation or arbitrary rhythm/sample reconstruction.

## Modify / package

The UI and packaging follow the FM2612 Synth patterns. Existing shared Files,
Code, parameter drag buttons, expanded tabs and monitor helpers are reused.
Native chip code and shared mixer policy were not modified for this consumer.

```sh
npm run test:smsgear-synth
npm run test:smsgear-synth:browser
sh scripts/package_itch_smsgear_synth.sh dev
```

The ZIP keeps readable JavaScript, CSS, WASM, source kits and component licenses.
See `PACKAGE.md`, `js/RUNTIME.md` and `js/sources/` inside it. The application is
BSD-3-Clause; included components retain their own notices. This is an
independent Tetorica application, not an official Sega or SMS Power! product.
Hardware references: [SMS Power! sound documentation](https://www.smspower.org/Development/Sound-Index).
